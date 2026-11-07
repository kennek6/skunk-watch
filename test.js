// Skunk Watch: tests for the scoring model.
// Run with: node test.js
//
// These assertions are the specification. They are written to be checkable by
// reading them, without reading risk.js. Every timestamp carries an explicit
// UTC offset so results do not depend on the machine's timezone.
//
// Hamilton, ON. Approximate sunsets from memory, NOT a verified source. Check one
// of these against timeanddate.com yourself; that is the stage 1 gate.
//   2026-01-20  17:15 EST      2026-02-25  17:55 EST
//   2026-07-04  21:02 EDT      2026-10-15  18:35 EDT

import { assess, timeline, peakWindow } from './risk.js';
import { encodeGeohash, geohashBounds, cellSizeMetres, regionsForBounds, PRECISION } from './geo.js';
import { agoHoursFor, describeAge, WHEN_OPTIONS, MAX_AGO_HOURS } from './when.js';

const HAMILTON = { lat: 43.26, lon: -79.87 };
const FAIRBANKS = { lat: 64.84, lon: -147.72 };
const AUSTIN = { lat: 30.27, lon: -97.74 };

// Expected level for each named condition. "quiet" means the app shows no
// warning at all; it is never a reassurance that nothing is out there.
const cases = [
  {
    label: 'Oct evening, past sunset, dispersal season, mild and damp',
    ...HAMILTON, timestampISO: '2026-10-15T19:30:00-04:00',
    tempC: 12, precipMm24h: 4, expect: 'high',
  },
  {
    label: 'Jan afternoon, broad daylight, deep cold',
    ...HAMILTON, timestampISO: '2026-01-20T14:00:00-05:00',
    tempC: -12, precipMm24h: 0, expect: 'quiet',
  },
  {
    label: 'Feb evening, past sunset, breeding season, mild',
    ...HAMILTON, timestampISO: '2026-02-25T19:00:00-05:00',
    tempC: 8, precipMm24h: 0, expect: 'high',
  },
  {
    label: 'Feb evening, past sunset, breeding season, but -18C and denned',
    ...HAMILTON, timestampISO: '2026-02-25T19:00:00-05:00',
    tempC: -18, precipMm24h: 0, expect: 'quiet',
  },
  {
    label: 'Jul midday',
    ...HAMILTON, timestampISO: '2026-07-04T13:00:00-04:00',
    tempC: 26, precipMm24h: 0, expect: 'quiet',
  },
  {
    label: 'Jul evening, just past sunset, no seasonal peak',
    ...HAMILTON, timestampISO: '2026-07-04T21:30:00-04:00',
    tempC: 22, precipMm24h: 0, expect: 'elevated',
  },
];

// Orderings on the continuous internal score. These must hold no matter how the
// weights are later tuned, so they are the real guard against silent drift.
const orderings = [
  {
    label: 'mild February night scores above a frigid one',
    a: { ...HAMILTON, timestampISO: '2026-02-25T19:00:00-05:00', tempC: 8, precipMm24h: 0 },
    b: { ...HAMILTON, timestampISO: '2026-02-25T19:00:00-05:00', tempC: -18, precipMm24h: 0 },
  },
  {
    label: 'after sunset scores above the same day at midday',
    a: { ...HAMILTON, timestampISO: '2026-10-15T19:30:00-04:00', tempC: 12, precipMm24h: 0 },
    b: { ...HAMILTON, timestampISO: '2026-10-15T13:00:00-04:00', tempC: 12, precipMm24h: 0 },
  },
  {
    label: 'recent rain scores above dry, all else equal',
    a: { ...HAMILTON, timestampISO: '2026-10-15T19:30:00-04:00', tempC: 12, precipMm24h: 4 },
    b: { ...HAMILTON, timestampISO: '2026-10-15T19:30:00-04:00', tempC: 12, precipMm24h: 0 },
  },
  {
    label: 'dispersal-season night scores above a midsummer night',
    a: { ...HAMILTON, timestampISO: '2026-09-20T21:00:00-04:00', tempC: 15, precipMm24h: 0 },
    b: { ...HAMILTON, timestampISO: '2026-06-20T23:00:00-04:00', tempC: 15, precipMm24h: 0 },
  },
];

let failures = 0;
const row = (a, b, c, d) =>
  `  ${a.padEnd(62)} ${b.padEnd(9)} ${c.padEnd(9)} ${d}`;

console.log('\nLevel cases (Hamilton, ON)\n');
console.log(row('condition', 'expected', 'got', ''));
for (const c of cases) {
  const r = assess(c);
  const ok = r.level === c.expect;
  if (!ok) failures++;
  console.log(row(c.label, c.expect, r.level, ok ? 'PASS' : 'FAIL'));
}

console.log('\nComputed sunsets, to cross-check against the values above\n');
// Offsets match the published values in the header: EST in winter, EDT in summer.
for (const [iso, off, published] of [
  ['2026-01-20', '-05:00', '17:15 EST'],
  ['2026-02-25', '-05:00', '17:55 EST'],
  ['2026-07-04', '-04:00', '21:02 EDT'],
  ['2026-10-15', '-04:00', '18:35 EDT'],
]) {
  const r = assess({ ...HAMILTON, timestampISO: `${iso}T12:00:00${off}`, tempC: 5, precipMm24h: 0 });
  console.log(`  ${iso}  computed ${r.sunsetISO}   approx ${published}`);
}

console.log('\nOrderings on the internal score\n');
for (const o of orderings) {
  const sa = assess(o.a).score;
  const sb = assess(o.b).score;
  const ok = sa > sb;
  if (!ok) failures++;
  console.log(row(o.label, 'a > b', `${sa.toFixed(3)} vs ${sb.toFixed(3)}`, ok ? 'PASS' : 'FAIL'));
}

// The strongest structural claim in the model: time of day dominates season and
// weather. No daytime hour in any season may outscore any post-sunset hour.
console.log('\nTime of day dominates every other factor\n');
{
  const months = ['01', '02', '04', '06', '08', '10', '12'];
  const dayScores = months.map((m) =>
    assess({ ...HAMILTON, timestampISO: `2026-${m}-15T13:00:00-05:00`, tempC: 10, precipMm24h: 5 }).score);
  const nightScores = months.map((m) =>
    assess({ ...HAMILTON, timestampISO: `2026-${m}-15T23:00:00-05:00`, tempC: 10, precipMm24h: 0 }).score);
  const worstDay = Math.max(...dayScores);
  const bestNight = Math.min(...nightScores);
  const ok = worstDay < bestNight;
  if (!ok) failures++;
  console.log(row('highest daytime score < lowest night score', 'yes',
    `${worstDay.toFixed(3)} vs ${bestNight.toFixed(3)}`, ok ? 'PASS' : 'FAIL'));
}

console.log('\nLatitude generality\n');
{
  const far = assess({ ...FAIRBANKS, timestampISO: '2026-10-15T20:00:00-08:00', tempC: -2, precipMm24h: 0 });
  const aus = assess({ ...AUSTIN, timestampISO: '2026-10-15T20:00:00-05:00', tempC: 24, precipMm24h: 0 });
  for (const [name, r] of [['Fairbanks 64N', far], ['Austin 30N', aus]]) {
    const ok = ['quiet', 'elevated', 'high'].includes(r.level);
    if (!ok) failures++;
    console.log(row(`${name} returns a valid level`, 'valid', r.level, ok ? 'PASS' : 'FAIL'));
  }

  // Breeding peaks earlier at lower latitudes, so a late-January night should
  // already be in breeding season in Austin but not yet in Fairbanks.
  const janFar = assess({ ...FAIRBANKS, timestampISO: '2026-01-25T22:00:00-09:00', tempC: 2, precipMm24h: 0 });
  const janAus = assess({ ...AUSTIN, timestampISO: '2026-01-25T22:00:00-06:00', tempC: 14, precipMm24h: 0 });
  const breeding = (r) => r.factors.some((f) => /breeding/i.test(f));
  const ok = breeding(janAus) && !breeding(janFar);
  if (!ok) failures++;
  console.log(row('late Jan is breeding season at 30N but not at 64N', 'yes',
    `${breeding(janAus)} / ${breeding(janFar)}`, ok ? 'PASS' : 'FAIL'));
}

// A quiet result must never contain reassuring language. The app warns or stays
// silent; it has no vocabulary for an all-clear.
console.log('\nOutput is one-directional\n');
{
  const banned = /\b(safe|all ?clear|no risk|low risk|minimal|unlikely|fine|ok to)\b/i;
  const offenders = [];
  for (const c of cases) {
    const r = assess(c);
    for (const f of r.factors) if (banned.test(f)) offenders.push(`${r.level}: "${f}"`);
    if (!['quiet', 'elevated', 'high'].includes(r.level)) offenders.push(`bad level: ${r.level}`);
  }
  const ok = offenders.length === 0;
  if (!ok) failures++;
  console.log(row('no reassuring wording in any factor', 'none',
    offenders.length ? offenders.join('; ') : 'none', ok ? 'PASS' : 'FAIL'));
}


// ---------------------------------------------------------------------------
// Timeline: the score across the hours ahead, so someone checking at noon can
// see when the evening rise happens instead of reopening the page all day.
// ---------------------------------------------------------------------------

const OCT15_SUNSET_MIN = 18 * 60 + 38; // computed above; see the cross-check
const minutesOf = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

console.log('\nTimeline\n');
{
  const flat = () => 12; // constant 12C, so only time of day and season move
  const segs = timeline({
    ...HAMILTON, startISO: '2026-10-15T12:00:00-04:00',
    hours: 18, stepMinutes: 15, temperatureAt: flat, precipMm24h: 0,
  });

  const check = (label, expected, got, ok) => {
    if (!ok) failures++;
    console.log(row(label, String(expected), String(got), ok ? 'PASS' : 'FAIL'));
  };

  check('18 hours at 15-minute steps yields 72 segments', 72, segs.length, segs.length === 72);
  check('starts quiet at noon', 'quiet', segs[0].level, segs[0].level === 'quiet');

  const firstWarn = segs.find((s) => s.level !== 'quiet');
  const warnAt = firstWarn ? minutesOf(firstWarn.timestampISO) : null;
  check(
    'first warning lands within 75 min either side of sunset',
    `${OCT15_SUNSET_MIN - 75}-${OCT15_SUNSET_MIN + 30} min`,
    warnAt,
    warnAt !== null && warnAt >= OCT15_SUNSET_MIN - 75 && warnAt <= OCT15_SUNSET_MIN + 30
  );

  const peak = peakWindow(segs);
  check('peak band is high', 'high', peak?.level, peak?.level === 'high');
  const peakAt = peak ? minutesOf(peak.startISO) : null;
  check(
    'high begins within an hour after sunset',
    `${OCT15_SUNSET_MIN}-${OCT15_SUNSET_MIN + 60} min`,
    peakAt,
    peakAt !== null && peakAt >= OCT15_SUNSET_MIN && peakAt <= OCT15_SUNSET_MIN + 60
  );

  // Deep cold suppresses the whole night, so no warning should appear at all.
  const frozen = timeline({
    ...HAMILTON, startISO: '2026-10-15T12:00:00-04:00',
    hours: 18, stepMinutes: 15, temperatureAt: () => -20, precipMm24h: 0,
  });
  const anyWarn = frozen.some((s) => s.level !== 'quiet');
  check('a -20C night produces no warning at any hour', false, anyWarn, anyWarn === false);
  check('peakWindow returns null when nothing is flagged', null, peakWindow(frozen), peakWindow(frozen) === null);

  // Hours with no forecast temperature are skipped rather than guessed at.
  const gappy = timeline({
    ...HAMILTON, startISO: '2026-10-15T12:00:00-04:00',
    hours: 4, stepMinutes: 60, temperatureAt: (iso) => (iso.includes('T13:') ? NaN : 12),
  });
  check('segments without a forecast temperature are dropped', 3, gappy.length, gappy.length === 3);
}


// ---------------------------------------------------------------------------
// Grid snapping. These guard the privacy design, so they matter more than the
// model tests: a bug here leaks a street address.
// ---------------------------------------------------------------------------

console.log('\nGrid snapping\n');
{
  const check = (label, expected, got, ok) => {
    if (!ok) failures++;
    console.log(row(label, String(expected), String(got), ok ? 'PASS' : 'FAIL'));
  };

  // The canonical worked example from the geohash literature: 57.64911 N,
  // 10.40744 E encodes to u4pruydqqvj. If our bit order were wrong this fails.
  const ref = encodeGeohash(57.64911, 10.40744, 11);
  check('reference point encodes to u4pruydqqvj', 'u4pruydqqvj', ref, ref === 'u4pruydqqvj');

  const h = encodeGeohash(43.26, -79.87, PRECISION.point);
  const b = geohashBounds(h);
  const contains = 43.26 >= b.minLat && 43.26 <= b.maxLat && -79.87 >= b.minLon && -79.87 <= b.maxLon;
  check('a point falls inside its own cell', true, contains, contains);

  // Snapping must be deterministic. This is the whole reason it is not jitter.
  const repeats = new Set([0, 1, 2].map(() => encodeGeohash(43.26, -79.87, PRECISION.point)));
  check('the same point always yields one cell', 1, repeats.size, repeats.size === 1);

  const p7 = cellSizeMetres(encodeGeohash(43.26, -79.87, 7));
  const ok7 = p7.width > 100 && p7.width < 200 && p7.height > 100 && p7.height < 200;
  check('precision 7 is 100-200 m on a side',
    '100-200 m', `${p7.width.toFixed(0)}x${p7.height.toFixed(0)}`, ok7);

  const p6 = cellSizeMetres(encodeGeohash(43.26, -79.87, PRECISION.display));
  const ok6 = p6.width > 600 && p6.width < 1600 && p6.height > 400 && p6.height < 900;
  check('display precision is 0.6-1.6 km wide',
    '0.6-1.6 km', `${(p6.width / 1000).toFixed(2)}x${(p6.height / 1000).toFixed(2)} km`, ok6);

  // Two houses 2 km apart must not land in the same display cell, or the map
  // would claim a sighting was near someone it was not.
  const far = encodeGeohash(43.28, -79.87, PRECISION.display);
  const near = encodeGeohash(43.26, -79.87, PRECISION.display);
  check('points 2 km apart differ at display precision', true, far !== near, far !== near);

  // A single house address and the same house plus 20 m must collapse together
  // at display precision, which is what hides which house reported.
  const a = encodeGeohash(43.2600, -79.8700, PRECISION.display);
  const c = encodeGeohash(43.2602, -79.8702, PRECISION.display);
  check('neighbouring houses collapse to one display cell', true, a === c, a === c);

  const regions = regionsForBounds({ minLat: 43.2, maxLat: 43.3, minLon: -79.95, maxLon: -79.8 });
  const allRegion = regions.every((r) => r.length === PRECISION.region);
  check('a viewport maps to region cells', `>=1, all length ${PRECISION.region}`,
    `${regions.length} cells`, regions.length >= 1 && allRegion);

  let threw = false;
  try { encodeGeohash(95, 0, 7); } catch { threw = true; }
  check('an out-of-range latitude is rejected', true, threw, threw);
}


// ---------------------------------------------------------------------------
// Backdating. A report about last night must not read as happening now, and
// must count toward the right day. These are local-time cases, so the tests
// build Date objects in the host timezone on purpose.
// ---------------------------------------------------------------------------

console.log('\nWhen a sighting happened\n');
{
  const check = (label, expected, got, ok) => {
    if (!ok) failures++;
    console.log(row(label, String(expected), String(got), ok ? 'PASS' : 'FAIL'));
  };

  const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

  check('"just now" is zero hours', 0, agoHoursFor('now', at(2026, 11, 7, 18, 7)),
    agoHoursFor('now', at(2026, 11, 7, 18, 7)) === 0);

  // Reporting on Saturday evening, last night is Friday 22:00.
  const evening = agoHoursFor('lastnight', at(2026, 11, 7, 18, 7));
  check('reporting at 18:07, "last night" is ~20 h back', 20, evening, evening === 20);

  // Reporting at 02:00, last night is four hours earlier, not 28.
  const smallHours = agoHoursFor('lastnight', at(2026, 11, 8, 2, 0));
  check('reporting at 02:00, "last night" is 4 h back', 4, smallHours, smallHours === 4);

  // "Earlier today" must never reach back past local midnight.
  for (const [hour, expected] of [[18, 6], [8, 6], [3, 3], [1, 1], [0, 0]]) {
    const got = agoHoursFor('today', at(2026, 11, 7, hour, 30));
    check(`"earlier today" at ${String(hour).padStart(2, '0')}:30 stays inside today`,
      expected, got, got === expected);
  }

  const crossesMidnight = [0, 1, 3, 8, 18].some((h) =>
    agoHoursFor('today', at(2026, 11, 7, h, 30)) > h + 1);
  check('"earlier today" never crosses midnight', false, crossesMidnight, crossesMidnight === false);

  for (const o of WHEN_OPTIONS) {
    const v = agoHoursFor(o.id, at(2026, 11, 7, 18, 7));
    const ok = Number.isInteger(v) && v >= 0 && v <= MAX_AGO_HOURS;
    check(`"${o.label}" is a whole number of hours within a week`, `0-${MAX_AGO_HOURS}`, v, ok);
  }

  let threw = false;
  try { agoHoursFor('whenever'); } catch { threw = true; }
  check('an unknown option is rejected', true, threw, threw);

  const now = new Date('2026-11-07T23:30:00Z');
  for (const [stamp, expected] of [
    ['2026-11-07T23', 'within the hour'],
    ['2026-11-07T20', '3 h ago'],
    ['2026-11-06T22', 'yesterday'],
    ['2026-11-04T22', '3 days ago'],
  ]) {
    const got = describeAge(stamp, now);
    check(`${stamp} reads as "${expected}"`, expected, got, got === expected);
  }
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
