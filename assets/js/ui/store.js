// Client-side data store: loads the prebuilt index and per-cell files, and
// falls back to live Overpass queries when no prebuilt data exists (or for
// prayer places outside Korea).

import { cellsForBbox, cellKey, inBbox, isInKorea, KOREA_BBOX } from '../core/geo.js';
import { runOverpass, liveFoodQuery, prayerQuery } from '../core/overpass.js';
import { fromOsmElement } from '../core/normalize.js';

export const DETAIL_ZOOM = 8; // below this the map shows cell summaries
export const LIVE_ZOOM = 10; // live Overpass queries only when zoomed in this far
const LIVE_TILE = 0.25;

export const store = {
  index: null,
  mode: 'loading', // 'static' | 'live'
  places: new Map(),
  aliases: new Map(),
  cells: new Map(), // key -> Promise
  tz: new Map(),
  liveTiles: new Set(),
  prayerTiles: new Set(),
  version: 0, // bumps whenever places change
  liveBusy: false,
  liveError: null,
};

function add(place) {
  const prev = store.places.get(place.id);
  if (!prev || (prev.src === 'live' && place.src !== 'live')) store.places.set(place.id, place);
  for (const id of place.ids || []) store.aliases.set(id, place.id);
}

export async function loadIndex() {
  try {
    const res = await fetch('data/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = await res.json();
    if (!index || !index.cells) throw new Error('bad index');
    store.index = index;
    store.mode = 'static';
    for (const [key, v] of Object.entries(index.cells)) if (v[3]) store.tz.set(key, v[3]);
    // Worldwide OSM data missing from this build -> also use live queries outside Korea.
    store.hybrid = index.mode !== 'full' || (index.overpass?.tagged && !index.overpass.tagged.ok && !index.overpass.tagged.stale);
  } catch (err) {
    console.warn('No prebuilt data, using live OpenStreetMap queries', err);
    store.mode = 'live';
  }
  return store.mode;
}

let searchCatalog;
/** Download the small search projection only when the user submits a search. */
export function loadSearchCatalog() {
  searchCatalog ??= fetch('data/search.json')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((rows) => {
      if (!Array.isArray(rows)) throw new Error('bad search catalog');
      return rows;
    })
    .catch(() => {
      searchCatalog = null; // try again on the next search, including after going online
      return [];
    });
  return searchCatalog;
}

function loadCell(key) {
  if (!store.cells.has(key)) {
    const p = fetch(`data/cells/${key}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((list) => {
        for (const place of list) add(place);
        store.version++;
      })
      .catch((err) => {
        store.cells.delete(key); // allow retry
        throw err;
      });
    store.cells.set(key, p);
  }
  return store.cells.get(key);
}

/** Make sure every prebuilt cell intersecting bbox is loaded. */
export async function ensureArea(bbox, zoom) {
  const jobs = [];
  if (store.mode === 'static' && zoom >= DETAIL_ZOOM - 0.5) {
    for (const key of cellsForBbox(bbox)) if (store.index.cells[key]) jobs.push(loadCell(key));
  }
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed && failed === results.length) throw new Error('cells failed');
  // Live data where we have nothing prebuilt (no index, or a build without worldwide OSM data).
  if ((store.mode === 'live' || store.hybrid) && zoom >= LIVE_ZOOM) {
    await ensureLive(bbox, 'food');
  }
}

function tilesFor(bbox) {
  const [w, s, e, n] = bbox;
  const out = [];
  for (let y = Math.floor(s / LIVE_TILE); y <= Math.floor(n / LIVE_TILE); y++) {
    for (let x = Math.floor(w / LIVE_TILE); x <= Math.floor(e / LIVE_TILE); x++) {
      out.push([y, x]);
    }
  }
  return out;
}

export function hasMoreToDiscover(bbox) {
  return tilesFor(bbox).some(([y, x]) => !store.liveTiles.has(`${y}_${x}`));
}

const inflight = { food: null, prayer: null }; // { tiles: Set, promise, ctrl }

/** Live Overpass query for the missing 0.25° tiles in bbox. kind: 'food' | 'prayer'. */
export async function ensureLive(bbox, kind, { includeKorea = false } = {}) {
  const done = kind === 'prayer' ? store.prayerTiles : store.liveTiles;
  let tiles = tilesFor(bbox).filter(([y, x]) => !done.has(`${y}_${x}`));
  // Korea has prebuilt data. An explicit food search can still add places.
  if (!includeKorea && store.mode === 'static') {
    tiles = tiles.filter(([y, x]) => !isInKorea((y + 0.5) * LIVE_TILE, (x + 0.5) * LIVE_TILE));
  }
  if (!tiles.length || tiles.length > 16) return;
  // A request already covering these tiles is still running: wait for it.
  const running = inflight[kind];
  if (running && tiles.every(([y, x]) => running.tiles.has(`${y}_${x}`))) return running.promise;
  running?.ctrl.abort();

  const ys = tiles.map((t) => t[0]);
  const xs = tiles.map((t) => t[1]);
  const box = [Math.min(...xs) * LIVE_TILE, Math.min(...ys) * LIVE_TILE, (Math.max(...xs) + 1) * LIVE_TILE, (Math.max(...ys) + 1) * LIVE_TILE];
  const ctrl = new AbortController();
  const job = { tiles: new Set(tiles.map(([y, x]) => `${y}_${x}`)), ctrl };
  job.promise = (async () => {
    store.liveBusy = true;
    try {
      const query = kind === 'prayer' ? prayerQuery(box) : liveFoodQuery(box);
      const json = await runOverpass(query, { signal: ctrl.signal, timeoutMs: 12000 });
      for (const el of json.elements) {
        const p = fromOsmElement(el, { infer: 'name', veg: true });
        if (!p) continue;
        if (kind === 'prayer' ? p.k !== 'p' : p.k === 'p') continue;
        p.src = 'live';
        add(p);
      }
      for (const key of job.tiles) done.add(key);
      store.liveError = null;
      store.version++;
    } catch (err) {
      if (!ctrl.signal.aborted) {
        store.liveError = err;
        throw err;
      }
    } finally {
      if (inflight[kind] === job) {
        inflight[kind] = null;
        store.liveBusy = false;
      }
    }
  })();
  inflight[kind] = job;
  return job.promise;
}

export function placesIn(bbox) {
  const out = [];
  for (const p of store.places.values()) if (inBbox(p.y, p.x, bbox)) out.push(p);
  return out;
}

export function getPlace(id) {
  return store.places.get(id) || store.places.get(store.aliases.get(id)) || null;
}

/** Find a place by id, loading its cell if needed (for shared links). */
export async function findPlace(id, hint) {
  const cached = getPlace(id);
  if (cached) return cached;
  if (hint && store.mode === 'static') {
    const key = cellKey(hint.lat, hint.lon);
    if (store.index.cells[key]) await loadCell(key).catch(() => {});
  }
  return getPlace(id);
}

/** Time zone for a place (from the build), Asia/Seoul inside Korea, else the device's. */
export function tzFor(p) {
  return store.tz.get(cellKey(p.y, p.x)) || (isInKorea(p.y, p.x) ? 'Asia/Seoul' : undefined);
}

/** Summary points for low zoom levels (one per data cell). */
export function summaryGeoJSON() {
  const features = [];
  if (store.index) {
    for (const [, v] of Object.entries(store.index.cells)) {
      if (!v[0]) continue;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [v[2], v[1]] }, properties: { count: v[0] } });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Number of food places inside bbox according to the index (for zoomed-out views). */
export function countInView(bbox) {
  if (!store.index) return 0;
  let n = 0;
  for (const v of Object.values(store.index.cells)) if (inBbox(v[1], v[2], bbox)) n += v[0];
  return n;
}

export const KOREA = KOREA_BBOX;
