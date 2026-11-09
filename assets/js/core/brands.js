// Chains whose standard menu has dishes without meat. A rule applies to every
// branch of the chain in the listed countries, so one checked menu entry puts
// hundreds of places on the map (see scripts/import-chains.mjs for Korea).
//
// To add a chain: list only dishes from the chain's own menu page or allergen
// table, with the date you checked it. Menus change, so re-check the dishes
// when `checked` is older than six months; the data build warns about it.
//
//   id          stable key, also used for brandNote.<id> in assets/i18n
//   name        display names; `ko` is how branches are named in Korean data
//   match       chain names as they appear inside business names in the Korean
//               store registry (operators often put their company name first,
//               e.g. "에스엠디롯데리아귀인점"); list longer forms first
//   exclude     other businesses whose name contains the chain name
//   noise       sub-brand words to drop from the start of a branch's location
//   distinctive the name is a trademark nobody else uses: a shop whose name
//               starts with it counts even when the registry files it under
//               retail instead of food (registry mistakes)
//   countries   where the rule applies (ISO 3166-1 alpha-2)
//   k           category of the branches (r restaurant, f fast food, c café)
//   cu          cuisine tokens, as in OpenStreetMap
//   items       n (name on the menu), en (English name), d (diet: v vegan,
//               l lacto, o ovo, lo lacto-ovo, veg vegetarian)
//   url         official menu page the items were checked against

export const BRANDS = [
  {
    id: 'lotteria',
    name: { ko: '롯데리아', en: 'Lotteria' },
    match: ['롯데리아', 'LOTTERIA'],
    distinctive: true,
    countries: ['KR'],
    k: 'f',
    cu: ['burger'],
    items: [{ n: '미라클버거', en: 'Miracle Burger', d: 'v' }],
    url: 'https://www.lotteeatz.com/products/introductions/REP_000349',
    checked: '2026-11-09',
  },
  {
    id: 'papajohns',
    name: { ko: '파파존스', en: "Papa John's" },
    match: ['한국파파존스', '파파존스피자', '파파존스', 'PAPAJOHNS', "PAPA JOHN'S"],
    distinctive: true,
    countries: ['KR'],
    k: 'f',
    cu: ['pizza'],
    items: [
      { n: '그린잇 식물성 마가리타', en: 'Green Eat Plant-based Margherita', d: 'v' },
      { n: '그린잇 식물성 가든스페셜', en: 'Green Eat Plant-based Garden Special', d: 'v' },
      { n: '마가리타', en: 'Margherita', d: 'l' },
      { n: '가든 스페셜', en: 'Garden Special', d: 'l' },
    ],
    url: 'https://www.pji.co.kr/menu/pizza',
    checked: '2026-11-09',
  },
  {
    id: 'subway',
    name: { ko: '써브웨이', en: 'Subway' },
    match: ['써브웨이', '서브웨이', 'SUBWAY'],
    countries: ['KR'],
    k: 'f',
    cu: ['sandwich'],
    items: [
      { n: '베지', en: 'Veggie', d: 'veg' },
      { n: '에그마요', en: 'Egg Mayo', d: 'o' },
    ],
    url: 'https://www.subway.co.kr/sandwichList',
    checked: '2026-11-09',
  },
  {
    id: 'dominos',
    name: { ko: '도미노피자', en: "Domino's Pizza" },
    match: ['도미노피자', "DOMINO'S PIZZA", 'DOMINOS PIZZA'],
    distinctive: true,
    countries: ['KR'],
    k: 'f',
    cu: ['pizza'],
    items: [{ n: '치즈 피자', en: 'Cheese Pizza', d: 'l' }],
    url: 'https://web.dominos.co.kr/goods/list?dsp_ctgr=C0101',
    checked: '2026-11-09',
  },
  {
    id: 'salady',
    name: { ko: '샐러디', en: 'Salady' },
    match: ['샐러디', 'SALADY'],
    exclude: /샐러디아/,
    countries: ['KR'],
    k: 'r',
    cu: ['salad'],
    items: [
      { n: '단호박 노릇두부 샐러디', en: 'Sweet Pumpkin Golden Tofu Salady', d: 'v' },
      { n: '청양간장 두부 비빔밥', en: 'Chungyang Soy Tofu Bibimbap', d: 'v' },
    ],
    url: 'https://www.salady.com/menu/list_1',
    checked: '2026-11-09',
  },
  {
    id: 'bonjuk',
    name: { ko: '본죽', en: 'Bonjuk' },
    // "본죽&비빔밥" and "본죽&비빔밥cafe" shops serve the same porridges.
    match: [
      '본죽&비빔밥cafe',
      '본죽&비빔밥 cafe',
      '본죽&비빔밥카페',
      '본죽&비빔밥 카페',
      '본죽&비빔밥',
      '본죽앤비빔밥카페',
      '본죽앤비빔밥 카페',
      '본죽엔비빔밥카페',
      '본죽앤비빔밥',
      '본죽엔비빔밥',
      '본죽.비빔밥',
      '본죽카페',
      '본죽',
    ],
    // "본앤본" is another porridge brand; "본죽리" is a village name.
    exclude: /본앤본|본죽\s?\d*리|경로당/,
    // Sub-brand words left in front of the location: "본죽 비빔밥CAFE 화랑대역점".
    noise: /^(?:[\s&,.·]|앤드|앤|엔|본?비[빔빕]밥|카페|까페|cafe)+/i,
    distinctive: true,
    countries: ['KR'],
    k: 'r',
    cu: ['korean'],
    items: [
      { n: '단팥죽', en: 'Sweet red bean porridge', d: 'v' },
      { n: '단호박죽', en: 'Sweet pumpkin porridge', d: 'v' },
      { n: '녹두죽', en: 'Mung bean porridge', d: 'v' },
      { n: '명품잣죽', en: 'Pine nut porridge', d: 'v' },
      { n: '흑임자죽', en: 'Black sesame porridge', d: 'v' },
    ],
    url: 'https://www.bonif.co.kr/brand/menu?brdCd=BF101',
    checked: '2026-11-09',
  },
];

export const BRAND_BY_ID = new Map(BRANDS.map((b) => [b.id, b]));

const norm = (s) => String(s || '').normalize('NFKC').toUpperCase().replace(/[\s'’.·&-]+/g, '');

/** Where the chain's name starts in a normalised business name, or -1. */
function brandIndex(brand, n) {
  let at = -1;
  for (const m of brand.match) {
    const i = n.indexOf(norm(m));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  return at;
}

/**
 * The chain a Korean business name belongs to. The name may start with the
 * operator's company or the location: "롯데리아강남역점", "에스엠디롯데리아귀인점"
 * and "시흥하늘휴게소롯데리아" are all Lotteria.
 */
export function matchBrand(name, country = 'KR') {
  const n = norm(name);
  if (!n) return null;
  for (const b of BRANDS) {
    if (!b.countries.includes(country) || b.exclude?.test(name)) continue;
    if (brandIndex(b, n) >= 0) return b;
  }
  return null;
}

/** Does the business name start with the chain's name? */
export function startsWithBrand(brand, name) {
  return brandIndex(brand, norm(name)) === 0;
}

/**
 * Dishes of a place: its own list, or its chain's (chain branches do not
 * repeat the chain's dishes in the data files). Names in the UI language
 * (Korean for 'ko', English otherwise) and their diet labels.
 */
export function placeDishes(p, lang = 'en') {
  if (p.mn?.length) {
    const names = p.ml?.[lang] || (lang !== 'ko' && p.ml?.en) || p.mn;
    return { names, diets: Array.isArray(p.mv) && p.mv.length === names.length ? p.mv : [] };
  }
  const brand = BRAND_BY_ID.get(p.b);
  if (!brand) return { names: [], diets: [] };
  return { names: brand.items.map((i) => (lang === 'ko' ? i.n : i.en)), diets: brand.items.map((i) => i.d) };
}

/** Status of a branch: some vegan dishes when every listed dish is vegan, else vegetarian. */
export function brandDiet(brand) {
  return brand.items.every((i) => i.d === 'v') ? 'vegan' : 'vegetarian';
}

// Company words and separators that say nothing about where a branch is.
function tidy(s) {
  return String(s || '')
    .replace(/\(주\)|㈜|주식회사/g, ' ')
    .replace(/[_\-－–—()（）[\]&·.,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/점주$/, '점') // "공도드라이브점주" -> "공도드라이브점"
    .replace(/^주$/, '');
}

/**
 * Branch title from the registry's business name and branch name:
 * ("롯데리아강릉", "포남점") -> "롯데리아 강릉 포남점",
 * ("에스엠디롯데리아귀인점", "") -> "롯데리아 귀인점",
 * ("시흥하늘휴게소롯데리아", "") -> "롯데리아 시흥하늘휴게소".
 */
export function branchName(brand, name, branch = '') {
  const raw = String(name || '').normalize('NFKC');
  const lower = raw.toLowerCase();
  // Every place the chain's name appears, longer spellings first.
  const spans = [];
  for (const m of [...brand.match].sort((a, b) => b.length - a.length)) {
    const ml = m.toLowerCase();
    for (let i = lower.indexOf(ml); i >= 0; i = lower.indexOf(ml, i + 1)) {
      if (!spans.some(([s, e]) => i < e && i + ml.length > s)) spans.push([i, i + ml.length]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const br = tidy(branch);
  // Text after the (last) chain name is the location; text before it is usually
  // the operator, so it is only used when nothing else names the branch.
  let rest = spans.length ? raw.slice(spans[spans.length - 1][1]) : raw;
  if (brand.noise) rest = rest.replace(brand.noise, '');
  const after = tidy(rest);
  const before = spans.length ? tidy(raw.slice(0, spans[0][0])) : '';
  let tail;
  if (after.length === 1 && br) tail = [`${after}${br}`]; // "피자남" + "춘천점" -> "남춘천점"
  else if (after || br) tail = [after, br];
  else tail = [before];
  return [...new Set([brand.name.ko, ...tail].filter(Boolean))].join(' ');
}
