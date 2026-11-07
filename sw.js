// App-shell cache, so the page opens without a connection. The weather and
// report requests still need the network; without one the page loads and says
// so rather than showing a stale reading.
//
// Network-first, falling back to cache. Cache-first was the obvious choice and
// the wrong one: it served a stale app.js after a deploy, which looked exactly
// like the new code being broken. The shell is a few kilobytes, so preferring
// the network costs nothing and removes a whole class of "why is my fix not
// showing up" confusion. Offline still works, from the fallback.
//
// CEILING: the cache name is bumped by hand. Move to a generated precache
// manifest if this list grows past a handful of files.

const CACHE = 'skunkwatch-shell-v3';
const SHELL = [
  './', 'index.html', 'privacy.html', 'app.js', 'risk.js', 'geo.js',
  'config.js', 'manifest.webmanifest', 'icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})            // a single missing file must not block install
      .then(() => self.skipWaiting())
  );
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

  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(e.request, fresh.clone());
      }
      return fresh;
    } catch {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      // An offline navigation lands on the shell rather than a browser error.
      if (e.request.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      throw new Error('offline and not cached');
    }
  })());
});
