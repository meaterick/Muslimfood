// Pure merge/normalisation steps of the data build (tested in tests/build.test.mjs).

import { fromOsmElement, betterStatus, MEAT_FREE } from '../../assets/js/core/normalize.js';
import { cellKey, distance, isInKorea, CELL_SIZE } from '../../assets/js/core/geo.js';
import { namesMatch } from '../../assets/js/core/text.js';
import { BRAND_BY_ID, brandDiet } from '../../assets/js/core/brands.js';

export const MERGE_RADIUS_M = 120;

/**
 * Normalise Overpass results. parts = { tagged, korea, names } each with
 * { elements, osmBase }. The first part that yields a place for an element
 * id wins, so explicitly tagged results (listed first) take precedence.
 */
export function normalizeParts(parts) {
  const byId = new Map();
  let osmBase = null;
  for (const [name, part] of Object.entries(parts)) {
    if (part.osmBase && (!osmBase || part.osmBase > osmBase)) osmBase = part.osmBase;
    for (const el of part.elements || []) {
      const id = `${el.type[0]}${el.id}`;
      if (byId.has(id)) continue;
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      // Only the Korea extras use generic cuisine-based hints and meat-free dishes;
      // the 'veg' part adds fully meat-free kitchens worldwide.
      const inKorea = isInKorea(lat, lon);
      const infer = name === 'korea' ? inKorea : name === 'veg' ? false : 'name';
      const veg = name === 'korea' ? inKorea : name === 'veg' ? 'only' : false;
      const place = fromOsmElement(el, { infer, veg });
      if (!place) continue;
      // Prayer places are prebuilt for Korea only (elsewhere the app queries live).
      if (place.k === 'p' && !(name === 'korea' && isInKorea(place.y, place.x))) continue;
      byId.set(id, place);
    }
  }
  return { byId, osmBase };
}

export function groupByCell(places) {
  const byCell = new Map();
  for (const p of places) {
    const key = cellKey(p.y, p.x);
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(p);
  }
  return byCell;
}

/** Merge one non-OSM place, de-duplicating against nearby places. Returns true when added. */
export function mergeInto(byCell, place, sourceKey) {
  const key = cellKey(place.y, place.x);
  const [cy, cx] = key.split('_').map(Number);
  const candidates = [];
  for (const dy of [-CELL_SIZE, 0, CELL_SIZE]) {
    for (const dx of [-CELL_SIZE, 0, CELL_SIZE]) {
      const list = byCell.get(`${cy + dy}_${cx + dx}`);
      if (list) candidates.push(...list);
    }
  }
  const same = candidates.find(
    (o) =>
      (o.k === 'p') === (place.k === 'p') &&
      // Branches of chains are separate shops even when they are next to each other.
      !(o.b && place.b) &&
      distance(o.y, o.x, place.y, place.x) < MERGE_RADIUS_M &&
      // Nearby branches can share a brand while serving different menus.
      ((sourceKey !== 'kto' && o.src !== 'kto') || o.k === place.k ||
        (['r', 'f'].includes(o.k) && ['r', 'f'].includes(place.k))) &&
      (place.k === 'p' || [o.n, ...Object.values(o.nl || {})].some((n) =>
        [place.n, ...Object.values(place.nl || {})].some((alt) => namesMatch(n, alt)))),
  );
  if (same) {
    same.srcs = [...new Set([...(same.srcs || [same.src]), sourceKey])];
    if (place.id !== same.id) same.ids = [...new Set([...(same.ids || []), place.id])];
    const s = betterStatus(same.s, place.s);
    if (s !== same.s) {
      same.s = s;
      if (s !== 'U') delete same.why;
    }
    for (const f of ['a', 'ph', 'oh', 'ohx', 'w', 'ig', 'pt', 'mu', 'su']) if (!same[f] && place[f]) same[f] = place[f];
    // Menu names, translations and diet labels belong together.
    if (!same.mn?.length && place.mn?.length) {
      same.mn = place.mn;
      if (place.ml) same.ml = place.ml;
      if (place.mv) same.mv = place.mv;
    }
    // Meat-free details stay useful on a place that is (more strongly) halal.
    if (MEAT_FREE.has(place.s) || place.v) same.v = 1;
    if (place.dv && !same.dv) same.dv = place.dv;
    if (!same.cu?.length && place.cu?.length) same.cu = place.cu;
    if (place.nl) same.nl = { ...place.nl, ...same.nl };
    if (!same.n && place.n) same.n = place.n;
    if (place.d && !same.d && same.src !== 'kto') same.d = place.d;
    return false;
  }
  if (!byCell.has(key)) byCell.set(key, []);
  byCell.get(key).push({ ...place, src: sourceKey });
  return true;
}

/**
 * A chain branch (place.b) gets the chain's meat-free dishes from
 * assets/js/core/brands.js; branches of chains no longer listed are dropped.
 */
export function applyBrand(place) {
  const brand = BRAND_BY_ID.get(place.b);
  if (!brand) return null;
  return {
    ...place,
    k: place.k || brand.k,
    s: 'M',
    dv: brandDiet(brand),
    nl: { en: brand.name.en, ...place.nl },
    cu: place.cu || brand.cu,
    mn: brand.items.map((i) => i.n),
    ml: { en: brand.items.map((i) => i.en) },
    mv: brand.items.map((i) => i.d),
  };
}

/** Merge local source files: official lists first, unconfirmed hints last. */
export function mergeSources(byCell, sources) {
  // Halal lists first, then meat-free lists, unconfirmed hints last.
  const order = (s) => (s.status === 'U' ? 3 : s.status === 'F' ? 0 : MEAT_FREE.has(s.status) ? 2 : 1);
  const stats = [];
  for (const src of [...sources].sort((a, b) => order(a) - order(b))) {
    let added = 0;
    let records = 0;
    for (const raw of src.places) {
      const p = raw.b ? applyBrand(raw) : raw;
      if (!p) continue;
      records++;
      if (mergeInto(byCell, p, src.source)) added++;
    }
    stats.push({ source: src.source, file: src.file, records, added });
  }
  return stats;
}

/** Compact search rows with coordinates for loading the matching cell on selection. */
export function searchRecords(places) {
  return places.filter((p) => p.n && p.k !== 'p').map(({ id, n, nl, y, x, k, s, dv, a, cu, mn, ml, b }) =>
    ({ id, n, nl, y, x, k, s, dv, a, cu, mn, ml, b }));
}
