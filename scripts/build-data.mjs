#!/usr/bin/env node
// Build the static dataset served with the site:
//   data/index.json          cell summary + metadata (loaded first)
//   data/cells/<lat>_<lon>.json  places per 1°x1° cell (loaded on demand)
//
// Sources: OpenStreetMap via Overpass (worldwide halal-tagged places, halal
// names, Korea-specific hints and mosques/prayer rooms) merged with the
// Korean public datasets in data/sources/*.json.
//
// Usage:
//   node scripts/build-data.mjs                 # full build (needs Overpass)
//   node scripts/build-data.mjs --offline       # only data/sources (no network)
//   node scripts/build-data.mjs --korea-only    # Overpass, but Korea only (fast CI check)
//   node scripts/build-data.mjs --osm-cache DIR # reuse/keep raw Overpass JSON in DIR

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOverpass, taggedQuery, nameQuery, koreaQuery } from '../assets/js/core/overpass.js';
import { fromOsmElement, betterStatus, compact } from '../assets/js/core/normalize.js';
import { cellKey, distance, isInKorea, KOREA_BBOX, CELL_SIZE } from '../assets/js/core/geo.js';
import { namesMatch } from '../assets/js/core/text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);

const OFFLINE = flag('--offline');
const KOREA_ONLY = flag('--korea-only');
const OUT = path.resolve(ROOT, opt('--out', 'data'));
const OSM_CACHE = opt('--osm-cache', null);
const UA = 'MuslimfoodDataBuild/1.0 (+https://github.com/meaterick/Muslimfood)';

const log = (...a) => console.log('[build-data]', ...a);

// ------------------------------------------------------------------ sources

async function loadSources() {
  const dir = path.join(ROOT, 'data', 'sources');
  const files = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.json')).sort() : [];
  const sources = [];
  for (const f of files) {
    const json = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
    if (!Array.isArray(json.places)) continue;
    sources.push({ file: f, ...json });
  }
  return sources;
}

// ------------------------------------------------------------------ overpass

async function overpass(name, query, { required }) {
  const cacheFile = OSM_CACHE ? path.join(OSM_CACHE, `${name}.json`) : null;
  const t0 = Date.now();
  try {
    const json = await runOverpass(query, {
      timeoutMs: 15 * 60 * 1000,
      userAgent: UA,
      onAttempt: (url) => log(`${name}: querying ${url}`),
    });
    log(`${name}: ${json.elements.length} elements in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (cacheFile) {
      await mkdir(OSM_CACHE, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(json));
    }
    return { ok: true, elements: json.elements, osmBase: json.osm3s?.timestamp_osm_base };
  } catch (err) {
    log(`${name}: FAILED (${err.message})`);
    if (cacheFile && existsSync(cacheFile)) {
      log(`${name}: using cached copy ${cacheFile}`);
      const json = JSON.parse(await readFile(cacheFile, 'utf8'));
      return { ok: false, stale: true, elements: json.elements, osmBase: json.osm3s?.timestamp_osm_base };
    }
    if (required) log(`${name}: no data available for this part`);
    return { ok: false, elements: [] };
  }
}

// ------------------------------------------------------------------ merge

const MERGE_RADIUS_M = 120;

/** Merge a non-OSM place into the list (dedupe against nearby OSM places). */
function mergeInto(byCell, place, sourceKey) {
  const key = cellKey(place.y, place.x);
  const candidates = [];
  // look in this and neighbouring cells (places near a cell border)
  const [cy, cx] = key.split('_').map(Number);
  for (const dy of [-CELL_SIZE, 0, CELL_SIZE]) {
    for (const dx of [-CELL_SIZE, 0, CELL_SIZE]) {
      const list = byCell.get(`${cy + dy}_${cx + dx}`);
      if (list) candidates.push(...list);
    }
  }
  const same = candidates.find(
    (o) =>
      (o.k === 'p') === (place.k === 'p') &&
      distance(o.y, o.x, place.y, place.x) < MERGE_RADIUS_M &&
      (place.k === 'p' ? true : [o.n, ...Object.values(o.nl || {})].some((n) => namesMatch(n, place.n))),
  );
  if (same) {
    same.srcs = [...new Set([...(same.srcs || [same.src]), sourceKey])];
    const s = betterStatus(same.s, place.s);
    if (s !== same.s) {
      same.s = s;
      if (s !== 'U') delete same.why;
    }
    for (const f of ['a', 'ph', 'oh', 'ohx', 'w', 'ig', 'pt']) if (!same[f] && place[f]) same[f] = place[f];
    if (!same.cu?.length && place.cu?.length) same.cu = place.cu;
    if (!same.n && place.n) same.n = place.n;
    if (place.d && !same.d) same.d = place.d;
    return false;
  }
  if (!byCell.has(key)) byCell.set(key, []);
  byCell.get(key).push({ ...place, src: sourceKey });
  return true;
}

// ------------------------------------------------------------------ time zones

async function tzLookupFn() {
  try {
    const mod = await import('@photostructure/tz-lookup');
    const fn = mod.default || mod;
    return typeof fn === 'function' ? fn : null;
  } catch {
    log('time zones: @photostructure/tz-lookup not installed; cells get no tz (Korea defaults to Asia/Seoul in the app)');
    return null;
  }
}

// ------------------------------------------------------------------ main

async function main() {
  const started = Date.now();
  const sources = await loadSources();
  log(`local sources: ${sources.map((s) => `${s.file} (${s.places.length})`).join(', ') || 'none'}`);

  const parts = {};
  if (!OFFLINE) {
    const bbox = KOREA_ONLY ? KOREA_BBOX : null;
    parts.tagged = await overpass('tagged', taggedQuery(bbox), { required: true });
    parts.korea = await overpass('korea', koreaQuery(), { required: true });
    parts.names = await overpass('names', nameQuery(bbox), { required: false });
  }

  // Normalise OSM elements (dedupe by id; tagged results win because they come first)
  const byId = new Map();
  let osmBase = null;
  for (const [name, part] of Object.entries(parts)) {
    if (part.osmBase && (!osmBase || part.osmBase > osmBase)) osmBase = part.osmBase;
    for (const el of part.elements) {
      const id = `${el.type[0]}${el.id}`;
      if (byId.has(id)) continue;
      // Korea hints (cuisine-based) only make sense inside Korea.
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      const infer = name === 'names' || (name === 'korea' && isInKorea(lat, lon));
      const place = fromOsmElement(el, { infer });
      if (!place) continue;
      if (place.k === 'p' && !(name === 'korea' && isInKorea(place.y, place.x))) continue;
      byId.set(id, place);
    }
  }
  log(`OSM places: ${byId.size}`);

  const byCell = new Map();
  for (const p of byId.values()) {
    const key = cellKey(p.y, p.x);
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(p);
  }

  // Merge local sources. Official lists first, unconfirmed hints last.
  const order = (s) => (s.status === 'U' ? 2 : s.status === 'F' ? 0 : 1);
  sources.sort((a, b) => order(a) - order(b));
  const sourceStats = [];
  for (const src of sources) {
    let added = 0;
    for (const p of src.places) if (mergeInto(byCell, p, src.source)) added++;
    sourceStats.push({ source: src.source, file: src.file, records: src.places.length, added });
    log(`${src.file}: ${src.places.length} records, ${added} new, ${src.places.length - added} merged`);
  }

  // Write output
  const tzOf = await tzLookupFn();
  const cellsDir = path.join(OUT, 'cells');
  await rm(cellsDir, { recursive: true, force: true });
  await mkdir(cellsDir, { recursive: true });

  const index = {};
  const stats = { food: 0, prayer: 0, byStatus: {}, bySource: {}, korea: { food: 0, prayer: 0 } };
  let bytes = 0;
  for (const [key, list] of [...byCell.entries()].sort()) {
    list.sort((a, b) => (a.id < b.id ? -1 : 1));
    const food = list.filter((p) => p.k !== 'p');
    const prayer = list.length - food.length;
    for (const p of list) {
      compact(p);
      if (p.srcs && p.srcs.length < 2) delete p.srcs;
      const inKr = isInKorea(p.y, p.x);
      if (p.k === 'p') {
        stats.prayer++;
        if (inKr) stats.korea.prayer++;
      } else {
        stats.food++;
        stats.byStatus[p.s] = (stats.byStatus[p.s] || 0) + 1;
        if (inKr) stats.korea.food++;
      }
      for (const s of p.srcs || [p.src]) stats.bySource[s] = (stats.bySource[s] || 0) + 1;
    }
    const meanY = list.reduce((a, p) => a + p.y, 0) / list.length;
    const meanX = list.reduce((a, p) => a + p.x, 0) / list.length;
    let tz = null;
    if (tzOf) {
      try {
        tz = tzOf(meanY, meanX);
      } catch {
        tz = null;
      }
    }
    const json = JSON.stringify(list);
    bytes += json.length;
    await writeFile(path.join(cellsDir, `${key}.json`), json);
    index[key] = [food.length, +meanY.toFixed(4), +meanX.toFixed(4), tz || 0, prayer];
  }

  const partInfo = Object.fromEntries(
    Object.entries(parts).map(([k, v]) => [k, { ok: v.ok, stale: !!v.stale, elements: v.elements.length }]),
  );
  const out = {
    v: 1,
    generated: new Date().toISOString(),
    osmBase,
    cellSize: CELL_SIZE,
    mode: OFFLINE ? 'offline' : KOREA_ONLY ? 'korea-only' : 'full',
    overpass: partInfo,
    stats,
    sources: sources.map((s) => ({
      key: s.source,
      title: s.title,
      publisher: s.publisher,
      url: s.url,
      license: s.license,
      modified: s.modified,
    })),
    // cell key -> [food count, mean lat, mean lon, time zone or 0, prayer count]
    cells: index,
  };
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(out));
  log(
    `wrote ${Object.keys(index).length} cells, ${stats.food} food places, ${stats.prayer} prayer places ` +
      `(${(bytes / 1024).toFixed(0)} KiB) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  log(`by status: ${JSON.stringify(stats.byStatus)}; Korea: ${JSON.stringify(stats.korea)}`);
  log(`sources: ${JSON.stringify(sourceStats)}`);

  if (!OFFLINE && !parts.tagged.ok && !parts.tagged.stale) {
    // Still exit 0 so the site deploys; the app falls back to live Overpass queries.
    log('WARNING: worldwide OSM data missing in this build.');
    if (process.env.GITHUB_ACTIONS) console.log('::warning::Overpass query for tagged halal places failed; deployed without worldwide OSM data');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
