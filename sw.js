// Service worker: app shell offline, data stale-while-revalidate, visited map
// tiles cached so the map keeps working with a weak connection.
// Bump VERSION when the app shell changes.
const VERSION = 'v17';
const SHELL = `mf-shell-${VERSION}`;
// Drop cells cached before MUFKO was added, so returning visitors get its places
// with the new app shell instead of an old cell on their first updated visit.
const DATA = 'mf-data-v2';
const TILES = 'mf-tiles-v1';
const MAX_TILES = 1500;

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/js/app.js',
  'assets/js/config.js',
  'assets/js/core/brands.js',
  'assets/js/core/geo.js',
  'assets/js/core/hours.js',
  'assets/js/core/links.js',
  'assets/js/core/normalize.js',
  'assets/js/core/overpass.js',
  'assets/js/core/searchplan.js',
  'assets/js/core/stations.js',
  'assets/js/core/text.js',
  'assets/js/ui/analytics.js',
  'assets/js/ui/content.js',
  'assets/js/ui/dialogs.js',
  'assets/js/ui/feedback.js',
  'assets/js/ui/i18n.js',
  'assets/js/ui/icons.js',
  'assets/js/ui/mapview.js',
  'assets/js/ui/render.js',
  'assets/js/ui/search.js',
  'assets/js/ui/sheet.js',
  'assets/js/ui/store.js',
  'assets/js/ui/util.js',
  'assets/i18n/en.json',
  'assets/i18n/ko.json',
  'assets/i18n/ar.json',
  'assets/i18n/id.json',
  'assets/i18n/ms.json',
  'assets/i18n/tr.json',
  'assets/i18n/fr.json',
  'assets/img/icon.svg',
  'assets/img/icon-192.png',
  'assets/vendor/maplibre-gl/maplibre-gl.js',
  'assets/vendor/maplibre-gl/maplibre-gl.css',
];

const scopeUrl = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.map(scopeUrl))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, DATA, TILES]);
      for (const key of await caches.keys()) if (key.startsWith('mf-') && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(request, { ignoreSearch: true })) || (fallbackUrl && (await caches.match(fallbackUrl)));
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(update);
    return hit;
  }
  return update;
}

let tileWrites = 0;
async function cacheFirstTile(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    if (++tileWrites % 100 === 0) trimTiles(cache);
  }
  return res;
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);

  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    const rel = url.pathname.slice(scope.pathname.length);
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, SHELL, scopeUrl('index.html')));
    } else if (rel === 'data/index.json' || rel === 'data/search.json') {
      event.respondWith(networkFirst(request, DATA));
    } else if (rel.startsWith('data/')) {
      event.respondWith(staleWhileRevalidate(request, DATA, event));
    } else {
      event.respondWith(staleWhileRevalidate(request, SHELL, event));
    }
    return;
  }

  if (url.hostname === 'tiles.openfreemap.org' || url.hostname === 'tile.openstreetmap.org') {
    // Styles change over time; tiles, fonts and sprites are versioned by URL.
    if (url.pathname.startsWith('/styles/')) event.respondWith(staleWhileRevalidate(request, TILES, event));
    else event.respondWith(cacheFirstTile(request));
  }
  // Everything else (Overpass, geocoding, map apps) goes straight to the network.
});
