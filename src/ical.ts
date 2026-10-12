import type { Booking } from './cdc';

const TZID = 'Asia/Singapore';
const SINGAPORE_OFFSET_IN_MS = 8 * 60 * 60_000;
const DEFAULT_DURATION_IN_MS = 60 * 60_000;
const PRODID = '-//mycdc//CDC Booking Feed//EN';
const CALENDAR_NAME = 'CDC Bookings';
const DEFAULT_LOCATION = 'ComfortDelGro Driving Centre, 205 Ubi Ave 4, Singapore 408805';

// A calendar application opens a postal address in a map, and cannot open a
// branch code.
const BRANCH_ADDRESSES: Record<string, string> = {
  UBI: DEFAULT_LOCATION,
};

export interface CalendarEvent {
  uid: string;
  summary: string;
  /** Singapore local time as YYYYMMDDTHHMMSS. */
  start: string;
  /** Singapore local time as YYYYMMDDTHHMMSS. */
  end: string;
  location: string;
  url?: string;
  description: string;
  displayDate: string;
  displayTime: string;
  /** The start as epoch milliseconds. */
  sortKey: number;
}

function parseDate(text: string | undefined): [year: number, month: number, day: number] | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((text ?? '').trim());
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return [year, month, day];
}

function parseTime(text: string | undefined): [hour: number, minute: number] | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((text ?? '').trim());
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  const minute = Number(match[2]);
  if (minute > 59) return null;
  return [hour, minute];
}

const padToTwoDigits = (value: number) => String(value).padStart(2, '0');

// Holds a Singapore wall-clock time in the UTC fields of a Date, so that adding
// to it carries past midnight into the next day. The TZID on the DTSTART and
// DTEND properties is what gives the time its zone.
function buildWallClockDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

function formatLocalTimestamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${padToTwoDigits(date.getUTCMonth() + 1)}${padToTwoDigits(date.getUTCDate())}` +
    `T${padToTwoDigits(date.getUTCHours())}${padToTwoDigits(date.getUTCMinutes())}00`
  );
}

function formatUtcTimestamp(date: Date): string {
  return `${formatLocalTimestamp(date).slice(0, -2)}${padToTwoDigits(date.getUTCSeconds())}Z`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatClockLabel(date: Date): string {
  const hour = date.getUTCHours();
  return `${hour % 12 === 0 ? 12 : hour % 12}:${padToTwoDigits(date.getUTCMinutes())} ${hour < 12 ? 'am' : 'pm'}`;
}

interface ZoomDetails {
  url?: string;
  meetingId?: string;
  passcode?: string;
}

// The URL is read from the raw markup, because CDC puts it in a button's
// onclick attribute. The meeting ID and passcode are read from the text with
// the tags removed, because each label is followed by a `<font size="4">` tag
// whose digits would otherwise match.
function parseZoomDetails(html: string | null | undefined): ZoomDetails {
  if (!html) return {};
  const url = /https:\/\/[\w.-]*zoom\.us\/[^\s'"<>\\]+/i.exec(html)?.[0];

  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
  const meetingId = /Meeting\s*ID:\s*(\d[\d\s]{7,18}\d)/i.exec(text)?.[1].trim();
  const passcode = /Passcode:\s*([A-Za-z0-9]{4,20})/i.exec(text)?.[1];
  return { url, meetingId, passcode };
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Moves the cut back off a UTF-8 continuation byte, so that no character
    // is split.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
    // A continuation line starts with a space, which counts towards its 75.
    limit = 74;
  }
  return parts.join('\r\n ');
}

async function computeShortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function formatBranchLocation(branch: string): string {
  if (!branch) return DEFAULT_LOCATION;
  return BRANCH_ADDRESSES[branch.toUpperCase()] ?? `ComfortDelGro Driving Centre (${branch})`;
}

function readAllocation(booking: Booking): (key: string) => string {
  const allocation = booking.allocation ?? {};
  return (key) => {
    const value = allocation[key];
    return typeof value === 'string' ? value.trim() : '';
  };
}

/** Returns null for a booking without a date and start time it can parse. */
export async function buildEvent(booking: Booking): Promise<CalendarEvent | null> {
  const date = parseDate(booking.SesDate);
  const startTime = parseTime(booking.SesStartTime);
  if (!date || !startTime) return null;

  const [year, month, day] = date;
  const [startHour, startMinute] = startTime;
  const start = buildWallClockDate(year, month, day, startHour, startMinute);

  // An end time that is missing or not after the start gives a one-hour event,
  // which for a late-evening booking ends on the following day.
  const endTime = parseTime(booking.SesEndtime ?? booking.SesEndTime);
  const end =
    endTime && endTime[0] * 60 + endTime[1] > startHour * 60 + startMinute
      ? buildWallClockDate(year, month, day, endTime[0], endTime[1])
      : new Date(start.getTime() + DEFAULT_DURATION_IN_MS);

  const code = (booking.ResasmblyId ?? '').trim();
  const zoom = parseZoomDetails(booking.ZoomDetails);
  const allocation = readAllocation(booking);
  const instructor = (booking.instructor_name || booking.fixed_instructor_name || allocation('InstrName')).trim();

  const notes: string[] = [];
  if (allocation('sector')) notes.push(`Report to: ${allocation('sector')}`);
  else if (allocation('pickup_point')) notes.push(`Report to: ${allocation('pickup_point')}`);
  if (allocation('carno')) notes.push(`Vehicle: ${allocation('carno')}`);
  if (instructor) notes.push(`Instructor: ${instructor}`);
  if (zoom.url) notes.push(`Zoom: ${zoom.url}`);
  if (zoom.meetingId) notes.push(`Meeting ID: ${zoom.meetingId}`);
  if (zoom.passcode) notes.push(`Passcode: ${zoom.passcode}`);
  if (booking.TicketNo) notes.push(`Ticket: ${booking.TicketNo}`);
  const map = booking.allocation_map_link || allocation('car_map');
  if (map) notes.push(`Map: ${map}`);

  const ticket = booking.TicketNo?.trim();
  const uid = `${ticket || (await computeShortHash(`${code} ${booking.SesDate} ${booking.SesStartTime}`))}@mycdc`;

  return {
    uid,
    summary: code || 'CDC Booking',
    start: formatLocalTimestamp(start),
    end: formatLocalTimestamp(end),
    location: zoom.url ? 'Zoom' : formatBranchLocation(allocation('branch')),
    url: zoom.url,
    description: notes.join('\n'),
    displayDate: `${WEEKDAYS[start.getUTCDay()]} ${day} ${MONTHS[month - 1]} ${year}`,
    displayTime: `${formatClockLabel(start)} to ${formatClockLabel(end)}`,
    sortKey: start.getTime() - SINGAPORE_OFFSET_IN_MS,
  };
}

export async function buildEvents(bookings: Booking[]): Promise<CalendarEvent[]> {
  const events = await Promise.all(bookings.map(buildEvent));
  return events
    .filter((event): event is CalendarEvent => event !== null)
    .sort((first, second) => first.sortKey - second.sortKey);
}

export interface BuildCalendarOptions {
  /** Minutes before each booking that its reminder fires; 0 gives no reminder. Defaults to 60. */
  alarmInMinutes?: number;
}

export function buildCalendar(events: CalendarEvent[], options: BuildCalendarOptions = {}): string {
  const { alarmInMinutes = 60 } = options;
  const now = formatUtcTimestamp(new Date());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(CALENDAR_NAME)}`,
    `X-WR-TIMEZONE:${TZID}`,
    'X-APPLE-CALENDAR-COLOR:#1A6CF0',
    // iOS and Google Calendar treat the interval as a hint. macOS Calendar
    // ignores it and uses the Auto-refresh interval the subscriber picks.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    // Singapore has kept +08:00 with no daylight saving since 1982, so one
    // STANDARD component describes the zone.
    'BEGIN:VTIMEZONE',
    `TZID:${TZID}`,
    'X-LIC-LOCATION:Asia/Singapore',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:+08',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=${TZID}:${event.start}`,
      `DTEND;TZID=${TZID}:${event.end}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `LOCATION:${escapeText(event.location)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
    );
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.url) lines.push(`URL;VALUE=URI:${event.url}`);
    if (alarmInMinutes > 0) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(event.summary)}`,
        `TRIGGER:-PT${alarmInMinutes}M`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
