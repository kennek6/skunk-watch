// Minimal app-shell cache so the page opens without a connection. The weather
// request still needs the network; without it the page loads and reports the
// failure rather than showing a stale reading.
//
// CEILING: cache name is bumped by hand. If this grows past a handful of files,
// move to a generated precache manifest.
const CACHE = 'skunkwatch-shell-v2';
const SHELL = [
  './', 'index.html', 'privacy.html', 'app.js', 'risk.js', 'geo.js',
  'config.js', 'manifest.webmanifest', 'icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
