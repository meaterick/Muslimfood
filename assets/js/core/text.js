// Text helpers for search and de-duplication (Hangul / Latin / Arabic aware).

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

/** Simple search match: every query token appears in some name/address/cuisine. */
export function matchesQuery(p, query) {
  const tokens = String(query || '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(PUNCT_RE, ''))
    .filter(Boolean);
  if (!tokens.length) return true;
  const hay = normText([...allNames(p), p.a || '', ...(p.cu || [])].join(' '));
  return tokens.every((t) => hay.includes(t));
}

/** Escape text for safe insertion into HTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
