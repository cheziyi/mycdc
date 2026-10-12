import { deriveDeviceIdentity, type DeviceIdentity } from './device';

const ORIGIN = 'https://mapp.cdc.com.sg';
const API_PATH = '/learner_management/api/v1';

const SUCCESS_CODE = '201';
const REQUEST_TIMEOUT_IN_MS = 15_000;
const MAXIMUM_ATTEMPTS = 3;
const RETRY_DELAY_IN_MS = 700;

/** CDC rejected the credentials, and will until the learner changes them. */
export class AuthenticationError extends Error {}
/** CDC did not answer, or answered with a fault. */
export class UpstreamError extends Error {}

export interface Booking {
  ResasmblyId?: string;
  /** DD/MM/YYYY. */
  SesDate?: string;
  /** Such as "08:30 AM". */
  SesStartTime?: string;
  /** Such as "10:10 AM". CDC spells this field with a lowercase "t". */
  SesEndtime?: string;
  SesEndTime?: string;
  TicketNo?: string;
  instructor_name?: string;
  fixed_instructor_name?: string;
  /** Present for a practical booking. */
  allocation?: Record<string, unknown>;
  allocation_map_link?: string;
  /** HTML holding the Zoom link, meeting ID and passcode of an online booking. */
  ZoomDetails?: string | null;
}

interface Envelope {
  code?: string | number;
  msg?: string;
  authtoken?: string;
  data?: unknown;
}

interface Reply {
  status: number;
  body: Envelope | null;
}

interface RequestOptions {
  body?: string;
  token?: string;
}

function readCode(body: Envelope | null): string | null {
  return body && body.code !== undefined ? String(body.code) : null;
}

async function request(
  method: 'GET' | 'POST',
  path: string,
  userAgent: string,
  options: RequestOptions = {},
): Promise<Reply> {
  const headers: Record<string, string> = { 'User-Agent': userAgent };
  if (options.token) headers['Authorization'] = `Token ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  let response: Response;
  try {
    response = await fetch(ORIGIN + path, {
      method,
      headers,
      body: options.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_IN_MS),
    });
  } catch (error) {
    throw new UpstreamError(`CDC did not respond (${(error as Error).name}).`);
  }

  const text = await response.text();
  let body: Envelope | null = null;
  try {
    body = JSON.parse(text) as Envelope;
  } catch {
    // A Cloudflare challenge page and an HTML error page are not JSON.
  }
  return { status: response.status, body };
}

const sleep = (durationInMs: number) => new Promise((resolve) => setTimeout(resolve, durationInMs));

/**
 * CDC answers 206 intermittently to valid credentials at sign-in, and to
 * booking/summary for an account that has bookings. It answers 400 for a
 * transient server error.
 */
const TRANSIENT_CODES = new Set(['206', '400']);

function isTransient({ status, body }: Reply): boolean {
  if (status === 401 || status === 403) return false;
  if (status >= 500) return true;
  if (!body) return true;
  return TRANSIENT_CODES.has(readCode(body) ?? '');
}

/**
 * Returns the last reply even when it is still transient: a 206 that outlasts
 * the attempts means rejected credentials to `signIn` and a fault to
 * `requestBookingSummary`.
 */
async function call(
  method: 'GET' | 'POST',
  path: string,
  userAgent: string,
  options: RequestOptions = {},
): Promise<Reply> {
  let reply: Reply | undefined;
  let failure: unknown;

  for (let attempt = 1; attempt <= MAXIMUM_ATTEMPTS; attempt++) {
    try {
      reply = await request(method, path, userAgent, options);
      failure = undefined;
      if (!isTransient(reply)) return reply;
    } catch (error) {
      failure = error;
    }
    if (attempt < MAXIMUM_ATTEMPTS) await sleep(attempt * RETRY_DELAY_IN_MS);
  }

  if (failure) throw failure;
  return reply as Reply;
}

export async function signIn(learnerId: string, password: string, device: DeviceIdentity): Promise<string> {
  // CDC spells the path "leaner".
  const { status, body } = await call('POST', `${API_PATH}/leaner/signin/`, device.userAgent, {
    body: new URLSearchParams({
      CustomerID: learnerId,
      password,
      // Sent empty: CDC sends the learner's push notifications to the token in
      // this field.
      device_uid: '',
      device_os: 'ANDROID',
      device_type: device.userAgent,
      player_id: device.playerId,
    }).toString(),
  });

  if (readCode(body) === SUCCESS_CODE && body?.authtoken) return body.authtoken;
  if (!body || status >= 500) throw new UpstreamError('CDC is not accepting sign-ins right now.');
  throw new AuthenticationError(body.msg || 'Invalid learner ID or password.');
}

async function requestBookingSummary(token: string, userAgent: string): Promise<Booking[]> {
  const { status, body } = await call('GET', `${API_PATH}/booking/summary/`, userAgent, { token });

  if (status === 401 || status === 403) throw new AuthenticationError('CDC rejected the session token.');
  if (readCode(body) !== SUCCESS_CODE) {
    throw new UpstreamError(body?.msg || `CDC returned HTTP ${status} for the booking summary.`);
  }
  return Array.isArray(body?.data) ? (body.data as Booking[]) : [];
}

/**
 * CDC sometimes answers an account that has bookings with an empty list and
 * code 201, so an empty list is requested a second time before it is returned.
 */
export async function fetchBookingSummary(token: string, userAgent: string): Promise<Booking[]> {
  const bookings = await requestBookingSummary(token, userAgent);
  if (bookings.length > 0) return bookings;

  await sleep(RETRY_DELAY_IN_MS);
  return requestBookingSummary(token, userAgent);
}

export async function fetchBookings(learnerId: string, password: string): Promise<Booking[]> {
  const device = await deriveDeviceIdentity(learnerId);
  return fetchBookingSummary(await signIn(learnerId, password, device), device.userAgent);
}
