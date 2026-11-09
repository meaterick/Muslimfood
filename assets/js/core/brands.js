// Chains whose standard menu has dishes without meat. A rule applies to every
// branch of the chain in the listed countries, so one checked menu entry puts
// hundreds of places on the map (see scripts/import-chains.mjs for Korea).
//
// To add a chain: list only dishes from the chain's own menu page or allergen
// table, with the date you checked it. Menus change, so re-check the dishes
// when `checked` is older than six months; the tests warn about older dates.
//
//   id        stable key, also used for brandNote.<id> in assets/i18n
//   name      display names; `ko` is how branches are named in Korean data
//   match     business-name prefixes in the Korean store registry
//   countries where the rule applies (ISO 3166-1 alpha-2)
//   k         category of the branches (r restaurant, f fast food, c café)
//   cu        cuisine tokens, as in OpenStreetMap
//   items     n (name on the menu), en (English name), d (diet: v vegan,
//             l lacto, o ovo, lo lacto-ovo, veg vegetarian)
//   url       official menu page the items were checked against

export const BRANDS = [
  {
    id: 'lotteria',
    name: { ko: '롯데리아', en: 'Lotteria' },
    match: ['롯데리아', 'LOTTERIA'],
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
    match: ['파파존스피자', '파파존스', 'PAPAJOHNS', "PAPA JOHN'S"],
    countries: ['KR'],
    k: 'f',
    cu: ['pizza'],
    items: [
      { n: '그린잇 식물성 마가리타', en: 'Green Eat Plant-based Margherita', d: 'v' },
      { n: '그린잇 식물성 가든스페셜', en: 'Green Eat Plant-based Garden Special', d: 'v' },
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
    items: [{ n: '베지', en: 'Veggie', d: 'veg' }],
    url: 'https://www.subway.co.kr/sandwichList',
    checked: '2026-11-09',
  },
];

export const BRAND_BY_ID = new Map(BRANDS.map((b) => [b.id, b]));

const norm = (s) => String(s || '').normalize('NFKC').toUpperCase().replace(/[\s'’.·-]+/g, '');

/** The chain a Korean business name belongs to, e.g. "롯데리아강남역점" -> Lotteria. */
export function matchBrand(name, country = 'KR') {
  const n = norm(name);
  if (!n) return null;
  for (const b of BRANDS) {
    if (!b.countries.includes(country)) continue;
    if (b.match.some((m) => n.startsWith(norm(m)))) return b;
  }
  return null;
}

/** Status of a branch: some vegan dishes when every listed dish is vegan, else vegetarian. */
export function brandDiet(brand) {
  return brand.items.every((i) => i.d === 'v') ? 'vegan' : 'vegetarian';
}

/**
 * Branch title from the registry's business name and branch name:
 * ("롯데리아강릉", "포남점") -> "롯데리아 강릉 포남점".
 */
export function branchName(brand, name, branch = '') {
  let rest = String(name || '');
  for (const m of [...brand.match].sort((a, b) => b.length - a.length)) {
    rest = rest.replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\']/g, '\\$&'), 'gi'), ' ');
  }
  rest = rest.replace(/\s+/g, ' ').trim();
  rest = rest.replace(/^(.+?) ?\1$/, '$1'); // "원주원주" -> "원주"
  const br = String(branch || '').replace(/\s+/g, ' ').trim();
  // A one-letter leftover belongs to the branch name: "피자남" + "춘천점" -> "남춘천점".
  const tail = rest.length === 1 && br ? [`${rest}${br}`] : [rest, br];
  return [...new Set([brand.name.ko, ...tail].filter(Boolean))].join(' ');
}
