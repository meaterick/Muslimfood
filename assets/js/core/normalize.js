// Turn OpenStreetMap elements (and other sources) into the compact "place"
// records the app works with. Shared by the browser (live Overpass fallback)
// and the Node data build, so keep it dependency-free.
//
// Place record (all fields optional except id, n, y, x, k):
//   id   "n123" / "w123" / "r123" for OSM, "<source>-<n>" for other sources
//   ids  aliases for links to records merged into this place
//   n    display name (local language)
//   nl   { en, ko, ar, ... } localized names that differ from `n`
//   y,x  latitude, longitude
//   k    category: r restaurant, f fast food, c cafe/dessert/bakery, m market/butcher, o other, p prayer place
//   s    halal status: C certified, O only halal, Y halal, L limited halal options,
//        F listed by an official Muslim-friendly programme, U unconfirmed (inferred);
//        meat-free alternatives: V whole menu vegetarian/vegan, M has vegetarian/vegan dishes
//   dv   for s=V/M: "vegan" | "vegetarian"
//   why  for s=U: "name" (name says halal) or "cuisine" (cuisine usually halal)
//   cu   cuisine tokens, e.g. ["turkish","kebab"]
//   a    address, ph phone, w website, ig instagram url, oh opening_hours (OSM syntax)
//   mu   menu URL, mn menu item names, ml localized menu item names, su source page URL
//   mv   diet label per item in mn: "v" vegan, "l" lacto, "o" ovo, "lo" lacto-ovo, "" unknown
//   ohx  free-text opening hours when it could not be converted
//   ck   date the halal status was last checked (YYYY-MM-DD)
//   ce   certification body / note
//   al   1 serves alcohol, 0 alcohol-free (absent = unknown)
//   nh   1 also serves non-halal food
//   pf   1 pork-free
//   v    1 vegetarian options
//   pr   1 prayer space available
//   pt   for k=p: "mosque" | "musalla"
//   src  primary source key ("osm", "gg", "kcisa", "cur"); srcs = all sources after merging
//   ap   1 approximate location (geocoded at street level)
//   d    source date (YYYY-MM-DD) for non-OSM data

import { roundCoord, isInKorea } from './geo.js';

export const UI_LANGS = ['en', 'ko', 'ar', 'id', 'ms', 'tr', 'fr'];
const NAME_LANGS = [...UI_LANGS, 'ja', 'zh'];

// Strongest evidence first. A fully meat-free kitchen (V) ranks above an
// unconfirmed halal hint (U); a normal kitchen with vegetarian dishes (M) last.
export const STATUS_ORDER = { C: 0, O: 1, Y: 2, F: 3, L: 4, V: 5, U: 6, M: 7 };
export const MEAT_FREE = new Set(['V', 'M']);

const AMENITY_CAT = {
  restaurant: 'r',
  food_court: 'r',
  canteen: 'r',
  fast_food: 'f',
  cafe: 'c',
  ice_cream: 'c',
  marketplace: 'm',
  bar: 'o',
  pub: 'o',
  biergarten: 'o',
  hookah_lounge: 'o',
};
const SHOP_CAT = {
  bakery: 'c',
  pastry: 'c',
  confectionery: 'c',
  coffee: 'c',
  tea: 'c',
  chocolate: 'c',
  butcher: 'm',
  supermarket: 'm',
  convenience: 'm',
  grocery: 'm',
  greengrocer: 'm',
  deli: 'm',
  general: 'm',
  food: 'm',
  frozen_food: 'm',
  seafood: 'm',
  spices: 'm',
  health_food: 'm',
  dairy: 'm',
  halal: 'm',
  wholesale: 'm',
  variety_store: 'm',
  department_store: 'm',
};
const LODGING = new Set(['hotel', 'guest_house', 'hostel', 'motel', 'apartment', 'resort']);
const ALCOHOL_AMENITIES = new Set(['bar', 'pub', 'biergarten', 'nightclub']);

/** Category letter for a tag set, or null when the place is not food related. */
export function categoryOf(tags) {
  if (tags.amenity === 'place_of_worship' && tags.religion === 'muslim') return 'p';
  if (tags.amenity && AMENITY_CAT[tags.amenity]) return AMENITY_CAT[tags.amenity];
  if (tags.shop && SHOP_CAT[tags.shop]) return SHOP_CAT[tags.shop];
  if (tags.tourism && LODGING.has(tags.tourism)) return 'o';
  if (tags.amenity === 'nightclub') return 'o';
  if (tags.cuisine) return 'r';
  return null;
}

const CERT_KEY_RE = /^(diet:)?halal:(certif|cert|authority)|^certification:halal|^ref:halal/;

/** Certification body/note if any certification tag is present. */
export function certificationOf(tags) {
  for (const [k, v] of Object.entries(tags)) {
    if (!CERT_KEY_RE.test(k)) continue;
    const val = String(v).trim();
    if (!val || /^no$/i.test(val)) continue;
    return /^yes$/i.test(val) ? 'yes' : val;
  }
  return null;
}

/** Halal status from explicit tags, or null when there is no positive tag. */
export function taggedStatus(tags) {
  const raw = String(tags['diet:halal'] ?? tags.halal ?? '').toLowerCase().trim();
  if (raw === 'no' || raw === '') {
    // a certification without diet tag still counts
    if (raw === '' && certificationOf(tags)) return 'C';
    return null;
  }
  if (certificationOf(tags) && (raw === 'only' || raw === 'yes')) return 'C';
  if (raw === 'only') return 'O';
  if (raw === 'yes' || raw === 'halal') return 'Y';
  if (raw === 'limited' || raw === 'some') return 'L';
  return null;
}

export const HALAL_NAME_RE = /halal|حلال|할랄|清真|ハラール|ハラル|helal|ḥalāl/i;
const NON_HALAL_NAME_RE = /non[\s-]?halal|not\s+halal|pas\s+halal|비할랄|非清真/i;

// Cuisines that are, in practice, almost always prepared halal in
// non-Muslim-majority countries (e.g. Korea). Used only for *unconfirmed* hints.
export const LIKELY_HALAL_CUISINES = new Set([
  'turkish', 'kebab', 'doner', 'döner', 'kebap', 'uzbek', 'pakistani', 'arab', 'arabic',
  'lebanese', 'middle_eastern', 'persian', 'iranian', 'afghan', 'indonesian', 'malaysian',
  'egyptian', 'moroccan', 'bangladeshi', 'syrian', 'iraqi', 'yemeni', 'saudi', 'kazakh',
  'kyrgyz', 'uyghur', 'uighur', 'tajik', 'turkmen', 'kurdish', 'palestinian', 'jordanian',
  'tunisian', 'algerian', 'libyan', 'sudanese', 'somali', 'emirati', 'kuwaiti', 'qatari',
  'omani', 'bahraini', 'azerbaijani', 'shawarma', 'falafel', 'halal', 'mandi', 'central_asian',
  'brunei', 'bruneian', 'maldivian', 'chechen', 'dagestani', 'tatar', 'hui',
]);
const LIKELY_NAME_RE =
  /케밥|kebab|kebap|döner|doner|shawarma|샤와르마|사마르칸트|samarkand|타슈켄트|tashkent|우즈벡|uzbek|이스탄불|istanbul|튀르키예|turkish|아랍|arabian|arabic|파키스탄|pakistan|인도네시아|indonesia|말레이시아|malaysia|부하라|bukhara|خوارزم|مطعم/i;

/** Normalised cuisine tokens from the OSM cuisine tag. */
export function cuisineTokens(tags) {
  const raw = tags.cuisine;
  if (!raw) return [];
  const out = [];
  for (let t of String(raw).split(/[;,]/)) {
    t = t.trim().toLowerCase().replace(/\s+/g, '_');
    if (!t || t.length > 40) continue;
    if (t === 'non_halal' || t === 'non-halal') continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

/** Cuisine group used for filtering / labels. */
const CUISINE_GROUPS = {
  middle_eastern: ['arab', 'arabic', 'lebanese', 'syrian', 'iraqi', 'yemeni', 'saudi', 'palestinian', 'jordanian', 'emirati', 'kuwaiti', 'qatari', 'omani', 'bahraini', 'middle_eastern', 'persian', 'iranian', 'shawarma', 'falafel', 'mandi', 'kurdish', 'egyptian', 'moroccan', 'tunisian', 'algerian', 'libyan', 'mediterranean', 'hummus'],
  turkish: ['turkish', 'kebab', 'doner', 'döner', 'kebap', 'azerbaijani', 'pide', 'lahmacun'],
  south_asian: ['indian', 'pakistani', 'bangladeshi', 'nepalese', 'nepali', 'sri_lankan', 'afghan', 'curry', 'biryani', 'tandoori', 'maldivian', 'north_indian', 'south_indian', 'punjabi'],
  southeast_asian: ['malaysian', 'indonesian', 'singaporean', 'thai', 'filipino', 'brunei', 'bruneian', 'vietnamese', 'asian', 'nasi_lemak', 'satay', 'padang'],
  central_asian: ['uzbek', 'kazakh', 'kyrgyz', 'tajik', 'uyghur', 'uighur', 'turkmen', 'central_asian', 'russian', 'tatar', 'chechen', 'dagestani', 'mongolian', 'georgian'],
  korean: ['korean', 'korean_bbq', 'bibimbap'],
  east_asian: ['chinese', 'japanese', 'ramen', 'sushi', 'hui', 'lanzhou', 'noodle', 'dumpling', 'hot_pot', 'taiwanese', 'udon'],
  african: ['african', 'ethiopian', 'somali', 'nigerian', 'senegalese', 'sudanese', 'eritrean', 'west_african', 'east_african'],
  western: ['american', 'burger', 'pizza', 'italian', 'mexican', 'steak_house', 'sandwich', 'chicken', 'fried_chicken', 'french', 'british', 'fish_and_chips', 'grill', 'bbq', 'barbecue', 'western', 'european', 'spanish', 'greek', 'portuguese', 'german', 'brazilian', 'peruvian', 'tex-mex', 'wings', 'hot_dog'],
  seafood: ['seafood', 'fish', 'sushi'],
  vegetarian: ['vegetarian', 'vegan', 'salad'],
  cafe: ['coffee_shop', 'coffee', 'dessert', 'ice_cream', 'cake', 'bakery', 'tea', 'bubble_tea', 'donut', 'crepe', 'juice', 'pastry', 'waffle', 'frozen_yogurt', 'chocolate', 'patisserie', 'breakfast', 'brunch'],
};
const TOKEN_TO_GROUP = {};
for (const [g, toks] of Object.entries(CUISINE_GROUPS)) for (const t of toks) TOKEN_TO_GROUP[t] ??= g;
export const CUISINE_GROUP_KEYS = Object.keys(CUISINE_GROUPS);

export function cuisineGroupOf(token) {
  return TOKEN_TO_GROUP[token] || null;
}

/** First matching cuisine group of a place (or null). */
export function placeCuisineGroup(place) {
  for (const t of place.cu || []) {
    const g = cuisineGroupOf(t);
    if (g) return g;
  }
  return null;
}

/** Heuristic for elements without an explicit halal tag. */
export function inferStatus(tags) {
  const names = [tags.name, tags.brand, ...Object.entries(tags).filter(([key]) => key.startsWith('name:')).map(([, value]) => value)].filter(Boolean).join(' ');
  if (NON_HALAL_NAME_RE.test(names)) return null;
  const cu = cuisineTokens(tags);
  if (HALAL_NAME_RE.test(names) || cu.includes('halal') || tags.shop === 'halal' || tags.butcher === 'halal') {
    return { s: 'U', why: 'name' };
  }
  if (cu.some((t) => LIKELY_HALAL_CUISINES.has(t))) return { s: 'U', why: 'cuisine' };
  if (names && LIKELY_NAME_RE.test(names)) return { s: 'U', why: 'cuisine' };
  return null;
}

/** Meat-free status from diet:vegan / diet:vegetarian tags, or null. */
export function vegStatus(tags) {
  const val = (k) => String(tags[k] || '').trim().toLowerCase();
  const vegan = val('diet:vegan');
  const vegetarian = val('diet:vegetarian');
  if (vegan === 'only') return { s: 'V', dv: 'vegan' };
  if (vegetarian === 'only') return { s: 'V', dv: 'vegetarian' };
  const some = (v) => v === 'yes' || v === 'limited';
  if (some(vegan)) return { s: 'M', dv: 'vegan' };
  if (some(vegetarian)) return { s: 'M', dv: 'vegetarian' };
  return null;
}

function alcoholOf(tags) {
  if (ALCOHOL_AMENITIES.has(tags.amenity)) return 1;
  const v = (k) => String(tags[k] || '').toLowerCase();
  if (v('alcohol') === 'no' || v('drink:alcohol') === 'no') return 0;
  const yes = (k) => ['yes', 'served', 'limited', 'retail'].includes(v(k));
  if (
    yes('alcohol') ||
    yes('drink:alcohol') ||
    v('bar') === 'yes' ||
    ['drink:beer', 'drink:wine', 'drink:spirits', 'drink:liquor', 'drink:soju', 'drink:cocktail', 'drink:sake'].some(yes)
  ) {
    return 1;
  }
  return undefined;
}

function firstOf(tags, keys) {
  for (const k of keys) {
    const v = tags[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

export function cleanUrl(u) {
  if (typeof u !== 'string') return undefined;
  u = u.split(';')[0].trim();
  if (!u) return undefined;
  if (/^www\./i.test(u)) u = 'https://' + u;
  if (!/^https?:\/\//i.test(u)) return undefined;
  try {
    return new URL(u).hostname ? u : undefined;
  } catch {
    return undefined;
  }
}

function instagramOf(tags) {
  const raw = firstOf(tags, ['contact:instagram', 'instagram']);
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw.split(';')[0];
  const handle = raw.replace(/^@/, '').split(/[;\s]/)[0];
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : undefined;
}

// Address order differs per region; this is display-only so a coarse rule is fine.
function numberFirst(lat, lon) {
  if (lon < -50 && lat >= 24) return true; // US / Canada
  if (lon < -30) return false; // Latin America: "Calle X 123"
  if (lat > 49.8 && lat < 61 && lon > -11 && lon < 2) return true; // UK, Ireland
  if (lat > 41 && lat < 51.1 && lon > -5 && lon < 7.5 && !(lat > 49.5 && lon > 2.5)) return true; // France
  if (lat > 35 && lat < 72 && lon > -10 && lon < 45) return false; // continental Europe
  if (lat > 12 && lat < 42 && lon >= 25 && lon < 63) return false; // Turkey, Middle East
  if (lat > -11 && lat < 6 && lon > 95 && lon < 141) return false; // Indonesia: "Jl. X No. 1"
  return true;
}

/** Human-readable address from addr:* tags. */
export function addressOf(tags, lat, lon) {
  if (tags['addr:full']) return String(tags['addr:full']).trim();
  const hn = tags['addr:housenumber'];
  const st = tags['addr:street'] || tags['addr:place'];
  const city = tags['addr:city'];
  const district = tags['addr:district'] || tags['addr:suburb'];
  const prov = tags['addr:province'] || tags['addr:state'];
  if (!st && !hn && !city) return undefined;
  if (isInKorea(lat, lon)) {
    const parts = [prov, city, district, st, hn].filter(Boolean);
    return parts.filter((p, i) => p !== parts[i - 1]).join(' ');
  }
  // Japan / China / Taiwan: big-to-small without separators
  if (lat > 20 && lat < 46 && lon > 100 && lon < 146) {
    const parts = [prov, city, district, tags['addr:quarter'], tags['addr:neighbourhood'], st, tags['addr:block_number'], hn].filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  const street = st ? (numberFirst(lat, lon) ? [hn, st] : [st, hn]).filter(Boolean).join(' ') : hn;
  return [street, district, city].filter(Boolean).join(', ') || undefined;
}

function localizedNames(tags, main) {
  const nl = {};
  for (const l of NAME_LANGS) {
    const v = tags[`name:${l}`];
    if (v && v !== main) nl[l] = String(v).trim();
  }
  return Object.keys(nl).length ? nl : undefined;
}

function prayerType(tags) {
  const name = `${tags.name || ''} ${tags['name:en'] || ''}`;
  const pow = tags.place_of_worship || '';
  if (/musall?a|prayer|기도|예배소|مصلى|namaz/i.test(name) || /musalla|prayer_room/.test(pow)) return 'musalla';
  if (tags.building === 'mosque' || pow === 'mosque' || /mosque|masjid|모스크|성원|مسجد|cami|masjed/i.test(name)) return 'mosque';
  return tags.indoor || tags.level ? 'musalla' : 'mosque';
}

/** Drop undefined / empty values to keep JSON small. */
export function compact(obj) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete obj[k];
  }
  return obj;
}

/**
 * Convert one Overpass JSON element into a place record.
 * opts.infer: allow an unconfirmed status when there is no halal tag:
 *   'name' = only when there is a halal claim in the name or category,
 *   true = also from a likely cuisine (Korea).
 * opts.veg: allow meat-free places without a halal tag:
 *   'only' = whole menu vegetarian/vegan, true = also places with such dishes.
 * Returns null for elements that should not be shown.
 */
export function fromOsmElement(el, opts = {}) {
  const tags = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const k = categoryOf(tags);
  if (!k) return null;

  let s;
  let why;
  let dv;
  if (k === 'p') {
    s = undefined;
  } else {
    const nonHalalOnly = String(tags['diet:non-halal'] || '').trim().toLowerCase() === 'only';
    if (nonHalalOnly) return null;
    s = taggedStatus(tags);
    if (!s) {
      if (String(tags['diet:halal'] ?? tags.halal ?? '').trim().toLowerCase() === 'no') return null;
      let inf = opts.infer ? inferStatus(tags) : null;
      // infer: 'name' allows only "halal" in the name; true also allows cuisine hints.
      if (inf && opts.infer === 'name' && inf.why !== 'name') inf = null;
      // veg: 'only' = fully meat-free kitchens, true = also places with meat-free dishes.
      let veg = opts.veg ? vegStatus(tags) : null;
      if (veg && opts.veg === 'only' && veg.s !== 'V') veg = null;
      const best = [inf, veg].filter(Boolean).sort((a, b) => STATUS_ORDER[a.s] - STATUS_ORDER[b.s])[0];
      if (!best) return null;
      s = best.s;
      why = best.why;
      dv = best.dv;
    }
  }

  // Prayer places may be unnamed (the UI then shows "Mosque" / "Prayer room").
  const name = firstOf(tags, ['name', 'name:en', 'brand', 'name:ko', 'name:fr', 'operator']);
  if (!name && k !== 'p') return null;

  const typeChar = el.type === 'node' ? 'n' : el.type === 'way' ? 'w' : 'r';
  const ce = certificationOf(tags);
  const checked = firstOf(tags, ['check_date:diet:halal', 'survey:date:diet:halal', 'check_date', 'survey:date']);
  const place = {
    id: `${typeChar}${el.id}`,
    n: name || '',
    nl: localizedNames(tags, name),
    y: roundCoord(lat),
    x: roundCoord(lon),
    k,
    s,
    why,
    dv,
    cu: k === 'p' ? undefined : cuisineTokens(tags),
    a: addressOf(tags, lat, lon),
    ph: firstOf(tags, ['phone', 'contact:phone', 'contact:mobile']),
    w: cleanUrl(firstOf(tags, ['website', 'contact:website', 'url'])),
    mu: k === 'p' ? undefined : ['website:menu', 'contact:menu', 'menu:url', 'menu'].map((key) => cleanUrl(tags[key])).find(Boolean),
    ig: instagramOf(tags),
    oh: firstOf(tags, ['opening_hours']),
    ck: checked && /^\d{4}-\d{2}(-\d{2})?$/.test(checked.slice(0, 10)) ? checked.slice(0, 10) : undefined,
    ce: ce && ce !== 'yes' ? ce.slice(0, 80) : undefined,
    al: k === 'p' ? undefined : alcoholOf(tags),
    nh: tags['diet:non-halal'] === 'yes' ? 1 : undefined,
    pf: tags['diet:pork'] === 'no' ? 1 : undefined,
    v: ['yes', 'only'].includes(tags['diet:vegetarian']) || ['yes', 'only'].includes(tags['diet:vegan']) ? 1 : undefined,
    pr: ['yes', 'customers'].includes(tags.prayer_room) || ['yes', 'customers'].includes(tags.musalla) ? 1 : undefined,
    pt: k === 'p' ? prayerType(tags) : undefined,
    src: 'osm',
  };
  if (place.ph) place.ph = place.ph.split(';')[0].trim();
  return compact(place);
}

/** Better status wins (C > O > Y > F > L > U). */
export function betterStatus(a, b) {
  if (!a) return b;
  if (!b) return a;
  return STATUS_ORDER[a] <= STATUS_ORDER[b] ? a : b;
}

/** Is this a "confirmed" status (tagged by the community or listed officially)? */
export function isConfirmed(s) {
  return Boolean(s) && s !== 'U';
}

/** Halal evidence (as opposed to a meat-free alternative or a hint). */
export function isHalalStatus(s) {
  return ['C', 'O', 'Y', 'F', 'L'].includes(s);
}
