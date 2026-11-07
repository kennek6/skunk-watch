// Skunk Watch: page logic.
//
// Three parts: the conditions panel (works with no network beyond weather),
// the map of what neighbours have reported, and the report form.
//
// The model itself is in risk.js and the grid maths in geo.js, both pure. This
// file is the only place that touches the DOM or the network.

import { assess, timeline, peakWindow } from './risk.js';
import { geohashBounds, geohashCentre, metresBetween, regionsForBounds, PRECISION } from './geo.js';
import { API_BASE } from './config.js';

const $ = (id) => document.getElementById(id);
const els = {
  form: $('search'), place: $('place'), gps: $('gps'), choices: $('choices'),
  error: $('error'), result: $('result'), banner: $('banner'),
  headline: $('headline'), factors: $('factors'), meta: $('meta'),
  summary: $('summary'), strip: $('strip'), ticks: $('ticks'),
  nearby: $('nearby'), mapNote: $('map-note'),
  reportOpen: $('report-open'), reportPanel: $('report-panel'),
  reportWhere: $('report-where'), reportGps: $('report-gps'),
  reportTypes: $('report-types'), reportStructure: $('report-structure'),
  reportStructureRow: $('report-structure-row'),
  reportSend: $('report-send'), reportCancel: $('report-cancel'),
  reportStatus: $('report-status'),
};

const HEADLINES = {
  high: 'Skunks are likely active now',
  elevated: 'Skunks may be active now',
};

const TYPE_LABELS = {
  saw_live: 'Saw a skunk',
  smelled_fresh: 'Smelled fresh spray',
  smelled_faint: 'Smelled it faintly',
  found_roadkill: 'Found one dead on the road',
};

const TYPE_COLOURS = {
  saw_live: '#c6453c',
  smelled_fresh: '#d08324',
  smelled_faint: '#c9a227',
  found_roadkill: '#6b7f8c',
};

const SEG_MINUTES = 15;
const WINDOW_HOURS = 18;
const TICK_HOURS = 3;
const NEARBY_METRES = 1500;
const RECENT_DAYS_SHOWN = 14;
const MAX_REGIONS_PER_LOAD = 4;

const pad = (n) => String(n).padStart(2, '0');
const coarse = (n) => Math.round(n * 100) / 100;
const timeOf = (iso) => (iso ? iso.slice(11, 16) : 'unknown');

// ---------------------------------------------------------------------------
// Device key. Random, per install, used by the API for rate limiting only. It
// is never tied to a name, an email, or a location history.
// ---------------------------------------------------------------------------

let fallbackKey = null;

function randomKey() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

function deviceKey() {
  try {
    let key = localStorage.getItem('skunkwatch:device');
    if (!/^[0-9a-f]{32}$/.test(key ?? '')) {
      key = randomKey();
      localStorage.setItem('skunkwatch:device', key);
    }
    return key;
  } catch {
    // Private browsing or blocked storage. A per-session key still rate-limits.
    return (fallbackKey ??= randomKey());
  }
}

// ---------------------------------------------------------------------------
// Conditions panel
// ---------------------------------------------------------------------------

function isoInOffset(date, offsetSeconds) {
  const shifted = new Date(date.valueOf() + offsetSeconds * 1000);
  const mins = Math.abs(Math.round(offsetSeconds / 60));
  const sign = offsetSeconds < 0 ? '-' : '+';
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
    + `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
    + `${sign}${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

function fail(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

function clearMessages() {
  els.error.hidden = true;
  els.choices.hidden = true;
  els.choices.replaceChildren();
}

async function fetchJSON(url, what, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(`Could not reach the ${what} service. Check your connection.`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error ?? ''; } catch { /* no body */ }
    throw new Error(detail || `The ${what} service returned ${res.status}.`);
  }
  return res.json();
}

async function geocode(name) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search'
    + `?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;
  return (await fetchJSON(url, 'place lookup')).results ?? [];
}

async function weather(lat, lon) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${coarse(lat)}&longitude=${coarse(lon)}`
    + '&current=temperature_2m&hourly=temperature_2m,precipitation'
    + '&past_hours=24&forecast_hours=24&timezone=auto';
  const data = await fetchJSON(url, 'weather');
  const tempC = data.current?.temperature_2m;
  if (!Number.isFinite(tempC)) throw new Error('The weather service returned no temperature.');

  const times = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const rain = data.hourly?.precipitation ?? [];
  const tempByHour = new Map(times.map((t, i) => [t.slice(0, 13), temps[i]]));

  const nowHour = (data.current?.time ?? '').slice(0, 13);
  const nowIdx = times.findIndex((t) => t.slice(0, 13) === nowHour);
  const from = Math.max(0, (nowIdx < 0 ? times.length : nowIdx) - 24);
  const precipMm24h = rain.slice(from, from + 24).reduce((a, b) => a + (b ?? 0), 0);

  return { tempC, precipMm24h, offsetSeconds: data.utc_offset_seconds ?? 0, tempByHour };
}

function summarise(segments, peak) {
  if (!peak) return `No elevated period flagged in the next ${WINDOW_HOURS} hours.`;
  const word = peak.level === 'high' ? 'Highest' : 'Most active';
  if (segments[0]?.level === peak.level) return `${word} now, easing after ${timeOf(peak.endISO)}.`;
  return `${word} from ${timeOf(peak.startISO)}.`;
}

function renderStrip(lat, lon, wx, startISO) {
  const segments = timeline({
    lat, lon, startISO, hours: WINDOW_HOURS, stepMinutes: SEG_MINUTES,
    temperatureAt: (iso) => wx.tempByHour.get(iso.slice(0, 13)) ?? NaN,
    precipMm24h: wx.precipMm24h,
  });

  const text = summarise(segments, peakWindow(segments));
  els.summary.textContent = text;
  els.strip.setAttribute('aria-label', text);

  els.strip.replaceChildren(...segments.map((s) => {
    const d = document.createElement('div');
    d.className = `seg-${s.level}`;
    d.title = `${timeOf(s.timestampISO)} ${s.level}`;
    return d;
  }));

  const perTick = (TICK_HOURS * 60) / SEG_MINUTES;
  els.ticks.replaceChildren(...segments
    .filter((_, i) => i % perTick === 0)
    .map((s, i) => Object.assign(document.createElement('span'), {
      textContent: i === 0 ? 'now' : timeOf(s.timestampISO),
    })));
}

function renderConditions(label, lat, lon, wx) {
  const timestampISO = isoInOffset(new Date(), wx.offsetSeconds);
  const r = assess({ lat, lon, timestampISO, tempC: wx.tempC, precipMm24h: wx.precipMm24h });

  els.banner.hidden = r.level === 'quiet';
  els.banner.className = `banner ${r.level}`;
  els.headline.textContent = HEADLINES[r.level] ?? '';

  els.factors.replaceChildren(
    ...r.factors.map((f) => Object.assign(document.createElement('li'), { textContent: f }))
  );

  renderStrip(lat, lon, wx, timestampISO);

  els.meta.replaceChildren(...[
    label,
    `${Math.round(wx.tempC)}C, ${wx.precipMm24h.toFixed(1)} mm rain in the last 24 h`,
    `Sunset ${timeOf(r.sunsetISO)}, sunrise ${timeOf(r.sunriseISO)}`,
    `Checked ${timestampISO.slice(11, 16)} local`,
  ].map((t) => Object.assign(document.createElement('div'), { textContent: t })));

  els.result.hidden = false;
}

// ---------------------------------------------------------------------------
// Map of reports
//
// The client asks for whole regions (geohash 4, roughly a city) and works out
// what is near the viewer on the device. The server is never sent a position
// precise enough to follow anyone. See SPEC.md, Querying.
// ---------------------------------------------------------------------------

let map = null;
let cellLayer = null;
let pendingMarker = null;
let pendingLatLon = null;
let selectedType = null;
let viewerLatLon = null;
const regionCache = new Map();

function initMap() {
  if (map || typeof L === 'undefined') return;

  map = L.map('map', { zoomControl: true, maxZoom: 17 }).setView([43.26, -79.87], 13);

  // CEILING: OpenStreetMap's public tiles are fine at this traffic but their
  // usage policy rules out a heavy app. Swap in MapTiler or Protomaps (~$20/mo)
  // if daily tile loads get into the thousands.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  cellLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (els.reportPanel.hidden) return;
    setPending(e.latlng.lat, e.latlng.lng);
  });

  map.on('moveend', () => { loadVisibleRegions(); });
  loadVisibleRegions();
}

async function loadVisibleRegions() {
  if (!map) return;
  const b = map.getBounds();
  const regions = regionsForBounds({
    minLat: b.getSouth(), maxLat: b.getNorth(),
    minLon: b.getWest(), maxLon: b.getEast(),
  }).slice(0, MAX_REGIONS_PER_LOAD);

  await Promise.all(regions.map(async (region) => {
    try {
      regionCache.set(region, await fetchJSON(`${API_BASE}/api/region/${region}`, 'reports'));
    } catch {
      // A region that will not load leaves the map as it was rather than
      // blanking it. The note below says when nothing could be fetched.
    }
  }));

  drawCells();
}

function activityByCell() {
  const cells = new Map();
  const cutoff = new Date(Date.now() - RECENT_DAYS_SHOWN * 86400000).toISOString().slice(0, 10);

  for (const data of regionCache.values()) {
    for (const r of data.live ?? []) {
      const c = cells.get(r.display_cell) ?? { live: [], recent: 0, baseline: 0 };
      c.live.push(r);
      cells.set(r.display_cell, c);
    }
    for (const r of data.recent ?? []) {
      if (r.day < cutoff) continue;
      const c = cells.get(r.display_cell) ?? { live: [], recent: 0, baseline: 0 };
      c.recent += r.n;
      cells.set(r.display_cell, c);
    }
    for (const r of data.baseline ?? []) {
      const c = cells.get(r.display_cell) ?? { live: [], recent: 0, baseline: 0 };
      c.baseline += r.n;
      cells.set(r.display_cell, c);
    }
  }
  return cells;
}

function drawCells() {
  if (!cellLayer) return;
  cellLayer.clearLayers();
  const cells = activityByCell();

  for (const [cell, info] of cells) {
    const b = geohashBounds(cell);
    const bounds = [[b.minLat, b.minLon], [b.maxLat, b.maxLon]];
    const newest = info.live[0];

    // A filled cell means something was reported in the last 48 hours. An
    // outline means older activity. The rectangle is the cell itself, never a
    // dot at its centre, because the precision was deliberately removed.
    const style = newest
      ? { color: TYPE_COLOURS[newest.type], weight: 1, fillOpacity: 0.35, fillColor: TYPE_COLOURS[newest.type] }
      : { color: '#9b968f', weight: 1, dashArray: '3 3', fillOpacity: 0.06, fillColor: '#9b968f' };

    const rect = L.rectangle(bounds, style);
    const lines = [];
    if (info.live.length) {
      lines.push(...info.live.slice(0, 4).map((r) => `${TYPE_LABELS[r.type]}, ${r.observed_hour.slice(11)}:00`));
      if (info.live.some((r) => r.under_structure)) lines.push('Went under a deck, shed or porch');
    }
    if (info.recent) lines.push(`${info.recent} report${info.recent === 1 ? '' : 's'} in the last ${RECENT_DAYS_SHOWN} days`);
    if (info.baseline) lines.push(`${info.baseline} all time`);
    rect.bindPopup(lines.join('<br>') || 'No recent activity');
    rect.addTo(cellLayer);
  }

  els.mapNote.textContent = cells.size
    ? `${cells.size} area${cells.size === 1 ? '' : 's'} with reports in view. Each square is about 900 m across.`
    : 'No reports in this area yet. Each square drawn is about 900 m across.';

  renderNearby(cells);
}

function renderNearby(cells) {
  if (!viewerLatLon) { els.nearby.hidden = true; return; }
  let live = 0;
  let recent = 0;
  for (const [cell, info] of cells) {
    const c = geohashCentre(cell);
    if (metresBetween(viewerLatLon.lat, viewerLatLon.lon, c.lat, c.lon) > NEARBY_METRES) continue;
    live += info.live.length;
    recent += info.recent;
  }
  const km = (NEARBY_METRES / 1000).toFixed(1);
  if (live) {
    els.nearby.textContent = `${live} report${live === 1 ? '' : 's'} within ${km} km in the last 48 hours.`;
  } else if (recent) {
    els.nearby.textContent = `${recent} report${recent === 1 ? '' : 's'} within ${km} km in the last ${RECENT_DAYS_SHOWN} days.`;
  } else {
    els.nearby.textContent = `Nothing reported within ${km} km recently.`;
  }
  els.nearby.hidden = false;
}

// ---------------------------------------------------------------------------
// Reporting
//
// Tapping the map is the default, so a report about a skunk two streets over
// does not require being there, and the app never learns where the reporter is.
// "Use my location" is the shortcut, not the main path.
// ---------------------------------------------------------------------------

function setPending(lat, lon) {
  pendingLatLon = { lat, lon };
  if (pendingMarker) pendingMarker.remove();
  pendingMarker = L.circleMarker([lat, lon], {
    radius: 7, color: '#2f6f4f', weight: 2, fillColor: '#2f6f4f', fillOpacity: 0.5,
  }).addTo(map);
  els.reportWhere.textContent = 'Spot chosen. Snapped to an area about 900 m across when sent.';
  updateSendState();
}

function clearPending() {
  if (pendingMarker) { pendingMarker.remove(); pendingMarker = null; }
  pendingLatLon = null;
  selectedType = null;
  for (const b of els.reportTypes.querySelectorAll('button')) b.removeAttribute('aria-pressed');
  els.reportStructure.checked = false;
  els.reportStructureRow.hidden = true;
  els.reportWhere.textContent = 'Tap the map where you saw or smelled it.';
  updateSendState();
}

function updateSendState() {
  els.reportSend.disabled = !(pendingLatLon && selectedType);
}

function buildTypeButtons() {
  els.reportTypes.replaceChildren(...Object.entries(TYPE_LABELS).map(([type, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => {
      selectedType = type;
      for (const other of els.reportTypes.querySelectorAll('button')) other.removeAttribute('aria-pressed');
      b.setAttribute('aria-pressed', 'true');
      els.reportStructureRow.hidden = type !== 'saw_live';
      updateSendState();
    });
    return b;
  }));
}

async function sendReport() {
  els.reportSend.disabled = true;
  els.reportStatus.textContent = 'Sending...';
  try {
    await fetchJSON(`${API_BASE}/api/report`, 'reporting', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lat: pendingLatLon.lat,
        lon: pendingLatLon.lon,
        type: selectedType,
        underStructure: selectedType === 'saw_live' && els.reportStructure.checked,
        deviceKey: deviceKey(),
      }),
    });
    els.reportStatus.textContent = 'Thanks, reported.';
    clearPending();
    regionCache.clear();
    await loadVisibleRegions();
    setTimeout(() => { els.reportPanel.hidden = true; els.reportStatus.textContent = ''; }, 1500);
  } catch (e) {
    els.reportStatus.textContent = e.message;
    updateSendState();
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function show(label, lat, lon) {
  clearMessages();
  viewerLatLon = { lat, lon };
  try {
    renderConditions(label, lat, lon, await weather(lat, lon));
    try {
      localStorage.setItem('skunkwatch:last', JSON.stringify({ label, lat, lon }));
    } catch { /* storage blocked; the page still works */ }
  } catch (e) {
    fail(e.message);
  }
  if (map) {
    map.setView([lat, lon], Math.max(map.getZoom(), 13));
    await loadVisibleRegions();
  }
}

function offerChoices(results) {
  els.choices.replaceChildren(...results.map((r) => {
    const label = [r.name, r.admin1, r.country_code].filter(Boolean).join(', ');
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => show(label, r.latitude, r.longitude));
    li.append(btn);
    return li;
  }));
  els.choices.hidden = false;
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = els.place.value.trim();
  if (!name) return;
  clearMessages();
  try {
    const results = await geocode(name);
    if (results.length === 0) fail(`No place found matching "${name}".`);
    else if (results.length === 1) {
      const r = results[0];
      show([r.name, r.admin1, r.country_code].filter(Boolean).join(', '), r.latitude, r.longitude);
    } else offerChoices(results);
  } catch (err) {
    fail(err.message);
  }
});

function locate(onFound, button, busyLabel, idleLabel) {
  if (!navigator.geolocation) return fail('This browser does not offer location access.');
  button.disabled = true;
  button.textContent = busyLabel;
  const done = () => { button.disabled = false; button.textContent = idleLabel; };
  navigator.geolocation.getCurrentPosition(
    (pos) => { done(); onFound(pos.coords.latitude, pos.coords.longitude); },
    (err) => {
      done();
      fail(err.code === err.PERMISSION_DENIED
        ? 'Location permission was declined. Type a town name or tap the map instead.'
        : 'Could not get a location fix. Type a town name or tap the map instead.');
    },
    { timeout: 10000, maximumAge: 300000 }
  );
}

// Geolocation is requested only on a button press, never on load.
els.gps.addEventListener('click', () => {
  clearMessages();
  locate((lat, lon) => show('Your location', lat, lon), els.gps, 'Locating...', 'Use my location');
});

els.reportGps.addEventListener('click', () => {
  locate((lat, lon) => { map.setView([lat, lon], 15); setPending(lat, lon); },
    els.reportGps, 'Locating...', 'Use my location instead');
});

els.reportOpen.addEventListener('click', () => {
  els.reportPanel.hidden = !els.reportPanel.hidden;
  if (!els.reportPanel.hidden) {
    clearPending();
    els.reportPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});
els.reportCancel.addEventListener('click', () => { clearPending(); els.reportPanel.hidden = true; });
els.reportSend.addEventListener('click', sendReport);

buildTypeButtons();
updateSendState();
initMap();

// Reopen on the last place checked, so the common case is a single glance.
try {
  const last = JSON.parse(localStorage.getItem('skunkwatch:last') ?? 'null');
  if (last && Number.isFinite(last.lat)) {
    els.place.value = last.label === 'Your location' ? '' : last.label;
    show(last.label, last.lat, last.lon);
  }
} catch { /* nothing saved, or storage blocked */ }

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
