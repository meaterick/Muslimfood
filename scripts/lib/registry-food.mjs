// Kinds of food Muslims can eat, found in Korea's national store registry
// (소상공인시장진흥공단 상가(상권)정보) by business category and by name:
//
//   cuisine  food of Muslim-majority countries, or "halal" in the name
//            (status U: likely halal, ask the staff)
//   veg      vegetarian, vegan or temple-food restaurants by name (status V)
//   sea      seafood restaurants: raw fish, sushi, grilled fish and shellfish,
//            pufferfish, clam noodles (status S: no slaughter involved, not certified)
//   dish     restaurants whose usual dishes include ones without meat: pasta,
//            pizza, salad and poke, Indian and Nepali curry, Mexican, porridge,
//            bibimbap, tofu, tteokbokki, soybean noodles, seafood pancakes
//            (status D: likely, not checked; ask for it without meat)
//
// Names are matched with care: "켄터키" contains "터키", "산채식당" contains
// "채식", "중동" is also a neighbourhood and "두바이" a common bar name.

import { roundCoord, isInKorea } from '../../assets/js/core/geo.js';

// Registry categories (상권업종소분류코드).
const SEAFOOD = { I20111: 'seafood', I20112: 'seafood', I20113: 'seafood', I20301: 'sushi' };
// Bars and pork or offal restaurants never count, whatever their name says.
const NEVER = /^I211|^I20103$|^I20107$|^I20109$/;
const CAFE = /^I2120|^I2100[128]$/; // café, bakery, rice cake, ice cream
const FAST = /^I2100[34567]$/; // pizza, burger, sandwich, chicken, snack bar

// Words that make a "seafood" or "vegan" name a meat restaurant after all.
export const MEAT_NAME = /라멘|돈코츠|짜장|자장|짬뽕|고기|삼겹|갈비|족발|보쌈|곱창|막창|돼지|한우|소고기|돈까스|돈가스|돈카츠|카츠|규동|돈부리|치킨|통닭|닭갈비|닭발|닭강정|닭꼬치|오리|육회|정육|순대|햄버거|스테이크|양꼬치|야키토리|꼬치|불고기|베이컨|소시지|부대|감자탕|국밥|곰탕|설렁탕|샤브|훠궈|마라/;
// Organisations and shops filed under food by mistake.
const NOT_FOOD = /선교|협회|협의회|상공회의소|조합|커뮤니티|교회|연구원|연구소|학원|무역|어린이집|유치원|학교|병원|의원|식품$|마트$|유통/;

const CUISINES = [
  ['halal', /할랄|halal|حلال/i],
  ['turkish', /케밥|케바브|kebab|kebap|되네르|도네르|이스탄불|앙카라|카파도키아|튀르키예|(?<![켄스])터키(?!타)|라흐마준/i],
  ['uzbek', /우즈벡|우즈베키스탄|사마르칸트|타슈켄트|타쉬켄트|부하라|중앙아시아/],
  ['central_asian', /키르기스|카자흐|타지크|투르크멘|타직/],
  ['uyghur', /위구르/],
  ['pakistani', /파키스탄|비리야니|브리야니|biryani/i],
  ['bangladeshi', /방글라데시|방갈리|벵골/],
  ['afghan', /아프간|아프가니스탄/],
  ['indonesian', /인도네시아|와룽|와롱|나시고렝|미고렝/],
  ['malaysian', /말레이시아|나시르막/],
  ['arab', /아랍|아라비안|사우디|예멘|(?<!오)시리아|이라크|요르단|팔레스타인|만디하우스|쿠브즈/],
  ['lebanese', /레바논|레바니즈/],
  ['egyptian', /이집트/],
  ['moroccan', /모로코|모로칸|쿠스쿠스(?!커피)/],
  ['persian', /페르시안|페르시아/],
  ['middle_eastern', /팔라펠|후무스|샤와르마|샤워마|중동음식|중동요리|중동식당/],
];
const VEG = /비건|vegan|vegetarian|베지테리언|채식(?![당탁품])|사찰음식|사찰요리/i;
const VEGAN = /비건|vegan/i;

// Seafood by name in other categories.
const CLAM_NOODLES = /바지락|해물칼국수|조개칼국수|잔치국수|멸치국수/;

// Dishes that usually come without meat, by name (or by category for pizza).
const DISHES = [
  ['pasta', /파스타|스파게티|pasta|spaghetti|알리오/i],
  ['salad', /샐러드|salad|포케|poke/i],
  // "인도" hides inside other words (명인도넛, 와인도깨비, 인도쿄), and "베이커리"
  // or "케익커리" (cakery) are not curry: India only with a word for food.
  ['indian', /인도(요리|음식|레스토랑|커리|식당|네팔|$)|인디안|인디아|네팔|탄두리|마살라|(?<![이익])커리(?!어)|india|nepal/i],
  // "타코" alone is usually takoyaki (타코비, 타코몬).
  ['mexican', /멕시칸|멕시코|부리또|브리또|부리토|퀘사디아|타코스|mexican|tacos|burrito/i],
  ['porridge', /죽$|죽집|죽전문|죽이야기|전복죽|호박죽|팥죽/],
  ['kongguksu', /콩국수/],
  ['bibimbap', /비빔밥/],
  ['tofu', /두부/],
  ['tteokbokki', /떡볶이|떡뽁이|떡볶기/],
  ['pajeon', /파전/],
  // Japanese noodles in fish stock (not ramen, which is pork broth).
  ['udon', /우동|소바|모밀/],
  ['sanchae', /산채/],
  ['boribap', /보리밥/],
  ['muk', /도토리묵|묵집|묵밥/],
  ['ongsimi', /옹심이|감자전/],
  ['thai', /(?<!황)태국|팟타이|쏨땀|타이음식|타이요리/],
];
const PIZZA = /^I21003$/;

function kindOf(code) {
  if (CAFE.test(code)) return 'c';
  if (FAST.test(code)) return 'f';
  return 'r';
}

/**
 * Which kind of Muslim-friendly food a registry row stands for, or null.
 * Returns { type: 'cuisine' | 'veg' | 'sea' | 'dish', cu: [...] }.
 */
export function classifyRow(name, code) {
  const n = String(name || '').normalize('NFKC');
  if (!n || NEVER.test(code) || NOT_FOOD.test(n)) return null;
  const cuisines = CUISINES.filter(([, re]) => re.test(n)).map(([cu]) => cu);
  // "Halal" in the name counts in any category; cuisine words not in cafés,
  // where "이스탄불" or "모로코" are often only a theme.
  if (cuisines.includes('halal') || (cuisines.length && !CAFE.test(code))) {
    return { type: 'cuisine', cu: cuisines.filter((c) => c !== 'halal') };
  }
  if (VEG.test(n) && !MEAT_NAME.test(n)) return { type: 'veg', cu: [VEGAN.test(n) ? 'vegan' : 'vegetarian'] };
  if (MEAT_NAME.test(n)) return null;
  if (SEAFOOD[code]) return { type: 'sea', cu: [SEAFOOD[code]] };
  if (CLAM_NOODLES.test(n)) return { type: 'sea', cu: ['seafood', 'noodle'] };
  const dish = DISHES.find(([, re]) => re.test(n));
  if (dish) return { type: 'dish', cu: [dish[0]] };
  if (PIZZA.test(code)) return { type: 'dish', cu: ['pizza'] };
  return null;
}

/** A source record for a registry row (an object keyed by the CSV header), or null. */
export function registryRecord(row) {
  if (row['상권업종대분류코드'] !== 'I2') return null;
  const c = classifyRow(row['상호명'], row['상권업종소분류코드']);
  if (!c) return null;
  const y = Number(row['위도']);
  const x = Number(row['경도']);
  if (!isInKorea(y, x)) return null;
  const name = [row['상호명'], row['지점명']].filter(Boolean).join(' ').trim();
  const p = {
    id: `sbiz-${row['상가업소번호']}`,
    n: name,
    y: roundCoord(y),
    x: roundCoord(x),
    k: kindOf(row['상권업종소분류코드']),
    a: row['도로명주소'] || row['지번주소'] || undefined,
    cu: c.cu,
  };
  if (c.type === 'cuisine') Object.assign(p, { s: 'U', why: 'name' });
  else if (c.type === 'veg') Object.assign(p, { s: 'V', why: 'name', dv: c.cu[0] === 'vegan' ? 'vegan' : 'vegetarian' });
  else if (c.type === 'dish') Object.assign(p, { s: 'D', why: 'dish' });
  else p.s = 'S';
  return { type: c.type, place: p };
}

/** Quick test before parsing a CSV line: could it be one of these at all? */
export const MAYBE = new RegExp(
  [Object.keys(SEAFOOD).join('|'), 'I21003', ...CUISINES.map(([, re]) => re.source), VEG.source, CLAM_NOODLES.source, ...DISHES.map(([, re]) => re.source)].join('|'),
  'i',
);

/** Source-file metadata for each kind (written next to kr-chains.json). */
export const OUTPUTS = {
  cuisine: {
    file: 'kr-registry-cuisine.json',
    selection:
      'Food businesses whose name says halal or names a Muslim-majority cuisine (Turkish kebab, Uzbek, Pakistani, Indonesian, Arab, ...), except bars and pork restaurants. Listed as not confirmed (U).',
  },
  veg: {
    file: 'kr-registry-veg.json',
    selection: 'Food businesses whose name says vegan, vegetarian or temple food (사찰음식), except meat restaurants. Listed as vegetarian by name (V).',
  },
  dish: {
    file: 'kr-dishes.json',
    selection:
      'Restaurants whose usual dishes include ones without meat, by name (pasta, salad and poke, Indian and Nepali curry, Mexican, porridge, soybean noodles, bibimbap, tofu, tteokbokki, seafood pancakes) or category (pizza), except chains and names that point to meat. Listed as likely meat-free dishes (D), not checked. Too large for the repository: written at deploy time only.',
  },
  sea: {
    file: 'kr-seafood.json',
    selection:
      'Seafood restaurants by registry category: 횟집 (raw fish), 해산물 구이/찜 (grilled and steamed seafood), 복 요리 (pufferfish) and 일식 회/초밥 (sashimi and sushi), and clam noodle restaurants by name (바지락·해물칼국수), except names that point to meat. Listed as seafood (S). Too large for the repository: written at deploy time only.',
  },
};
