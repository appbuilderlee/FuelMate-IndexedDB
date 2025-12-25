/* FuelMate Service Worker - app-shell cache for offline install */
const CACHE_NAME = 'fuelmate-cache-v2';
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/sw.js'];

function extractSameOriginAssetPaths(htmlText) {
  const matches = htmlText.matchAll(/\b(?:href|src)\s*=\s*"(\/[^"#?]+)"/g);
  const paths = new Set();
  for (const m of matches) {
    const p = m[1];
    if (!p) continue;
    if (p.startsWith('//')) continue;
    if (p.startsWith('/@')) continue;
    paths.add(p);
  }
  return Array.from(paths);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);

      // Best-effort: cache same-origin assets referenced by the current HTML (works for hashed Vite assets too).
      try {
        const res = await fetch('/index.html', { cache: 'no-store' });
        if (res.ok) {
          const html = await res.text();
          const assets = extractSameOriginAssetPaths(html);
          await cache.addAll(assets);
        }
      } catch {
        // ignore
      }

      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // SPA-style navigation fallback to cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put('/index.html', response.clone());
          return response;
        } catch {
          return (await caches.match('/index.html')) || Response.error();
        }
      })(),
    );
    return;
  }

  // Cache-first for same-origin; runtime cache opaque CDN assets too.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        if (isSameOrigin) return (await caches.match('/index.html')) || Response.error();
        return Response.error();
      }
    })(),
  );
});
