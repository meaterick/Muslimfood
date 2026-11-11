// Which menu items are meat-free, read from public menu lists (착한가격업소,
// 영등포구 다국어 메뉴). Only dishes that come without meat as a rule are
// listed; dishes that often hide meat or meat broth (된장찌개, 칼국수, 냉면,
// 김밥, 라면, 비빔밥 with beef) are left out on purpose.
//
//   'veg'  no meat and no fish (콩국수, 비빔국수, 팥죽, 감자전, 도토리묵, ...)
//   'sea'  fish or seafood, no meat (바지락칼국수, 회덮밥, 고등어구이, 우동, ...)

// Words that put meat into any dish ("소고기비빔밥", "햄야채김밥", "차돌된장").
const MEAT = /김밥|콥샐러드|라조기|오돌뼈|깐풍기|유린기|탄두리|턴두리|탄도리|케밥|케밥|커틀릿|치즈돈|함박|떡갈비|미트볼|페퍼로니|살라미|프로슈토|하몽|초리조|고기|소고기|쇠고기|돼지|돈육|제육|불고기|갈비|차돌|양지|사태|우삼겹|삼겹|목살|항정|닭|치킨|오리|햄|베이컨|소시지|소세지|스팸|육회|육전|육수|사골|곰탕|설렁탕|도가니|우거지|선지|순대|내장|곱창|막창|대창|족발|보쌈|편육|미트|비프|포크|돈까스|돈가스|카츠|규동|차슈|라멘|라면|떡갈비|동그랑땡|만두|짜장|자장|짬뽕|탕수|부대/;

// Meat-free dishes, longest names first where one contains another.
const VEG = [
  '콩국수',
  '비빔국수',
  '열무국수',
  '열무비빔국수',
  '쫄면',
  '팥칼국수',
  '팥죽',
  '단팥죽',
  '호박죽',
  '단호박죽',
  '잣죽',
  '야채죽',
  '채소죽',
  '녹두죽',
  '흑임자죽',
  '감자전',
  '부추전',
  '야채전',
  '호박전',
  '두부부침',
  '두부조림',
  '두부구이',
  '도토리묵',
  '묵무침',
  '산채비빔밥',
  '콩나물비빔밥',
  '야채비빔밥',
  '채식비빔밥',
  '보리밥',
  '감자옹심이',
  '팥빙수',
  '호떡',
  '마르게리타',
  '마르게리따',
  '고르곤졸라',
  '치즈피자',
  '알리오올리오',
  '알리오 올리오',
  '토마토파스타',
  '아라비아따',
  '아라비아타',
  '버섯리조또',
  '채소커리',
  '야채커리',
  '야채카레',
  '달커리',
  '팔라펠',
  '후무스',
  '샐러드',
];

const SEA = [
  '바지락칼국수',
  '해물칼국수',
  '조개칼국수',
  '바지락수제비',
  '잔치국수',
  '멸치국수',
  '회덮밥',
  '물회',
  '회국수',
  '알밥',
  '알탕',
  '생선구이',
  '고등어구이',
  '고등어조림',
  '갈치구이',
  '갈치조림',
  '삼치구이',
  '꽁치',
  '조기',
  '굴비',
  '가자미',
  '임연수',
  '코다리',
  '동태찌개',
  '동태탕',
  '대구탕',
  '대구지리',
  '복지리',
  '복국',
  '매운탕',
  '아구찜',
  '아귀찜',
  '해물찜',
  '해물탕',
  '해물파전',
  '오징어볶음',
  '오징어덮밥',
  '낙지볶음',
  '낙지덮밥',
  '쭈꾸미',
  '주꾸미',
  '장어구이',
  '장어덮밥',
  '추어탕',
  '황태해장국',
  '황태구이',
  '굴국밥',
  '굴전',
  '전복죽',
  '해물순두부',
  '해물파스타',
  '봉골레',
  '우동',
  '튀김우동',
  '메밀소바',
  '초밥',
  '모둠회',
  '연어덮밥',
  '새우튀김',
  '떡볶이',
];

const norm = (s) =>
  String(s || '')
    .normalize('NFKC')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/\s+/g, '')
    .trim();

// Fish or seafood inside an otherwise meat-free dish ("연어샐러드", "새우볶음밥").
const FISH = /연어|참치|새우|오징어|문어|낙지|쭈꾸미|주꾸미|조개|바지락|홍합|꼬막|전복|굴(?!비)|꽃게|대게|해물|해산물|생선|멸치|장어|고등어|갈치|명태|동태|황태|코다리|대구|아구|아귀|날치|명란|어묵|맛살|회덮|초밥|스시/;

const VEG_KEYS = VEG.map(norm);
const SEA_KEYS = SEA.map(norm);

/** 'veg', 'sea' or null for one menu item. */
export function dishKind(item) {
  const n = norm(item);
  // The raw text too: "콥샐러드(치킨)" names its meat in brackets.
  const raw = String(item || '').normalize('NFKC').replace(/\s+/g, '');
  if (!n || n.length > 30 || MEAT.test(n) || MEAT.test(raw) || /비프|치킨|beef|chicken|pork|bacon|ham\b/i.test(raw)) return null;
  if (VEG_KEYS.some((k) => n.includes(k))) return FISH.test(n) ? 'sea' : 'veg';
  if (SEA_KEYS.some((k) => n.includes(k))) return 'sea';
  return null;
}

/** A menu item as it should be shown: without prices, sizes or option notes. */
export function cleanItem(item) {
  return String(item || '')
    .normalize('NFKC')
    .replace(/\((?:소|중|대|특|1인|2인|\d+\s*(?:g|인분|개|ml))\)|\d+\s*(?:g|인분)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Meat-free dishes of a menu: { veg: [...], sea: [...] } with the item names
 * as printed (cleaned), each listed once.
 */
export function meatFreeDishes(items) {
  const out = { veg: [], sea: [] };
  const seen = new Set();
  for (const raw of items || []) {
    const kind = dishKind(raw);
    if (!kind) continue;
    const name = cleanItem(raw);
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out[kind].push(name);
  }
  return out;
}
