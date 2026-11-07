// Where the reporting API lives.
//
// The page is static and served from GitHub Pages; the API is a Cloudflare
// Worker on a different origin, which is why the Worker sets CORS headers.
//
// Served from a local file server, this points at `wrangler dev` so the whole
// thing can be exercised offline.

const LOCAL = new Set(['127.0.0.1', 'localhost']);

export const API_BASE = LOCAL.has(location.hostname)
  ? 'http://127.0.0.1:8788'
  : 'https://skunk-watch-api.skunk-watch.workers.dev';
