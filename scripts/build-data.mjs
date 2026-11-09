#!/usr/bin/env node
// Build the static dataset served with the site:
//   data/index.json          cell summary + metadata (loaded first)
//   data/cells/<lat>_<lon>.json  places per 1°x1° cell (loaded on demand)
//
// Sources: OpenStreetMap via Overpass (worldwide halal-tagged places, and in
// Korea also halal names, likely-halal cuisines and mosques/prayer rooms)
// merged with the Korean public datasets in data/sources/*.json.
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
import { runOverpass, taggedQuery, koreaQuery, vegQuery } from '../assets/js/core/overpass.js';
import { compact } from '../assets/js/core/normalize.js';
import { isInKorea, KOREA_BBOX, CELL_SIZE } from '../assets/js/core/geo.js';
import { normalizeParts, groupByCell, mergeSources, searchRecords } from './lib/build.mjs';
import { BRANDS } from '../assets/js/core/brands.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);

const OFFLINE = flag('--offline');
const KOREA_ONLY = flag('--korea-only');
const OUT = path.resolve(ROOT, opt('--out', 'data'));
const OSM_CACHE = opt('--osm-cache', null);
// Overall time for all Overpass queries, so a hanging server cannot hit the workflow timeout.
const BUDGET_MS = Number(opt('--budget-min', 45)) * 60 * 1000;
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

async function overpass(name, query, { required, timeoutMs, deadline, minElements = 0 }) {
  const cacheFile = OSM_CACHE ? path.join(OSM_CACHE, `${name}.json`) : null;
  const t0 = Date.now();
  const accept = (json) => (json.elements.length < minElements ? `only ${json.elements.length} elements (expected at least ${minElements})` : null);
  try {
    const json = await runOverpass(query, {
      timeoutMs,
      deadline,
      accept,
      // The main server answers 429 when the shared CI runner IP has no free
      // slot; waiting usually works better than the smaller mirrors.
      retries: 4,
      retryDelayMs: 30000,
      userAgent: UA,
      onAttempt: (url, attempt) => log(`${name}: querying ${url}${attempt ? ` (retry ${attempt})` : ''}`),
      onError: (url, err) => log(`${name}: ${url} failed: ${err.message}${err.cause ? ` (${err.cause.code || err.cause.message})` : ''}`),
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
      const json = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (!accept(json)) {
        log(`${name}: using cached copy from ${json.osm3s?.timestamp_osm_base || 'an earlier run'}`);
        return { ok: false, stale: true, elements: json.elements, osmBase: json.osm3s?.timestamp_osm_base };
      }
      log(`${name}: cached copy ignored (${accept(json)})`);
    }
    if (required) log(`${name}: no data available for this part`);
    return { ok: false, elements: [] };
  }
}

// ------------------------------------------------------------------ time zones

async function tzLookupFn() {
  try {
    const mod = await import('@photostructure/tz-lookup');
    const fn = mod.default || mod;
    return typeof fn === 'function' ? fn : null;
  } catch {
    log('time zones: @photostructure/tz-lookup not installed; using Asia/Seoul for Korean cells');
    return null;
  }
}

// ------------------------------------------------------------------ main

async function main() {
  const started = Date.now();
  const sources = await loadSources();
  log(`local sources: ${sources.map((s) => `${s.file} (${s.places.length})`).join(', ') || 'none'}`);
  // Chain menus change; ask for a re-check of dishes checked more than six months ago.
  for (const b of BRANDS) {
    const days = (Date.now() - Date.parse(b.checked)) / 86400000;
    if (days > 183) console.warn(`::warning::${b.name.en} dishes were last checked on ${b.checked}; please re-check ${b.url} (assets/js/core/brands.js)`);
  }

  const parts = {};
  if (!OFFLINE) {
    const bbox = KOREA_ONLY ? KOREA_BBOX : null;
    const deadline = started + BUDGET_MS;
    const min = 60 * 1000;
    // Korea first: it matters most for this site and is the quickest.
    // Minimum sizes catch servers that answer "successfully" with missing data
    // (Korea returns ~120 elements, the worldwide query ~19,000).
    const korea = await overpass('korea', koreaQuery(300), { required: true, timeoutMs: 6 * min, deadline, minElements: 20 });
    const server = KOREA_ONLY ? 180 : 900; // Overpass [timeout:] in seconds
    const tagged = await overpass('tagged', taggedQuery(bbox, server), {
      required: true,
      timeoutMs: (server + 60) * 1000,
      deadline,
      minElements: KOREA_ONLY ? 5 : 5000,
    });
    // Fully vegan/vegetarian kitchens worldwide (about 8,000).
    const veg = await overpass('veg', vegQuery(bbox, KOREA_ONLY ? 180 : 600), {
      required: false,
      timeoutMs: ((KOREA_ONLY ? 180 : 600) + 60) * 1000,
      deadline,
      minElements: KOREA_ONLY ? 5 : 2000,
    });
    // Insertion order sets precedence when an element appears in several parts:
    // a halal tag wins over a meat-free tag.
    // The Korea query covers local names. Bounded live searches cover names elsewhere.
    Object.assign(parts, { tagged, korea, veg });
  }

  const { byId, osmBase } = normalizeParts(parts);
  log(`OSM places: ${byId.size}`);
  const byCell = groupByCell(byId.values());
  const sourceStats = mergeSources(byCell, sources);
  for (const st of sourceStats) log(`${st.file}: ${st.records} records, ${st.added} new, ${st.records - st.added} merged`);

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
    let tz = isInKorea(meanY, meanX) ? 'Asia/Seoul' : null;
    if (tzOf) {
      try {
        tz = tzOf(meanY, meanX);
      } catch { /* keep the geographic fallback */ }
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
  await writeFile(path.join(OUT, 'search.json'), JSON.stringify(searchRecords([...byCell.values()].flat())));
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
