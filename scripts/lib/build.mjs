// Pure merge/normalisation steps of the data build (tested in tests/build.test.mjs).

import { fromOsmElement, betterStatus, MEAT_FREE, addressOf } from '../../assets/js/core/normalize.js';
import { cellKey, distance, isInKorea, CELL_SIZE } from '../../assets/js/core/geo.js';
import { namesMatch, allNames, coreName } from '../../assets/js/core/text.js';
import { soundsAlike, branchMarker, phoneticKey } from './phonetic.mjs';
import { STATUS_ORDER } from '../../assets/js/core/normalize.js';
import { BRAND_BY_ID, brandDiet, matchBrand, chainOfTags, branchName } from '../../assets/js/core/brands.js';

export const MERGE_RADIUS_M = 120;
// One restaurant listed in Korean by one source and in Latin letters by another
// ("호지보보" / "Hojibobo Uzbek Restaurant"): names are compared by sound, so
// the two must be closer together and of the same kind.
export const SOUND_MERGE_M = 60;
// The same shop mapped twice in OpenStreetMap (a node and a building, or a
// Korean and an English entry).
export const OSM_DUPLICATE_M = 30;
// The same chain shop from two sources (OpenStreetMap and the store registry).
export const CHAIN_MERGE_M = 80;
// OpenStreetMap chain shops that only fill gaps in the store registry: one this
// close to a registry branch of the chain, or with the same branch name within
// CHAIN_SAME_NAME_M (shops that moved, or positions that differ), is skipped.
export const CHAIN_GAP_M = 150;
export const CHAIN_SAME_NAME_M = 1500;

/**
 * Normalise Overpass results. parts = { tagged, korea, names } each with
 * { elements, osmBase }. The first part that yields a place for an element
 * id wins, so explicitly tagged results (listed first) take precedence.
 */
export function normalizeParts(parts) {
  const byId = new Map();
  const chainShops = new Map();
  let osmBase = null;
  for (const [name, part] of Object.entries(parts)) {
    if (part.osmBase && (!osmBase || part.osmBase > osmBase)) osmBase = part.osmBase;
    for (const el of part.elements || []) {
      const id = `${el.type[0]}${el.id}`;
      if (byId.has(id)) continue;
      // Plain chain shops (no diet tags): kept aside to fill registry gaps.
      if (name === 'chains') {
        const shop = chainFromOsm(el);
        if (shop) chainShops.set(id, shop);
        continue;
      }
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      // Only the Korea extras use generic cuisine-based hints and meat-free dishes;
      // the 'veg' part adds fully meat-free kitchens worldwide.
      const inKorea = isInKorea(lat, lon);
      const infer = name === 'korea' ? inKorea : name === 'veg' ? false : 'name';
      const veg = name === 'korea' ? inKorea : name === 'veg' ? 'only' : false;
      let place = fromOsmElement(el, { infer, veg });
      if (!place) continue;
      // A chain shop in Korea also gets the chain's meat-free dishes.
      if (inKorea && place.k !== 'p') {
        const t = el.tags || {};
        const brand = matchBrand(t.brand) || matchBrand(t['brand:ko']) || matchBrand(t.name) || matchBrand(t['name:ko']) || matchBrand(t['name:en']);
        if (brand) place = withBrand(place, brand);
      }
      // Prayer places are prebuilt for Korea only (elsewhere the app queries live).
      if (place.k === 'p' && !(name === 'korea' && isInKorea(place.y, place.x))) continue;
      byId.set(id, place);
    }
  }
  for (const id of byId.keys()) chainShops.delete(id);
  return { byId, osmBase, chainShops: [...chainShops.values()] };
}

/** A place for an OpenStreetMap shop of a listed chain in Korea, or null. */
export function chainFromOsm(el) {
  const t = el.tags || {};
  const y = el.lat ?? el.center?.lat;
  const x = el.lon ?? el.center?.lon;
  if (!Number.isFinite(y) || !Number.isFinite(x) || !isInKorea(y, x)) return null;
  const brand = chainOfTags(t);
  if (!brand) return null;
  const name = /[가-힣]/.test(t.name || '') ? t.name : t['name:ko'] || t.name || brand.name.ko;
  return applyBrand({
    id: `${el.type[0]}${el.id}`,
    n: branchName(brand, name, t.branch || t['branch:ko'] || ''),
    b: brand.id,
    y: Math.round(y * 1e5) / 1e5,
    x: Math.round(x * 1e5) / 1e5,
    k: brand.k,
    a: addressOf(t, y, x),
    src: 'osm',
  });
}

/** Branch part of a chain place's title, for matching: "도미노피자 염창점" -> "염창". */
function branchKey(p) {
  const brand = BRAND_BY_ID.get(p.b);
  if (!brand) return '';
  return String(p.n || '')
    .replace(brand.name.ko, '')
    .replace(/\s+/g, '')
    .replace(/점$/, '');
}

/**
 * Add OpenStreetMap chain shops that the other sources do not have (for
 * example the Lotteria inside Seoul Station). Returns how many were added.
 */
export function supplementChains(byCell, shops) {
  let added = 0;
  for (const shop of shops) {
    const key = cellKey(shop.y, shop.x);
    const [cy, cx] = key.split('_').map(Number);
    let known = false;
    for (const dy of [-CELL_SIZE, 0, CELL_SIZE]) {
      for (const dx of [-CELL_SIZE, 0, CELL_SIZE]) {
        for (const o of byCell.get(`${cy + dy}_${cx + dx}`) || []) {
          if (o.b !== shop.b) continue;
          const d = distance(o.y, o.x, shop.y, shop.x);
          const k = branchKey(shop);
          if (d < CHAIN_GAP_M || (k && k === branchKey(o) && d < CHAIN_SAME_NAME_M)) known = true;
        }
      }
    }
    if (known) continue;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(shop);
    added++;
  }
  return added;
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

const sameKind = (a, b) => a.k === b.k || (['r', 'f'].includes(a.k) && ['r', 'f'].includes(b.k));
const sharesName = (a, b) => allNames(a).some((n) => allNames(b).some((alt) => namesMatch(n, alt)));
const soundsSame = (a, b) => allNames(a).some((n) => allNames(b).some((alt) => soundsAlike(n, alt)));
const hasHangul = (s) => /[가-힣]/.test(s || '');

/** Fold `place` into `same`, the record already kept for that shop. */
function absorb(same, place, sourceKey, { names = false } = {}) {
  same.srcs = [...new Set([...(same.srcs || [same.src]), sourceKey])];
  if (place.b && !same.b) Object.assign(same, withBrand(same, BRAND_BY_ID.get(place.b)));
  if (place.id !== same.id) same.ids = [...new Set([...(same.ids || []), place.id, ...(place.ids || [])])];
  const s = betterStatus(same.s, place.s);
  if (s !== same.s) {
    same.s = s;
    if (s !== 'U') delete same.why;
  }
  for (const f of ['a', 'ph', 'oh', 'ohx', 'w', 'ig', 'pt', 'mu', 'su', 'ce', 'ck']) if (!same[f] && place[f]) same[f] = place[f];
  // Keep MUFKO's grade and page together even when this becomes an OSM/KTO record.
  if (place.mf && !same.mf) {
    same.mf = place.mf;
    same.mc = place.mc;
  }
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
  // Two scripts for one shop: the Korean name is the title, the Latin one its English name.
  if (names && place.n && same.n && place.n !== same.n) {
    if (hasHangul(place.n) && !hasHangul(same.n)) {
      same.nl = { en: same.n, ...same.nl };
      same.n = place.n;
    } else if (!hasHangul(place.n) && hasHangul(same.n) && /[a-z]/i.test(place.n) && !same.nl?.en) {
      same.nl = { ...same.nl, en: place.n };
    }
  }
  if (place.d && !same.d && same.src !== 'kto') same.d = place.d;
}

/** "미스터케밥" and "미스터케밥 2호점" are two shops; so are "강남점" and "역삼점". */
function differentBranch(a, b) {
  const ma = branchMarker(a.n);
  const mb = branchMarker(b.n);
  if (ma === mb) return false;
  return Boolean(ma && mb) || /^(\d+호점?|본점)$/.test(ma || mb);
}

/**
 * OpenStreetMap sometimes has one shop twice: as a node and as its building,
 * or once in Korean and once in English. Keep the better record (stronger
 * halal status, then more details) and fold the other into it. Chain branches
 * and prayer places are left alone. Returns { places, merged }.
 */
export function dedupeOsm(places) {
  const rank = (p) => (STATUS_ORDER[p.s] ?? 9) * 100 - Object.keys(p).length;
  const out = [];
  const grid = new Map();
  const cell = (y, x) => `${Math.floor(y * 500)}:${Math.floor(x * 500)}`; // about 200 m
  let merged = 0;
  for (const p of [...places].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1))) {
    let same = null;
    if (p.k !== 'p' && !p.b && p.n) {
      const cy = Math.floor(p.y * 500);
      const cx = Math.floor(p.x * 500);
      for (let i = -1; i <= 1 && !same; i++) {
        for (let j = -1; j <= 1 && !same; j++) {
          same = (grid.get(`${cy + i}:${cx + j}`) || []).find(
            (o) =>
              distance(o.y, o.x, p.y, p.x) < OSM_DUPLICATE_M &&
              sameKind(o, p) &&
              !differentBranch(o, p) &&
              (sharesName(o, p) || soundsSame(o, p)),
          );
        }
      }
    }
    if (same) {
      absorb(same, p, same.src || 'osm', { names: true });
      delete same.srcs;
      merged++;
      continue;
    }
    out.push(p);
    if (p.k !== 'p' && !p.b && p.n) {
      const key = cell(p.y, p.x);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(p);
    }
  }
  return { places: out, merged };
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
  const sameChain = (o) => o.b === place.b && o.src !== sourceKey && distance(o.y, o.x, place.y, place.x) < CHAIN_MERGE_M;
  let bySound = false;
  const same = candidates.find((o) => {
    // Branches of a chain from one source are separate shops even when they
    // are next to each other; from two sources they are the same shop,
    // whatever each source calls it ("Lotteria" / "롯데리아 강남역점").
    if (o.b && place.b) return sameChain(o);
    if ((o.k === 'p') !== (place.k === 'p')) return false;
    const d = distance(o.y, o.x, place.y, place.x);
    if (d >= MERGE_RADIUS_M) return false;
    // Nearby branches can share a brand while serving different menus.
    if ((['kto', 'mufko'].includes(sourceKey) || ['kto', 'mufko'].includes(o.src)) &&
        (!sameKind(o, place) || differentBranch(o, place))) return false;
    // MUFKO can list several distinct neighbours (URGUT / URGUT2, The Kebab /
    // Shohona Kebab). Within that directory only collapse clear duplicates;
    // different grades retain their own original pages and evidence.
    if (sourceKey === 'mufko' && o.mf) {
      return d < OSM_DUPLICATE_M && o.mc === place.mc && sameKind(o, place) &&
        allNames(o).some((a) => allNames(place).some((b) => coreName(a) === coreName(b)));
    }
    if (sourceKey === 'mufko' || o.mf) {
      if (allNames(o).some((a) => allNames(place).some((b) => coreName(a) === coreName(b)))) return true;
      // MUFKO supplies both scripts. Avoid substring/fuzzy matches that hide
      // different restaurants on a busy street; exact phonetic matches still
      // join a Korean public-data name to its English directory entry.
      bySound = d < SOUND_MERGE_M && sameKind(o, place) &&
        allNames(o).some((a) => allNames(place).some((b) => soundsAlike(a, b) && phoneticKey(a) === phoneticKey(b)));
      return bySound;
    }
    if (place.k === 'p') return true;
    if (sharesName(o, place)) return true;
    bySound = d < SOUND_MERGE_M && sameKind(o, place) && soundsSame(o, place);
    return bySound;
  });
  if (same) {
    absorb(same, place, sourceKey, { names: bySound || sourceKey === 'mufko' });
    return false;
  }
  if (!byCell.has(key)) byCell.set(key, []);
  byCell.get(key).push({ ...place, src: sourceKey });
  return true;
}

/**
 * Mark a place as a branch of a chain: keep what the place already says
 * (a halal status, its own dishes) and fill in the chain's dishes otherwise.
 */
export function withBrand(place, brand) {
  if (!brand) return place;
  const chain = applyBrand({ ...place, b: brand.id });
  return {
    ...place,
    b: brand.id,
    s: betterStatus(place.s, chain.s),
    dv: place.dv || chain.dv,
    nl: chain.nl,
    cu: place.cu?.length ? place.cu : chain.cu,
  };
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
