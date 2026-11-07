// Skunk Watch: the activity model.
//
// Pure functions only. No DOM, no network, no globals, no dependencies, so this
// file runs unchanged under Node for tests, in the browser, and in any future
// native wrapper. See SPEC.md for the rules this file must not break.
//
// The output is one-directional by design: 'high' and 'elevated' are warnings,
// 'quiet' is the absence of one. Nothing here ever reports an all-clear,
// because the weights below are informed guesses, not calibrated estimates.

const rad = Math.PI / 180;
const OBLIQUITY = rad * 23.4397;
const SUN_ALTITUDE = rad * -0.833; // refraction-corrected horizon

// ---------------------------------------------------------------------------
// Sun position. Standard low-precision solar equations, accurate to well under
// a minute for sunrise and sunset, which is far better than this model needs.
// ---------------------------------------------------------------------------

const toJulian = (date) => date.valueOf() / 86400000 - 0.5 + 2440588;
const fromJulian = (j) => new Date((j + 0.5 - 2440588) * 86400000);
const toDays = (date) => toJulian(date) - 2451545;

const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);

function eclipticLongitude(M) {
  const center = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const perihelion = rad * 102.9372;
  return M + center + perihelion + Math.PI;
}

const declination = (L) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));

// Hour angle at the target altitude. NaN when the sun never reaches it, which
// is how polar day and polar night announce themselves.
function hourAngle(h, phi, dec) {
  const cosW = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  return Math.acos(cosW);
}

const J0 = 0.0009;
const solarTransitJ = (ds, M, L) =>
  2451545 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

// Sunrise and sunset for the solar day containing `date`, at lat/lon.
// Returns nulls plus a polar flag when the sun does not cross the horizon.
function sunTimes(date, lat, lon) {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + (0 + lw) / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const jNoon = solarTransitJ(ds, M, L);

  const w = hourAngle(SUN_ALTITUDE, phi, dec);
  if (Number.isNaN(w)) {
    // Sun never crosses the horizon. Compare its altitude at local noon to
    // decide which way: above means polar day, below means polar night.
    const noonAltitude = Math.asin(
      Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec)
    );
    return { sunrise: null, sunset: null, polar: noonAltitude > SUN_ALTITUDE ? 'day' : 'night' };
  }

  const jSet = solarTransitJ(J0 + (w + lw) / (2 * Math.PI) + n, M, L);
  const jRise = jNoon - (jSet - jNoon);
  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet), polar: null };
}

// ---------------------------------------------------------------------------
// Factor 1: time of day. The dominant term.
//
// Striped skunks are crepuscular and nocturnal. Activity climbs through the
// hour before sunset, holds overnight, and falls off around sunrise. Daylight
// never reaches zero because skunks do sometimes move by day, but it is held
// low enough that no daytime hour in any season can outscore a night hour.
// ---------------------------------------------------------------------------

const DAY_FLOOR = 0.05;
const RAMP_BEFORE = 60; // minutes before sunset that activity starts climbing
const RAMP_AFTER = 30;  // minutes after sunset that it reaches full

const MIN = 60000;
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

function diurnalFactor(t, lat, lon) {
  const today = sunTimes(t, lat, lon);
  if (today.polar === 'night') return { value: 1, note: 'Polar night, no daylight' };
  if (today.polar === 'day') return { value: DAY_FLOOR, note: 'Polar day, continuous daylight' };

  let lastSunset = today.sunset;
  let nextSunrise = today.sunrise;

  if (t < today.sunrise) {
    // Pre-dawn: the relevant sunset was yesterday's.
    lastSunset = sunTimes(new Date(t.valueOf() - 86400000), lat, lon).sunset;
  } else if (t > today.sunset) {
    // After dark: the relevant sunrise is tomorrow's.
    nextSunrise = sunTimes(new Date(t.valueOf() + 86400000), lat, lon).sunrise;
  } else {
    // Daylight. Climb only once sunset is close.
    const minsToSunset = (today.sunset - t) / MIN;
    if (minsToSunset <= RAMP_BEFORE) {
      return {
        value: lerp(DAY_FLOOR, 1, (RAMP_BEFORE - minsToSunset) / (RAMP_BEFORE + RAMP_AFTER)),
        note: `Sunset is in ${Math.round(minsToSunset)} minutes`,
      };
    }
    return { value: DAY_FLOOR, note: 'Daylight hours' };
  }

  const minsAfterSunset = (t - lastSunset) / MIN;
  const minsToSunrise = (nextSunrise - t) / MIN;

  if (minsAfterSunset <= RAMP_AFTER) {
    return {
      value: lerp(DAY_FLOOR, 1, (RAMP_BEFORE + minsAfterSunset) / (RAMP_BEFORE + RAMP_AFTER)),
      note: `Sunset was ${Math.round(minsAfterSunset)} minutes ago`,
    };
  }
  if (minsToSunrise <= RAMP_BEFORE + RAMP_AFTER) {
    return {
      value: lerp(1, DAY_FLOOR, (RAMP_BEFORE + RAMP_AFTER - minsToSunrise) / (RAMP_BEFORE + RAMP_AFTER)),
      note: `Sunrise is in ${Math.round(minsToSunrise)} minutes`,
    };
  }
  return { value: 1, note: 'After dark' };
}

// ---------------------------------------------------------------------------
// Factor 2: season. Two peaks over a year-round baseline.
//
// LOWEST-CONFIDENCE PART OF THE MODEL. The breeding peak shifts earlier at
// lower latitudes, and the 1.4 days-per-degree slope below is an interpolation
// from the February-to-March window reported around 43N, not a fitted value.
// Revisit once there is observational data to check it against.
// ---------------------------------------------------------------------------

const SEASON_BASELINE = 0.55;
const SEASON_AMPLITUDE = 0.45;
const BREEDING_DAY_AT_43N = 56;   // ~25 February
const BREEDING_SHIFT_PER_DEG = 1.4;
const BREEDING_WIDTH = 25;
const DISPERSAL_DAY = 250;        // ~7 September
const DISPERSAL_WIDTH = 35;
const FACTOR_MENTION_THRESHOLD = 0.15; // below this, a peak is not worth naming

const YEAR = 365.25;

function circularDistance(a, b) {
  const d = Math.abs(a - b) % YEAR;
  return Math.min(d, YEAR - d);
}

const bump = (day, centre, width) =>
  Math.exp(-0.5 * (circularDistance(day, centre) / width) ** 2);

function breedingCentre(lat) {
  return BREEDING_DAY_AT_43N + (lat - 43) * BREEDING_SHIFT_PER_DEG;
}

function seasonFactor(dayOfYear, lat) {
  const breeding = bump(dayOfYear, breedingCentre(lat), BREEDING_WIDTH);
  const dispersal = bump(dayOfYear, DISPERSAL_DAY, DISPERSAL_WIDTH);
  const peak = Math.max(breeding, dispersal);
  const notes = [];
  if (breeding >= FACTOR_MENTION_THRESHOLD) notes.push('Breeding season, when males roam widely');
  if (dispersal >= FACTOR_MENTION_THRESHOLD) notes.push('Dispersal season, when juveniles wander');
  return { value: SEASON_BASELINE + SEASON_AMPLITUDE * peak, notes };
}

// ---------------------------------------------------------------------------
// Factor 3: temperature, and a nudge for recent rain.
//
// Temperature rather than calendar month is what suppresses winter activity.
// Skunks spend cold stretches denned in torpor and come out during mild spells,
// so a February thaw scores like autumn. Driving it this way also makes the
// model self-adjust for latitude, elevation, and unusual years.
// ---------------------------------------------------------------------------

const THERMAL_CURVE = [
  [-25, 0.05], [-15, 0.12], [-5, 0.50], [0, 0.75],
  [5, 0.95], [10, 1.00], [25, 1.00], [32, 0.85], [40, 0.70],
];

function interpolate(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

function thermalFactor(tempC) {
  const value = interpolate(THERMAL_CURVE, tempC);
  const notes = [];
  if (tempC <= -10) notes.push(`${Math.round(tempC)}C, cold enough that skunks stay denned`);
  else if (tempC <= 0) notes.push(`${Math.round(tempC)}C, cold enough to keep most skunks in`);
  else if (tempC >= 30) notes.push(`${Math.round(tempC)}C, hot enough to shorten foraging`);
  return { value, notes };
}

// Damp soil makes grub digging worthwhile, so recent rain is a modest boost.
// Multiplicative and capped, so it can never lift a daytime hour above a night.
const RAIN_MAX_BOOST = 0.15;

function rainFactor(precipMm24h) {
  const mm = Math.max(0, precipMm24h ?? 0);
  const value = 1 + RAIN_MAX_BOOST * Math.min(1, mm / 5);
  return {
    value,
    notes: mm >= 1 ? [`${mm.toFixed(0)} mm of rain in the last day, good grub foraging`] : [],
  };
}

// ---------------------------------------------------------------------------
// Range check. Skunks are a New World family; there are none in Europe, Asia,
// Africa or Australia. A bounding box is enough until real range maps land.
// ---------------------------------------------------------------------------

const NORTH_AMERICA = { minLat: 14, maxLat: 72, minLon: -170, maxLon: -52 };

const inRange = (lat, lon) =>
  lat >= NORTH_AMERICA.minLat && lat <= NORTH_AMERICA.maxLat &&
  lon >= NORTH_AMERICA.minLon && lon <= NORTH_AMERICA.maxLon;

// ---------------------------------------------------------------------------
// Thresholds. Tuned so that the only two outcomes a user ever sees are a
// warning and silence. Raising HIGH makes the app quieter, never more
// reassuring.
// ---------------------------------------------------------------------------

const HIGH = 0.70;
const ELEVATED = 0.30;

// ---------------------------------------------------------------------------
// Date helpers that respect the offset supplied in the input timestamp, so
// results never depend on the machine's own timezone.
// ---------------------------------------------------------------------------

function offsetMinutesOf(timestampISO) {
  const m = /(?:Z|([+-])(\d{2}):?(\d{2}))$/.exec(timestampISO.trim());
  if (!m) return null; // no offset given: fall back to the host's local time
  if (!m[1]) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function dayOfYear(date, offsetMin) {
  const shifted = new Date(date.valueOf() + offsetMin * MIN);
  const start = Date.UTC(shifted.getUTCFullYear(), 0, 1);
  return Math.floor((shifted.valueOf() - start) / 86400000) + 1;
}

function formatInOffset(date, offsetMin) {
  if (!date) return null;
  const shifted = new Date(date.valueOf() + offsetMin * MIN);
  const pad = (n) => String(n).padStart(2, '0');
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// ---------------------------------------------------------------------------
// Public entry point.
//
// assess({lat, lon, timestampISO, tempC, precipMm24h})
//   -> { level, factors, score, sunsetISO, sunriseISO }
//
// `score` is internal. It exists so the tests can assert orderings that must
// hold however the weights are tuned. It is never displayed and never logged.
// ---------------------------------------------------------------------------

export function assess({ lat, lon, timestampISO, tempC, precipMm24h = 0 }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new TypeError('assess: lat and lon must be finite numbers');
  }
  if (!Number.isFinite(tempC)) {
    throw new TypeError('assess: tempC must be a finite number');
  }
  const t = new Date(timestampISO);
  if (Number.isNaN(t.valueOf())) {
    throw new TypeError(`assess: unparseable timestampISO "${timestampISO}"`);
  }

  const offsetMin = offsetMinutesOf(timestampISO) ?? -t.getTimezoneOffset();
  const times = sunTimes(t, lat, lon);

  if (!inRange(lat, lon)) {
    return {
      level: 'quiet',
      outOfRange: true,
      factors: ['No skunk species range at this location'],
      score: 0,
      sunsetISO: formatInOffset(times.sunset, offsetMin),
      sunriseISO: formatInOffset(times.sunrise, offsetMin),
    };
  }

  const diurnal = diurnalFactor(t, lat, lon);
  const season = seasonFactor(dayOfYear(t, offsetMin), lat);
  const thermal = thermalFactor(tempC);
  const rain = rainFactor(precipMm24h);

  const score = diurnal.value * season.value * thermal.value * rain.value;
  const level = score >= HIGH ? 'high' : score >= ELEVATED ? 'elevated' : 'quiet';

  return {
    level,
    outOfRange: false,
    factors: [diurnal.note, ...season.notes, ...thermal.notes, ...rain.notes],
    score,
    sunsetISO: formatInOffset(times.sunset, offsetMin),
    sunriseISO: formatInOffset(times.sunrise, offsetMin),
  };
}

// Exported for tests and for anyone checking the model's shape. Not for the UI.
export const internals = {
  sunTimes, diurnalFactor, seasonFactor, thermalFactor, rainFactor,
  breedingCentre, HIGH, ELEVATED, DAY_FLOOR,
};

// ---------------------------------------------------------------------------
// Timeline. The same model evaluated across the hours ahead, so the page can
// show when the evening rise starts rather than only answering "right now".
//
// Pure, like everything else here: the caller supplies temperature through a
// lookup function so this file still makes no network requests.
// ---------------------------------------------------------------------------

export function timeline({
  lat, lon, startISO, hours = 18, stepMinutes = 15, temperatureAt, precipMm24h = 0,
}) {
  if (typeof temperatureAt !== 'function') {
    throw new TypeError('timeline: temperatureAt must be a function');
  }
  const offsetMin = offsetMinutesOf(startISO);
  if (offsetMin === null) {
    throw new TypeError('timeline: startISO must carry an explicit UTC offset');
  }
  const start = new Date(startISO);
  if (Number.isNaN(start.valueOf())) {
    throw new TypeError(`timeline: unparseable startISO "${startISO}"`);
  }

  const steps = Math.round((hours * 60) / stepMinutes);
  const segments = [];
  for (let i = 0; i < steps; i++) {
    const timestampISO = formatInOffset(new Date(start.valueOf() + i * stepMinutes * MIN), offsetMin);
    const tempC = temperatureAt(timestampISO);
    // A gap in the forecast is left as a gap. Interpolating would invent data.
    if (!Number.isFinite(tempC)) continue;
    const { level, score } = assess({ lat, lon, timestampISO, tempC, precipMm24h });
    segments.push({ timestampISO, level, score });
  }
  return segments;
}

const LEVEL_RANK = { quiet: 0, elevated: 1, high: 2 };

// The contiguous run at the highest level the window reaches, or null when the
// window holds no warning at all. Used for the one-line summary on the page.
export function peakWindow(segments) {
  if (!segments.length) return null;
  const top = segments.reduce((max, s) => Math.max(max, LEVEL_RANK[s.level] ?? 0), 0);
  if (top === 0) return null;
  const level = Object.keys(LEVEL_RANK).find((k) => LEVEL_RANK[k] === top);
  const first = segments.findIndex((s) => s.level === level);
  let last = first;
  while (last + 1 < segments.length && segments[last + 1].level === level) last++;
  return { level, startISO: segments[first].timestampISO, endISO: segments[last].timestampISO };
}
