// Do a Korean and a Latin name sound like the same word? "호지보보" and
// "Hojibobo", "케르반" and "Kervan", "베제투스" and "Vegetus". Used by the data
// build to merge one restaurant that two sources list in different scripts.
//
// Names are reduced to a consonant skeleton: Hangul is romanised syllable by
// syllable, vowels are dropped and consonants that loanwords swap (b/v/p/f,
// r/l, g/k, j/z/ch, d/t) share one letter.

const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

// Words that say what a place is, not what it is called.
const GENERIC =
  /\b(restaurant|resto|kitchen|cafe|coffee|bakery|halal|food|foods|house|grill|bar|bistro|the|and|turkish|indian|uzbek|korean|vegan|vegetarian)\b|레스토랑|식당|음식점|카페|베이커리|할랄|푸드|하우스|키친|본점|터키|인도|우즈벡/g;

/** Hangul syllables as Latin letters (vowels become "a": only consonants matter here). */
function romanize(s) {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      out += ch;
      continue;
    }
    out += `${INITIAL[Math.floor(code / 588)]}a${FINAL[code % 28]}`;
  }
  return out;
}

/** Consonant skeleton of a name, e.g. "Kervan Turkish Restaurant" -> "KLPN". */
export function phoneticKey(name) {
  let s = String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(GENERIC, ' ');
  s = romanize(s)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z]+/g, ' ');
  let key = '';
  for (const word of s.split(' ')) {
    const w = word
      .replace(/tch|ch|j|z|ts/g, 'C')
      .replace(/sh|ss|s|c(?=[eiy])/g, 'S')
      .replace(/ph|[bpvf]/g, 'P')
      .replace(/ng|n/g, 'N')
      .replace(/ck|x|[gkqc]/g, 'K')
      .replace(/th|[dt]/g, 'T')
      .replace(/[lr]/g, 'L')
      .replace(/m/g, 'M')
      .replace(/h/g, 'H')
      .replace(/[a-z]/g, '');
    key += w;
  }
  return key.replace(/(.)\1+/g, '$1');
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

const hasHangul = (s) => /[가-힣]/.test(s);
const hasLatin = (s) => /[a-z]/i.test(s);

/**
 * Do two names sound alike? Meant for a Korean name against a Latin one (the
 * same script is compared as text elsewhere), or two spellings in Hangul
 * ("쌀람" / "살람"). Returns false unless one name is Korean.
 */
export function soundsAlike(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!hasHangul(x) && !hasHangul(y)) return false;
  const kx = phoneticKey(x);
  const ky = phoneticKey(y);
  if (kx.length < 2 || ky.length < 2) return false;
  // Two Korean names must sound the same ("쌀람" / "살람"); looser matching is
  // for a Korean name against a Latin one, where spellings of loanwords drift.
  if (hasHangul(x) && hasHangul(y)) return kx === ky && kx.length >= 3;
  if (kx === ky) return true;
  if (!hasLatin(x) && !hasLatin(y)) return false;
  const [short, long] = kx.length <= ky.length ? [kx, ky] : [ky, kx];
  // One name inside the other ("Hojibobo Uzbek Restaurant" / "호지보보").
  if (short.length >= 3 && long.includes(short)) return true;
  // A letter or two apart, starting alike ("베제투스" / "Vegetus").
  return short.length >= 4 && kx[0] === ky[0] && 1 - editDistance(kx, ky) / long.length >= 0.75;
}

/** "2호점", "본점", "강남점": a marker that tells branches of one name apart. */
export function branchMarker(name) {
  const m = /(\d+\s*호점?|본점|[가-힣A-Za-z]+점)\s*$/.exec(String(name || '').trim());
  return m ? m[1].replace(/\s+/g, '') : '';
}
