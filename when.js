// Skunk Watch: when something was seen.
//
// A report made at 18:00 about last night's skunk must not land in the live
// tier as happening now, and must count toward yesterday's totals rather than
// today's. The choices are a fixed set rather than a free date picker: a time
// control invites minute precision the rest of the design throws away, and the
// honest resolution here is "roughly when".
//
// Pure functions, so the awkward cases (reporting at 02:00, reporting at 07:00)
// are testable rather than hoped about.

export const WHEN_OPTIONS = [
  { id: 'now', label: 'Just now' },
  { id: 'today', label: 'Earlier today' },
  { id: 'lastnight', label: 'Last night' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'earlier', label: 'Earlier this week' },
];

export const MAX_AGO_HOURS = 168; // a week; older than this is baseline data

const HOUR_MS = 3600000;
const NIGHT_HOUR = 22; // what "last night" is anchored to, local time

// Whole hours since the most recent local occurrence of an hour that has
// already passed. Reporting at 18:00 Saturday, "last night" means 22:00 on
// Friday; reporting at 02:00 Sunday it means 22:00 on Saturday, four hours
// earlier. A fixed offset would get one of those badly wrong.
function hoursSinceMostRecent(hour, now) {
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (target.valueOf() > now.valueOf()) target.setDate(target.getDate() - 1);
  return Math.max(0, Math.round((now.valueOf() - target.valueOf()) / HOUR_MS));
}

function hoursSinceLocalMidnight(now) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return Math.floor((now.valueOf() - midnight.valueOf()) / HOUR_MS);
}

export function agoHoursFor(id, now = new Date()) {
  switch (id) {
    case 'now':
      return 0;
    // Clamped so "earlier today" can never reach back past local midnight,
    // which would make it mean last night instead.
    case 'today':
      return Math.min(6, hoursSinceLocalMidnight(now));
    case 'lastnight':
      return hoursSinceMostRecent(NIGHT_HOUR, now);
    case 'yesterday':
      return 24;
    case 'earlier':
      return 72;
    default:
      throw new RangeError(`agoHoursFor: unknown option "${id}"`);
  }
}

// How a stored observation reads on the map. Input is the UTC hour bucket the
// API returns, 'YYYY-MM-DDTHH'. Deliberately vague, matching the resolution
// that is actually stored.
export function describeAge(observedHourUTC, now = new Date()) {
  const observed = new Date(`${observedHourUTC}:00:00Z`);
  if (Number.isNaN(observed.valueOf())) return 'recently';
  const hours = Math.floor((now.valueOf() - observed.valueOf()) / HOUR_MS);
  if (hours < 0) return 'just now';
  if (hours < 1) return 'within the hour';
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
