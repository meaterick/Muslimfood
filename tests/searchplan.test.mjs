import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationKey, findLocations, splitQuery, planSearch } from '../assets/js/core/searchplan.js';
import { matchesQuery } from '../assets/js/core/text.js';

const areas = [
  { id: 'itaewon', y: 37.5338, x: 126.996, z: 15.5, n: { ko: '이태원', en: 'Itaewon' } },
  { id: 'gangnam', y: 37.4979, x: 127.0276, z: 15, n: { ko: '강남역', en: 'Gangnam' } },
];
const stations = [
  ['강남', 'Gangnam', 37.4979, 127.0276],
  ['시청', 'City Hall', 37.5657, 126.9769], // Seoul
  ['시청', 'City Hall', 35.1798, 129.0765], // Busan
  ['홍대입구', 'Hongik Univ.', 37.5571, 126.9245],
  ['서울', 'Seoul', 37.5547, 126.9707],
];
const places = [
  { id: 'a', n: '살람 케밥', y: 37.534, x: 126.994, k: 'r', s: 'C', a: '서울 용산구 이태원로 1' },
  { id: 'b', n: '이스탄불 케밥', y: 37.499, x: 127.028, k: 'r', s: 'U', a: '서울 강남구 테헤란로 152' },
  { id: 'c', n: '스타벅스 강남역점', b: 'starbucks', y: 37.498, x: 127.027, k: 'c', s: 'M' },
  { id: 'd', n: '마칸', nl: { en: 'Makan Halal' }, y: 37.56, x: 126.98, k: 'r', s: 'O' },
  { id: 'e', n: '서울중앙성원', y: 37.5333, x: 126.9975, k: 'p' },
];
const plan = (q, center = { lat: 37.55, lon: 126.98 }) => planSearch(q, { areas, stations, places, center });

test('location keys ignore spacing and the station suffix', () => {
  assert.equal(locationKey('강남역'), '강남');
  assert.equal(locationKey('Seoul Station'), 'seoul');
  assert.equal(locationKey('Hongik Univ.'), 'hongikuniv');
  assert.equal(locationKey('역삼'), '역삼');
});

test('areas and stations are found by name, the nearest of the same name first', () => {
  assert.equal(findLocations('gangnam', areas, stations).exact.length, 1, 'the station under the area preset is not repeated');
  assert.equal(findLocations('gangnam', areas, stations).exact[0].kind, 'area');
  const busan = findLocations('시청역', areas, stations, { center: { lat: 35.18, lon: 129.07 } }).exact;
  assert.equal(busan.length, 2);
  assert.equal(busan[0].y, 35.1798);
  assert.equal(findLocations('hong', areas, stations).partial[0].ko, '홍대입구');
});

test('a submitted search goes to an area or station by name', () => {
  assert.equal(plan('이태원').loc.area.id, 'itaewon');
  assert.equal(plan('강남').loc.area.id, 'gangnam');
  assert.equal(plan('Seoul Station').loc.ko, '서울');
  assert.equal(plan('hongik').loc.ko, '홍대입구', 'the only station that contains the text');
});

test('a restaurant name opens that restaurant', () => {
  assert.deepEqual([plan('마칸').kind, plan('마칸').place.id], ['place', 'd']);
  assert.equal(plan('makan halal').place.id, 'd');
  assert.equal(plan('서울중앙성원').place.id, 'e');
});

test('a keyword shows every match; an address match does not open a restaurant', () => {
  const kebab = plan('케밥');
  assert.equal(kebab.kind, 'keyword');
  assert.deepEqual(kebab.matches.map((p) => p.id), ['a', 'b']);
  assert.equal(kebab.loc, null);
  assert.equal(plan('테헤란로 152').kind, 'keyword');
  assert.equal(plan('할랄').matches.length, 2, 'halal statuses match the word in any UI language');
});

test('keyword plus place: "halal gangnam", "강남역 케밥"', () => {
  const p = plan('강남역 케밥');
  assert.equal(p.kind, 'keyword');
  assert.equal(p.text, '케밥');
  assert.equal(p.loc.area.id, 'gangnam');
  assert.equal(plan('halal itaewon').loc.area.id, 'itaewon');
  assert.deepEqual(splitQuery('city hall kebab', (t) => (t === 'city hall' ? 1 : null)), { keyword: 'kebab', loc: 1 });
});

test('unknown text goes to the geocoder, with a named place as fallback', () => {
  assert.deepEqual(plan('N Seoul Tower'), { kind: 'geocode', fallback: null });
  assert.equal(plan('Seoul Tower').kind, 'geocode');
  assert.equal(plan('Seoul Tower').fallback.ko, '서울');
  assert.equal(plan('   ').kind, 'none');
});

test('places can be passed as an iterator', () => {
  const p = planSearch('강남역 케밥', { areas, stations, places: places.values() });
  assert.equal(p.matches.length, 2);
});

test('search text is cached per place and still matches accents and dishes', () => {
  const p = { n: 'Café Zaytoun', mn: ['Mandi à l’agneau'], s: 'Y' };
  assert.ok(matchesQuery(p, 'cafe'));
  assert.ok(matchesQuery(p, 'mandi a l’agneau'));
  assert.ok(matchesQuery(p, 'حلال'));
  assert.ok(!matchesQuery(p, 'vegan'));
});
