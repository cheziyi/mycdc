import { AuthenticationError, UpstreamError, fetchBookings, type Booking } from './cdc';
import {
  ConfigurationError,
  CredentialsError,
  decryptCredentials,
  derivePublicKeyBytes,
  encodeBase64Url,
  fingerprintCredentials,
  type Credentials,
} from './ecies';
import { buildCalendar, buildEvents } from './ical';

export interface Env {
  CDC_PRIVATE_KEY_JWK?: string;
}

const FRESH_LIFETIME_IN_SECONDS = 900;
const STALE_LIFETIME_IN_SECONDS = 172_800;
const DEFAULT_ALARM_IN_MINUTES = 60;
const MAXIMUM_ALARM_IN_MINUTES = 10_080;
const PREVIEW_EVENT_COUNT = 5;

// /calendar.ics and /api/preview carry a visitor's encrypted credentials in the
// query string. robots.txt asks a crawler not to fetch them; this header covers
// a crawler that does.
const NO_INDEX_HEADERS = { 'x-robots-tag': 'noindex, nofollow, noarchive' };

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_INDEX_HEADERS, ...headers },
  });

const textResponse = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_INDEX_HEADERS },
  });

type CacheKind = 'fresh' | 'stale';

interface BookingsResult {
  bookings: Booking[];
  /** True when CDC could not be reached and the bookings are the 48-hour copy. */
  stale: boolean;
}

function buildCacheKey(fingerprint: string, kind: CacheKind): Request {
  return new Request(`https://cache.mycdc.internal/${kind}/${fingerprint}`);
}

async function readCache(fingerprint: string, kind: CacheKind): Promise<Booking[] | null> {
  const hit = await caches.default.match(buildCacheKey(fingerprint, kind));
  if (!hit) return null;
  try {
    return (await hit.json()) as Booking[];
  } catch {
    return null;
  }
}

function writeCache(context: ExecutionContext, fingerprint: string, bookings: Booking[]): void {
  const body = JSON.stringify(bookings);
  for (const [kind, lifetimeInSeconds] of [
    ['fresh', FRESH_LIFETIME_IN_SECONDS],
    ['stale', STALE_LIFETIME_IN_SECONDS],
  ] as const) {
    const response = new Response(body, {
      headers: {
        'content-type': 'application/json',
        'cache-control': `public, max-age=${lifetimeInSeconds}`,
      },
    });
    context.waitUntil(caches.default.put(buildCacheKey(fingerprint, kind), response));
  }
}

// Serves the stale copy only for an UpstreamError. An AuthenticationError is
// always thrown, so rejected credentials are never hidden behind old bookings.
async function getBookings(credentials: Credentials, context: ExecutionContext): Promise<BookingsResult> {
  const fingerprint = await fingerprintCredentials(credentials);

  const fresh = await readCache(fingerprint, 'fresh');
  if (fresh) return { bookings: fresh, stale: false };

  try {
    const bookings = await fetchBookings(credentials.learnerId, credentials.password);
    writeCache(context, fingerprint, bookings);
    return { bookings, stale: false };
  } catch (error) {
    if (error instanceof UpstreamError) {
      const stale = await readCache(fingerprint, 'stale');
      if (stale) return { bookings: stale, stale: true };
    }
    throw error;
  }
}

function buildErrorResponse(error: unknown, asJson: boolean): Response {
  let status = 500;
  let message = 'Sorry, something went wrong while building your calendar. Please try again in a moment.';

  if (error instanceof CredentialsError) {
    status = 400;
    message = error.message;
  } else if (error instanceof AuthenticationError) {
    status = 401;
    message = "ComfortDelGro Driving Centre didn't accept this learner ID and password. Please check them in the CDC app, then create a new link.";
  } else if (error instanceof UpstreamError) {
    status = 503;
    message = "ComfortDelGro Driving Centre isn't responding right now. Your calendar will catch up on its next refresh.";
  } else if (error instanceof ConfigurationError) {
    message = "This site isn't set up yet: its decryption key is missing.";
  }

  return asJson ? jsonResponse({ ok: false, error: message }, status) : textResponse(message, status);
}

function parseAlarmInMinutes(url: URL): number {
  const raw = url.searchParams.get('alarm');
  if (raw === null) return DEFAULT_ALARM_IN_MINUTES;
  if (/^(none|off|no)$/i.test(raw)) return 0;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= MAXIMUM_ALARM_IN_MINUTES
    ? Math.round(minutes)
    : DEFAULT_ALARM_IN_MINUTES;
}

async function handleCalendar(url: URL, env: Env, context: ExecutionContext): Promise<Response> {
  const credentials = await decryptCredentials(url.searchParams.get('creds') ?? '', env.CDC_PRIVATE_KEY_JWK);
  const { bookings, stale } = await getBookings(credentials, context);
  const events = await buildEvents(bookings);
  const calendar = buildCalendar(events, { alarmInMinutes: parseAlarmInMinutes(url) });

  return new Response(calendar, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="cdc-bookings.ics"',
      // `private`: the URL is a bearer token, so a shared proxy must not store
      // the calendar it returns.
      'cache-control': `private, max-age=${FRESH_LIFETIME_IN_SECONDS}`,
      'x-mycdc-events': String(events.length),
      'x-mycdc-source': stale ? 'cache-stale' : 'live',
      ...NO_INDEX_HEADERS,
    },
  });
}

async function handlePreview(url: URL, env: Env, context: ExecutionContext): Promise<Response> {
  const credentials = await decryptCredentials(url.searchParams.get('creds') ?? '', env.CDC_PRIVATE_KEY_JWK);
  const { bookings, stale } = await getBookings(credentials, context);
  const events = await buildEvents(bookings);

  return jsonResponse({
    ok: true,
    stale,
    count: events.length,
    events: events.slice(0, PREVIEW_EVENT_COUNT).map((event) => ({
      summary: event.summary,
      date: event.displayDate,
      time: event.displayTime,
    })),
  });
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('Method not allowed.', 405);
    }

    try {
      switch (url.pathname) {
        case '/api/pubkey':
          return jsonResponse(
            {
              key: encodeBase64Url(derivePublicKeyBytes(env.CDC_PRIVATE_KEY_JWK)),
              alg: 'ECIES-P256-HKDF-SHA256-AESGCM',
            },
            200,
            { 'cache-control': 'public, max-age=3600' },
          );

        case '/api/preview':
          return await handlePreview(url, env, context);

        case '/calendar.ics':
        case '/calendar':
          return await handleCalendar(url, env, context);

        default:
          return textResponse('Not found.', 404);
      }
    } catch (error) {
      // Logs the path without its query string, which holds the credentials.
      console.error(`${url.pathname} failed:`, error);
      return buildErrorResponse(error, url.pathname.startsWith('/api/'));
    }
  },
} satisfies ExportedHandler<Env>;
