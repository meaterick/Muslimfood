// What should happen when a search is submitted: go to an area or station,
// open one restaurant, show every match on the map, or ask the geocoder.
// Pure functions, shared by the search box and the tests.

import { normText, matchesQuery, allNames, SEA_WORDS } from './text.js';

const SEA_KEYS = new Set(SEA_WORDS.map((w) => normText(w)));
/** Is this text a word for seafood ("회", "초밥", "seafood")? */
export const isSeafoodWord = (text) => SEA_KEYS.has(normText(text));

/** A place name without spaces, accents or the "역" / "Station" suffix. */
export function locationKey(s) {
  let k = normText(s).normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
  k = k.replace(/(station|stn)$/, '');
  if (k.length > 2 && k.endsWith('역')) k = k.slice(0, -1);
  return k;
}

const dist2 = (c, y, x) => (c ? (y - c.lat) ** 2 + ((x - c.lon) * Math.cos((c.lat * Math.PI) / 180)) ** 2 : 0);

// A keyword next to a place name counts only when something matches this close to the place.
const NEAR_KM = 50;

/** { lat, lon } of an area preset or station. */
export function locPoint(loc) {
  return loc.kind === 'area' ? { lat: loc.area.y, lon: loc.area.x } : { lat: loc.y, lon: loc.x };
}

/**
 * Area presets and stations that match a query.
 *   areas:    [{ id, y, x, z, n: { ko, en, ... } }]
 *   stations: [[korean, english or 0, lat, lon]]
 * Returns { exact, partial }: lists of { kind: 'area', area } and
 * { kind: 'station', ko, en, y, x }. Same-named stations are ordered by
 * distance from `center`.
 */
export function findLocations(query, areas = [], stations = [], { center = null, limit = 5 } = {}) {
  const qk = locationKey(query);
  const out = { exact: [], partial: [] };
  if (!qk) return out;
  const seen = new Set();
  for (const area of areas) {
    const keys = Object.values(area.n).map(locationKey);
    if (keys.includes(qk)) {
      out.exact.push({ kind: 'area', area });
      for (const k of keys) seen.add(k);
    } else if (qk.length >= 2 && keys.some((k) => k.includes(qk))) out.partial.push({ kind: 'area', area });
  }
  const st = { exact: [], starts: [], has: [] };
  for (const [ko, en, y, x] of stations || []) {
    const kk = locationKey(ko);
    const ek = en ? locationKey(en) : '';
    const row = { kind: 'station', ko, en: en || '', y, x, d: dist2(center, y, x) };
    if (kk === qk || ek === qk) {
      // An area preset of the same name ("강남역") already covers this station.
      if (!seen.has(kk) && !(ek && seen.has(ek))) st.exact.push(row);
    } else if (qk.length >= 2 && (kk.startsWith(qk) || (ek && ek.startsWith(qk)))) st.starts.push(row);
    else if (qk.length >= 2 && (kk.includes(qk) || (ek && ek.includes(qk)))) st.has.push(row);
  }
  const near = (a, b) => a.d - b.d;
  out.exact.push(...st.exact.sort(near));
  out.partial.push(...st.starts.sort(near), ...st.has.sort(near));
  out.partial = out.partial.slice(0, limit);
  return out;
}

/**
 * "명동 케밥" / "halal gangnam": split a query into a keyword and a location.
 * `locate(text)` returns a location or null. Returns { keyword, loc } or null.
 */
export function splitQuery(query, locate) {
  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  for (let k = Math.min(3, tokens.length - 1); k >= 1; k--) {
    for (const [locTokens, rest] of [
      [tokens.slice(-k), tokens.slice(0, -k)],
      [tokens.slice(0, k), tokens.slice(k)],
    ]) {
      const loc = locate(locTokens.join(' '));
      if (loc) return { keyword: rest.join(' '), loc };
    }
  }
  return null;
}

const exactName = (p, q) => allNames(p).some((n) => normText(n) === normText(q));
const inName = (p, q) => matchesQuery({ n: p.n, nl: p.nl }, q);

/**
 * Decide what a submitted search does.
 * Returns one of
 *   { kind: 'location', loc }                  go there and drop a pin
 *   { kind: 'place', place }                   open this restaurant
 *   { kind: 'keyword', text, matches, loc }    show the matches (near loc, if given)
 *   { kind: 'seafood', loc }                   show seafood restaurants (around loc)
 *   { kind: 'geocode', fallback }              nothing local: ask the geocoder
 *                                              (fallback: a location named in the query)
 */
export function planSearch(query, { areas = [], stations = [], places = [], center = null } = {}) {
  const q = String(query || '').trim();
  if (!normText(q)) return { kind: 'none' };
  const locate = (text) => findLocations(text, areas, stations, { center }).exact[0] || null;
  const loc = locate(q);
  if (loc) return { kind: 'location', loc };
  // "seafood", "명동 회", "sushi gangnam": seafood restaurants (a layer of their own).
  if (isSeafoodWord(q)) return { kind: 'seafood', loc: null };
  const seaSplit = splitQuery(q, locate);
  if (seaSplit && isSeafoodWord(seaSplit.keyword)) return { kind: 'seafood', loc: seaSplit.loc };

  const list = Array.isArray(places) ? places : [...places];
  const find = (text) => list.filter((p) => p.n && matchesQuery(p, text));
  const decide = (text, matches, where) => {
    // Prayer places only show with their own filter, so prefer food matches.
    const food = matches.filter((p) => p.k !== 'p');
    const pool = food.length ? food : matches;
    if (!where) {
      const exact = pool.filter((p) => exactName(p, text));
      if (exact.length === 1) return { kind: 'place', place: exact[0] };
      if (pool.length === 1 && inName(pool[0], text)) return { kind: 'place', place: pool[0] };
    }
    return { kind: 'keyword', text, matches: pool, loc: where };
  };

  // A restaurant typed by its exact name wins over any reading of the words.
  const matches = find(q);
  const exact = matches.filter((p) => exactName(p, q));
  if (exact.length === 1) return { kind: 'place', place: exact[0] };
  // "halal gangnam", "명동 케밥": the keyword around that place. Only when
  // something matches near it: "Seoul Tower" must not turn into restaurants
  // called "Tower" on another continent.
  const split = splitQuery(q, locate);
  if (split) {
    const at = locPoint(split.loc);
    const near = find(split.keyword);
    if (near.some((p) => Math.sqrt(dist2(at, p.y, p.x)) * 111 < NEAR_KM)) return decide(split.keyword, near, split.loc);
  }
  if (matches.length) return decide(q, matches, null);
  // One area or station contains the text ("hongik" -> Hongik Univ. station): go there.
  const partial = findLocations(q, areas, stations, { center }).partial;
  if (partial.length === 1) return { kind: 'location', loc: partial[0] };
  // Nothing local. "Seoul Tower" must reach the geocoder, but for "강남역 맛집"
  // the station is still a better answer than "no results".
  return { kind: 'geocode', fallback: split?.loc || partial[0] || null };
}
