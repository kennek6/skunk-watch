// Skunk Watch: the reporting API.
//
// Two jobs. Take a report, snap it to a grid cell, throw the coordinate away.
// Serve a whole region's cells so the client can filter locally and never has
// to tell the server where the viewer is.
//
// Endpoints:
//   POST /api/report        {lat, lon, type, underStructure, deviceKey}
//   GET  /api/region/:gh4   cells and counts for one city-sized box
//   GET  /api/health
//
// See SPEC.md. The non-negotiables in it are enforced here, not just described.

import { encodeGeohash, PRECISION } from './geo.js';

const TYPES = new Set(['saw_live', 'smelled_fresh', 'smelled_faint', 'found_roadkill']);

// Smell carries much further than sight, so it is stored at a coarser cell.
const STORED_PRECISION = {
  saw_live: PRECISION.point,
  found_roadkill: PRECISION.point,
  smelled_fresh: PRECISION.diffuse,
  smelled_faint: PRECISION.diffuse,
};

const LIVE_SECONDS = 48 * 3600;
const RECENT_DAYS = 30;
const ROADKILL_SUPPRESS_SECONDS = 7 * 86400;

// Rate limits, per device. Enough for an unusually eventful night, low enough
// that one person cannot fabricate a neighbourhood's worth of activity.
const MAX_REPORTS_PER_HOUR = 10;
const MAX_PER_CELL_PER_HOUR = 3;

// How far back a report may be dated. Older than a week is baseline material,
// not something anyone needs warning about.
const MAX_AGO_HOURS = 168;

// Skunks are a New World family. Same bounding box as the model uses.
const NORTH_AMERICA = { minLat: 14, maxLat: 72, minLon: -170, maxLon: -52 };

const ALLOWED_ORIGINS = new Set([
  'https://kennek6.github.io',
  'http://127.0.0.1:8787',
  'http://localhost:8787',
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://kennek6.github.io';
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });

const fail = (message, status, origin) => json({ error: message }, status, origin);

// ---------------------------------------------------------------------------
// Time buckets. Reports are stored to the hour and never finer: a 200 m cell
// plus an exact minute identifies a household to anyone who was outside.
// ---------------------------------------------------------------------------

const hourBucket = (d) => d.toISOString().slice(0, 13);
const dayBucket = (d) => d.toISOString().slice(0, 10);

function isoWeekBucket(d) {
  // Thursday of the current ISO week determines the ISO year.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((t - firstThursday) / (7 * 86400000));
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// POST /api/report
// ---------------------------------------------------------------------------

async function handleReport(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail('Body must be JSON.', 400, origin);
  }

  const { lat, lon, type, underStructure = false, deviceKey, agoHours = 0 } = body ?? {};

  if (!TYPES.has(type)) {
    return fail(`type must be one of: ${[...TYPES].join(', ')}`, 400, origin);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return fail('lat and lon must be numbers.', 400, origin);
  }
  if (lat < NORTH_AMERICA.minLat || lat > NORTH_AMERICA.maxLat
      || lon < NORTH_AMERICA.minLon || lon > NORTH_AMERICA.maxLon) {
    return fail('Location is outside the covered range.', 400, origin);
  }
  if (typeof deviceKey !== 'string' || !/^[0-9a-f]{32}$/.test(deviceKey)) {
    return fail('deviceKey must be 32 hex characters.', 400, origin);
  }
  if (typeof underStructure !== 'boolean') {
    return fail('underStructure must be true or false.', 400, origin);
  }
  if (!Number.isInteger(agoHours) || agoHours < 0 || agoHours > MAX_AGO_HOURS) {
    return fail(`agoHours must be a whole number between 0 and ${MAX_AGO_HOURS}.`, 400, origin);
  }

  // Snap first. From here on the raw coordinate is out of scope and is never
  // written, logged, or returned.
  const cell = encodeGeohash(lat, lon, STORED_PRECISION[type]);
  const displayCell = encodeGeohash(lat, lon, PRECISION.display);
  const region = encodeGeohash(lat, lon, PRECISION.region);

  const now = new Date();
  const createdAt = Math.floor(now.valueOf() / 1000);
  const sinceHour = createdAt - 3600;

  // When it happened, which is not when it was reported. Everything that
  // describes the sighting is bucketed from this; only the rate limit and the
  // deletion clock use the arrival time.
  const observedAt = createdAt - agoHours * 3600;
  const observed = new Date(observedAt * 1000);

  const [perDevice, perCell] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE device_key = ? AND created_at > ?')
      .bind(deviceKey, sinceHour).first(),
    env.DB.prepare(
      'SELECT COUNT(*) AS n FROM reports WHERE device_key = ? AND display_cell = ? AND created_at > ?'
    ).bind(deviceKey, displayCell, sinceHour).first(),
  ]);

  if ((perDevice?.n ?? 0) >= MAX_REPORTS_PER_HOUR) {
    return fail('Too many reports in the last hour. Try again later.', 429, origin);
  }
  if ((perCell?.n ?? 0) >= MAX_PER_CELL_PER_HOUR) {
    return fail('That area already has several reports from this device in the last hour.', 429, origin);
  }

  const statements = [
    env.DB.prepare(`
      INSERT INTO reports
        (cell, display_cell, region, type, species, under_structure,
         observed_hour, observed_at, device_key, created_at)
      VALUES (?, ?, ?, ?, 'skunk', ?, ?, ?, ?, ?)
    `).bind(cell, displayCell, region, type, underStructure ? 1 : 0,
      hourBucket(observed), observedAt, deviceKey, createdAt),

    // Aggregates are incremented on the way in rather than during the sweep.
    // If the cron never fires, the counts are still right; a sweep-time
    // aggregation that fails loses the history instead.
    env.DB.prepare(`
      INSERT INTO recent (display_cell, region, day, type, n) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (display_cell, day, type) DO UPDATE SET n = n + 1
    `).bind(displayCell, region, dayBucket(observed), type),

    env.DB.prepare(`
      INSERT INTO baseline (display_cell, region, week, n) VALUES (?, ?, ?, 1)
      ON CONFLICT (display_cell, week) DO UPDATE SET n = n + 1
    `).bind(displayCell, region, isoWeekBucket(observed)),
  ];

  if (type === 'found_roadkill') {
    statements.push(env.DB.prepare(`
      INSERT INTO roadkill (display_cell, region, until) VALUES (?, ?, ?)
      ON CONFLICT (display_cell) DO UPDATE SET until = MAX(until, excluded.until)
    `).bind(displayCell, region, observedAt + ROADKILL_SUPPRESS_SECONDS));
  }

  await env.DB.batch(statements);

  return json({ ok: true, cell: displayCell, region, hour: hourBucket(observed) }, 201, origin);
}

// ---------------------------------------------------------------------------
// GET /api/region/:gh4
//
// A whole region, not a radius around the caller. The client works out which
// regions its viewport touches and filters by distance on the device, so the
// server never receives a position precise enough to follow anyone.
// ---------------------------------------------------------------------------

async function handleRegion(region, env, origin) {
  if (!/^[0-9bcdefghjkmnpqrstuvwxyz]{4}$/.test(region)) {
    return fail('Region must be a 4-character geohash.', 400, origin);
  }

  const now = Math.floor(Date.now() / 1000);
  const liveSince = now - LIVE_SECONDS;
  const recentSince = dayBucket(new Date((now - RECENT_DAYS * 86400) * 1000));

  const [live, recent, baseline, roadkill] = await Promise.all([
    // Smell reports are held back where a carcass explains them.
    env.DB.prepare(`
      SELECT r.display_cell, r.type, r.observed_hour, r.under_structure
        FROM reports r
        LEFT JOIN roadkill k ON k.display_cell = r.display_cell AND k.until > ?
       WHERE r.region = ? AND r.observed_at > ?
         AND NOT (r.type IN ('smelled_fresh', 'smelled_faint') AND k.display_cell IS NOT NULL)
       ORDER BY r.observed_at DESC
       LIMIT 500
    `).bind(now, region, liveSince).all(),

    env.DB.prepare(`
      SELECT display_cell, day, type, n FROM recent
       WHERE region = ? AND day >= ? ORDER BY day DESC LIMIT 2000
    `).bind(region, recentSince).all(),

    env.DB.prepare(`
      SELECT display_cell, SUM(n) AS n FROM baseline
       WHERE region = ? GROUP BY display_cell LIMIT 2000
    `).bind(region).all(),

    env.DB.prepare('SELECT display_cell, until FROM roadkill WHERE region = ? AND until > ?')
      .bind(region, now).all(),
  ]);

  return json({
    region,
    live: live.results ?? [],
    recent: recent.results ?? [],
    baseline: baseline.results ?? [],
    roadkill: roadkill.results ?? [],
  }, 200, origin);
}

// ---------------------------------------------------------------------------
// Scheduled sweep. Individual reports die at 48 hours; the counts they fed
// have already been written, so deletion loses nothing worth keeping.
// ---------------------------------------------------------------------------

async function sweep(env) {
  const now = Math.floor(Date.now() / 1000);
  const recentCutoff = dayBucket(new Date((now - RECENT_DAYS * 86400) * 1000));

  const result = await env.DB.batch([
    env.DB.prepare('DELETE FROM reports WHERE created_at <= ?').bind(now - LIVE_SECONDS),
    env.DB.prepare('DELETE FROM recent WHERE day < ?').bind(recentCutoff),
    env.DB.prepare('DELETE FROM roadkill WHERE until <= ?').bind(now),
  ]);

  return result.map((r) => r.meta?.changes ?? 0);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true }, 200, origin);
    }
    if (url.pathname === '/api/report' && request.method === 'POST') {
      return handleReport(request, env, origin);
    }
    const region = url.pathname.match(/^\/api\/region\/([^/]+)$/);
    if (region && request.method === 'GET') {
      return handleRegion(region[1].toLowerCase(), env, origin);
    }

    return fail('Not found.', 404, origin);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sweep(env));
  },
};
