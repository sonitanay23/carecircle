/**
 * Time-zone helpers built on Intl (no date library). Medication times are
 * stored as local wall-clock times ("08:00") in the elder's time zone and
 * converted to UTC instants when needed, which handles daylight saving.
 */

const formatterCache = new Map();
const partsFormatter = (timeZone) => {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return formatterCache.get(timeZone);
};

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(ms, timeZone) {
  const parts = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(new Date(ms))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  return parts; // { year, month, day, hour, minute, second }
}

/** Offset of the time zone from UTC at that instant, in ms. */
function offsetMs(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for the instant, as seen in the time zone. */
export function localDate(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 'HH:MM' for the instant, as seen in the time zone. */
export function localTime(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Converts a local date + 'HH:MM' in a time zone to a UTC epoch ms. */
export function zonedToUtc(date, time, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(guess, timeZone);
  // Re-check once: the offset can differ either side of a DST change.
  const second = guess - offsetMs(first, timeZone);
  return second;
}

export function addDays(date, days) {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Formats an instant for a person in their own time zone, e.g. "Sun 15 Nov, 8:00 pm". */
export function formatForPerson(ms, timeZone, locale = 'en-IN') {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}
