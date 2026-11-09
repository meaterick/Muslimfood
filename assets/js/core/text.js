// Text helpers for search and de-duplication (Hangul / Latin / Arabic aware).

import { BRAND_BY_ID } from './brands.js';

const PUNCT_RE = /[\s\-_.,'"`’‘“”·•・()（）[\]{}<>&!?/\\|:;@#*+~^=]+/g;
const GENERIC_RE =
  /(restaurant|restoran|restaurante|resto|kitchen|cafe|café|coffee|halal|food|foods|house|grill|the|레스토랑|식당|음식점|카페|할랄|푸드|본점|점$|مطعم|حلال|lokantası|lokanta|kafe)/g;

/** Lowercase, NFKC, strip punctuation/spaces. */
export function normText(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(PUNCT_RE, '');
}

// Fold accents on Latin letters for French and other Latin-script searches.
function searchText(s) {
  return normText(s).normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
}

/** normText without generic words such as "restaurant" / "식당" (for matching). */
export function coreName(s) {
  const n = normText(s).replace(GENERIC_RE, '');
  return n.length >= 2 ? n : normText(s);
}

/** Do two names plausibly refer to the same business? */
export function namesMatch(a, b) {
  const x = coreName(a);
  const y = coreName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short);
}

/** All names of a place (for search / matching). */
export function allNames(p) {
  const out = [p.n];
  if (p.nl) for (const v of Object.values(p.nl)) out.push(v);
  return out.filter(Boolean);
}

const HALAL = new Set(['C', 'O', 'Y', 'F', 'L']);
// Words people type when they look for meat-free food, in the UI languages.
const VEG_WORDS = ['vegetarian', 'vegan', 'veggie', 'plant based', '채식', '비건', '식물성', 'végétarien', 'végane', 'vejetaryen', 'نباتي'];

/** Every query token appears in a name, address, cuisine or listed dish. */
export function matchesQuery(p, query) {
  const tokens = String(query || '').normalize('NFKC').split(/\s+/).map(searchText).filter(Boolean);
  if (!tokens.length) return true;
  const brand = !p.mn?.length && BRAND_BY_ID.get(p.b);
  const dishes = brand ? brand.items.flatMap((i) => [i.n, i.en]) : [...(p.mn || []), ...Object.values(p.ml || {}).flat()];
  const fields = [...allNames(p), p.a, ...(p.cu || []), ...dishes].map(searchText);
  if (HALAL.has(p.s)) fields.push('halal');
  if (p.s === 'V' || p.s === 'M') fields.push(...VEG_WORDS.map(searchText));
  return tokens.every((t) => fields.some((value) => value.includes(t)));
}

/** Escape text for safe insertion into HTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
