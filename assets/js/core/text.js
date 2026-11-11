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

// Words for seafood, so "회", "초밥" or "seafood" find seafood restaurants.
export const SEA_WORDS = ['seafood', 'fish', 'sushi', 'sashimi', '해산물', '생선', '횟집', '회', '초밥', '스시', 'poisson', 'fruits de mer', 'makanan laut', 'ikan', 'deniz ürünleri', 'balık', 'مأكولات بحرية', 'سمك'];

// Dishes that usually come without meat (status D places), and the words people search them by.
export const DISH_WORDS = {
  pasta: ['파스타', '스파게티', '알리오올리오', 'pasta', 'spaghetti', 'aglio olio', 'makarna', 'pâtes'],
  pizza: ['피자', 'pizza', 'piza', 'بيتزا'],
  salad: ['샐러드', '포케', 'salad', 'poke', 'salade', 'salata', 'سلطة'],
  indian: ['커리', '카레', '인도음식', '인도요리', '네팔음식', 'curry', 'indian', 'kari', 'köri', 'كاري'],
  mexican: ['멕시칸', '부리또', '타코스', 'mexican', 'burrito', 'tacos', 'meksika'],
  porridge: ['죽', '팥죽', '호박죽', 'porridge', 'bubur', 'lapa', 'عصيدة'],
  kongguksu: ['콩국수', 'kongguksu', 'soybean noodles'],
  bibimbap: ['비빔밥', 'bibimbap'],
  tofu: ['두부', '순두부', 'tofu', 'tahu', 'tauhu'],
  tteokbokki: ['떡볶이', 'tteokbokki'],
  pajeon: ['파전', '해물파전', 'pajeon'],
  udon: ['우동', '소바', '모밀', 'udon', 'soba'],
  sanchae: ['산채', '산채비빔밥', '산채정식'],
  boribap: ['보리밥', 'boribap'],
  muk: ['도토리묵', '묵밥', 'dotorimuk'],
  ongsimi: ['옹심이', '감자전', 'gamjajeon'],
  thai: ['태국음식', '팟타이', 'pad thai', 'thai'],
};

// "halal" in the UI languages, so "할랄" or "حلال" finds every halal place.
const HALAL_WORDS = ['halal', '할랄', 'حلال', 'helal'];

// Searchable text per place, built once: typing checks thousands of places per keystroke.
const FIELDS = new WeakMap();

function searchFields(p) {
  let fields = FIELDS.get(p);
  if (fields) return fields;
  const brand = !p.mn?.length && BRAND_BY_ID.get(p.b);
  const dishes = brand ? brand.items.flatMap((i) => [i.n, i.en]) : [...(p.mn || []), ...Object.values(p.ml || {}).flat()];
  fields = [...allNames(p), p.a, ...(p.cu || []), ...dishes].map(searchText).filter(Boolean);
  if (HALAL.has(p.s)) fields.push(...HALAL_WORDS.map(searchText));
  if (p.s === 'V' || p.s === 'M') fields.push(...VEG_WORDS.map(searchText));
  if (p.s === 'S') fields.push(...SEA_WORDS.map(searchText));
  if (p.s === 'D') for (const c of p.cu || []) fields.push(...(DISH_WORDS[c] || []).map(searchText));
  FIELDS.set(p, fields);
  return fields;
}

/** Every query token appears in a name, address, cuisine or listed dish. */
export function matchesQuery(p, query) {
  const tokens = String(query || '').normalize('NFKC').split(/\s+/).map(searchText).filter(Boolean);
  if (!tokens.length) return true;
  const fields = searchFields(p);
  return tokens.every((t) => fields.some((value) => value.includes(t)));
}

/** Escape text for safe insertion into HTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
