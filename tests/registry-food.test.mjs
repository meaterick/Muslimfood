import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRow, registryRecord } from '../scripts/lib/registry-food.mjs';
import { planSearch, isSeafoodWord } from '../assets/js/core/searchplan.js';
import { groupByCell, mergeInto } from '../scripts/lib/build.mjs';
import { matchesQuery } from '../assets/js/core/text.js';

const type = (name, code = 'I20101') => classifyRow(name, code)?.type || null;

test('Muslim-country cuisines and halal by name', () => {
  assert.equal(type('럭키터키케밥', 'I20499'), 'cuisine');
  assert.equal(type('사마르칸트', 'I20501'), 'cuisine');
  assert.equal(type('와룽인도네시아', 'I20599'), 'cuisine');
  assert.equal(type('할랄킹', 'I21006'), 'cuisine', '"halal" counts in any category');
  assert.deepEqual(classifyRow('뉴타쉬켄트', 'I20401').cu, ['uzbek']);
  assert.deepEqual(classifyRow('할랄박스', 'I20101').cu, []);
});

test('look-alike names and wrong categories are not cuisines', () => {
  assert.equal(type('칠칠켄터키', 'I21006'), null, '켄터키 contains 터키');
  assert.equal(type('미스터키친'), null);
  assert.equal(type('해피데이김밥', 'I21007'), null);
  assert.equal(classifyRow('덕수파스타진주혁신', 'I20402').type, 'dish', '파스타진주 contains 타진, but it is a pasta place');
  assert.deepEqual(classifyRow('덕수파스타진주혁신', 'I20402').cu, ['pasta']);
  assert.equal(type('오시리아역', 'I21201'), null);
  assert.equal(type('두바이', 'I21101'), null, 'bars never count');
  assert.equal(type('이스탄불커피', 'I21201'), null, 'a cuisine word in a café name is only a theme');
  assert.equal(type('인도네시아무슬림커뮤니티', 'I20599'), null, 'organisations');
  assert.equal(type('터키케밥삼겹살', 'I20107'), null, 'pork restaurants');
});

test('vegetarian names, but not 산채식당 or 사랑채 식당', () => {
  assert.equal(type('비건테이블바람'), 'veg');
  assert.equal(type('자연속의밥상사찰음식'), 'veg');
  assert.equal(type('채식뷔페집밥'), 'veg');
  assert.equal(type('산채식당'), null);
  assert.equal(type('사랑채식당'), null);
  assert.equal(type('하늘채식품', 'I21007'), null);
  assert.equal(classifyRow('비건마마', 'I21001').cu[0], 'vegan');
});

test('seafood by category, without meat restaurants', () => {
  assert.equal(type('남해횟집', 'I20111'), 'sea');
  assert.equal(type('스시정', 'I20301'), 'sea');
  assert.equal(type('조개구이&삼겹살', 'I20112'), null);
  assert.equal(type('규동집', 'I20301'), null, 'beef bowls filed under sushi');
  assert.equal(type('우리횟집', 'I20101'), null, 'the category decides, not the word');
});

test('registry records', () => {
  const row = { 상권업종대분류코드: 'I2', 상권업종소분류코드: 'I20111', 상호명: '남해횟집', 지점명: '', 상가업소번호: 'MA01', 위도: '37.5', 경도: '127.0', 도로명주소: '서울 어딘가 1' };
  assert.deepEqual(registryRecord(row), { type: 'sea', place: { id: 'sbiz-MA01', n: '남해횟집', y: 37.5, x: 127, k: 'r', a: '서울 어딘가 1', cu: ['seafood'], s: 'S' } });
  assert.equal(registryRecord({ ...row, 위도: '35.7', 경도: '139.7' }), null, 'outside Korea');
  const veg = registryRecord({ ...row, 상권업종소분류코드: 'I21001', 상호명: '비건빵빵이네' });
  assert.equal(veg.place.s, 'V');
  assert.equal(veg.place.why, 'name');
  assert.equal(veg.place.k, 'c');
});

test('seafood searches: "회", "seafood", "명동 초밥"', () => {
  const areas = [{ id: 'myeongdong', y: 37.563, x: 126.985, z: 15, n: { ko: '명동', en: 'Myeongdong' } }];
  assert.ok(isSeafoodWord('Seafood') && isSeafoodWord('회') && !isSeafoodWord('회사'));
  assert.deepEqual(planSearch('seafood', { areas }), { kind: 'seafood', loc: null });
  const p = planSearch('명동 초밥', { areas });
  assert.equal(p.kind, 'seafood');
  assert.equal(p.loc.area.id, 'myeongdong');
  assert.ok(matchesQuery({ n: '남해횟집', s: 'S' }, 'seafood'));
  assert.ok(!matchesQuery({ n: '살람', s: 'C' }, 'seafood'));
});

test('a public record never merges into a chain branch by a shared word', () => {
  const byCell = groupByCell([{ id: 'sbiz-1', n: '롯데리아 부산 연지점', b: 'lotteria', y: 35.17, x: 129.05, k: 'f', s: 'M', src: 'sbiz' }]);
  assert.equal(mergeInto(byCell, { id: 'sbiz-2', n: '연지식당', y: 35.17, x: 129.05, k: 'r', s: 'S' }, 'sbiz'), true);
  // ...but one named after the chain does.
  assert.equal(mergeInto(byCell, { id: 'osm-3', n: '롯데리아 연지', y: 35.17, x: 129.05, k: 'f', s: 'U' }, 'osm'), false);
});

test('a registry restaurant joins the MUFKO entry at the same door, not a neighbour', () => {
  const muf = { id: 'mufko-1', n: 'Star Kebab', y: 35.8571, x: 128.4893, k: 'r', s: 'Y', src: 'mufko', mf: 1, mc: 'H' };
  const next = { id: 'mufko-2', n: '타슈켄트', nl: { en: 'Toshkent' }, y: 35.8571, x: 128.4893, k: 'r', s: 'U', src: 'mufko', mf: 2, mc: 'U' };
  const byCell = groupByCell([muf, next]);
  assert.equal(mergeInto(byCell, { id: 'sbiz-9', n: '스타케밥', y: 35.8571, x: 128.4893, k: 'r', s: 'U', why: 'name' }, 'sbiz'), false);
  assert.deepEqual([...byCell.values()].flat().find((p) => p.id === 'mufko-1').ids, ['sbiz-9']);
  // A generic registry name in the same building stays separate.
  assert.equal(mergeInto(byCell, { id: 'sbiz-10', n: '할랄푸드', y: 35.8571, x: 128.4893, k: 'r', s: 'U', why: 'name' }, 'sbiz'), true);
});

test('restaurants whose usual dishes include meat-free ones', () => {
  const dish = (name, code = 'I20101') => classifyRow(name, code)?.cu?.[0] || null;
  assert.equal(dish('파스타입니다', 'I20402'), 'pasta');
  assert.equal(dish('황철수피자', 'I21003'), 'pizza', 'pizza by category');
  assert.equal(dish('델리인도레스토랑', 'I20599'), 'indian');
  assert.equal(dish('도스타코스', 'I20499'), 'mexican');
  assert.equal(dish('소망단팥죽'), 'porridge');
  assert.equal(dish('콩영자콩국수', 'I20105'), 'kongguksu');
  assert.equal(dish('으뜸해물순두부'), 'tofu');
  assert.equal(dish('냠냠떡볶이', 'I21007'), 'tteokbokki');
  // look-alikes and meat
  for (const [name, code] of [
    ['노크케이커리', 'I21001'], // cakery
    ['명인도넛츠', 'I21001'],
    ['다인도시락', 'I20101'],
    ['타코비 동래점', 'I21007'], // takoyaki
    ['멕시칸치킨', 'I21006'], // fried chicken
    ['고기듬뿍대왕비빔밥', 'I20101'],
    ['순대와녹두빈대떡', 'I20101'],
    ['찬스불고기부리또', 'I20401'],
  ]) assert.equal(classifyRow(name, code)?.type === 'dish' ? name : null, null, name);
  assert.equal(classifyRow('섬나루바지락칼국수', 'I20105').type, 'sea', 'clam noodles are seafood');
  assert.equal(registryRecord({ 상권업종대분류코드: 'I2', 상권업종소분류코드: 'I20402', 상호명: '파스타다', 상가업소번호: 'X', 위도: '37.5', 경도: '127' }).place.s, 'D');
});

test('dish searches: "파스타", "명동 피자"', async () => {
  const { planSearch: plan, dishOf } = await import('../assets/js/core/searchplan.js');
  const areas = [{ id: 'myeongdong', y: 37.563, x: 126.985, z: 15, n: { ko: '명동', en: 'Myeongdong' } }];
  assert.equal(dishOf('Pasta'), 'pasta');
  assert.equal(dishOf('피자스쿨'), null, 'a chain name is not the dish');
  assert.deepEqual(plan('파스타', { areas }), { kind: 'dish', dish: 'pasta', text: '파스타', loc: null });
  const p = plan('명동 피자', { areas });
  assert.equal(p.kind, 'dish');
  assert.equal(p.dish, 'pizza');
  assert.equal(p.loc.area.id, 'myeongdong');
  assert.ok(matchesQuery({ n: '파스타다', s: 'D', cu: ['pasta'] }, 'pasta'));
});
