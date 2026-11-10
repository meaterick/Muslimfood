import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneticKey, soundsAlike, branchMarker } from '../scripts/lib/phonetic.mjs';
import { dedupeOsm, groupByCell, mergeInto } from '../scripts/lib/build.mjs';

test('consonant skeletons ignore vowels, generic words and loanword spelling', () => {
  assert.equal(phoneticKey('호지보보'), phoneticKey('Hojibobo Uzbek Restaurant'));
  assert.equal(phoneticKey('케르반레스토랑'), phoneticKey('Kervan Turkish Restaurant'));
  assert.equal(phoneticKey('쌀람'), phoneticKey('살람'));
  assert.equal(phoneticKey('마루 자연식 김밥'), phoneticKey('Maru JaYeonSik Kimbap'));
});

test('a Korean and a Latin name of one shop sound alike; different shops do not', () => {
  for (const [a, b] of [
    ['호지보보', 'Hojibobo Uzbek Restaurant'],
    ['베제투스', 'Vegetus'],
    ['몽크스부처(이태원)', "Monk's Butcher"],
    ['씨티사라', 'Siti Sarah'],
    ['브레라', 'Brera'],
    ['플랜튜드(코엑스점)', 'Plantude'],
    ['쌀람', '살람'],
  ]) assert.ok(soundsAlike(a, b), `${a} / ${b}`);
  for (const [a, b] of [
    ['알아지스', 'AL- HOOR'],
    ['트로이', 'Sultan Kebab'],
    ['앙카라펠레스', '앙카라피크닉'],
    ['라자트', 'Taj Palace'],
    ['플랜튜드 아이파크몰 용산점', '아르켓 카페 아이파크몰 용산점'],
    ['Kebab House', 'Kebab Inn'], // two Latin names are compared as text elsewhere
    ['두바이', 'DUBAI Mall Cafe X'].slice(0, 1).concat('미스터케밥'),
  ]) assert.ok(!soundsAlike(a, b), `${a} / ${b}`);
});

test('branch markers', () => {
  assert.equal(branchMarker('미스터케밥 2호점'), '2호점');
  assert.equal(branchMarker('미스터케밥 본점'), '본점');
  assert.equal(branchMarker('미스터케밥'), '');
});

const osm = (id, n, y, x, extra = {}) => ({ id, n, y, x, k: 'r', s: 'U', src: 'osm', ...extra });

test('a shop mapped twice in OpenStreetMap becomes one place', () => {
  const { places, merged } = dedupeOsm([
    osm('n1', '케르반레스토랑', 37.5345, 126.9941),
    osm('n2', 'Kervan Turkish Restaurant', 37.53455, 126.99414, { s: 'C', nl: { en: 'Kervan Turkish Restaurant, Itaewon' } }),
    osm('n3', '우산팥죽', 37.6, 127.0, { s: 'M' }),
    osm('w3', '우산팥죽', 37.60004, 127.00003, { s: 'M', a: '서울 어딘가 1' }),
  ]);
  assert.equal(merged, 2);
  const kervan = places.find((p) => p.id === 'n2');
  assert.equal(kervan.s, 'C', 'the certified record is kept');
  assert.equal(kervan.n, '케르반레스토랑');
  assert.equal(kervan.nl.en, 'Kervan Turkish Restaurant, Itaewon');
  assert.deepEqual(kervan.ids, ['n1']);
  assert.equal(places.find((p) => p.n === '우산팥죽').a, '서울 어딘가 1');
});

test('neighbours, branches, another kind of shop and chain branches stay separate', () => {
  const list = [
    osm('n1', '앙카라펠레스', 37.5345, 126.9941),
    osm('n2', '미스터케밥', 37.53452, 126.99412),
    osm('n3', '미스터케밥 2호점', 37.53454, 126.99414),
    osm('n4', '케르반 터키 베이커리', 37.53456, 126.99416, { k: 'c' }),
    osm('n5', '케르반레스토랑', 37.53458, 126.99418),
    osm('n6', '스타벅스 이태원점', 37.5346, 126.9942, { b: 'starbucks', k: 'c' }),
    osm('n7', '스타벅스 이태원점', 37.5346, 126.9942, { b: 'starbucks', k: 'c' }),
    osm('n8', '호지보보', 37.4988, 127.0366),
    osm('n9', 'Hojibobo Uzbek Restaurant', 37.4998, 127.0376), // 140 m away
  ];
  assert.equal(dedupeOsm(list).merged, 0);
});

test('a public-data record merges into the OpenStreetMap entry in another script', () => {
  const byCell = groupByCell([osm('w1', 'Hojibobo Uzbek Restaurant', 37.49882, 127.03662)]);
  const added = mergeInto(byCell, { id: 'kcisa-036', n: '호지보보', y: 37.49882, x: 127.03662, k: 'r', s: 'U', a: '서울특별시 강남구 역삼로17길 64' }, 'kcisa');
  assert.equal(added, false);
  const [p] = [...byCell.values()].flat();
  assert.equal(p.n, '호지보보');
  assert.equal(p.nl.en, 'Hojibobo Uzbek Restaurant');
  assert.equal(p.a, '서울특별시 강남구 역삼로17길 64');
  assert.deepEqual(p.srcs, ['osm', 'kcisa']);
  // Another restaurant next door keeps its own entry.
  assert.equal(mergeInto(byCell, { id: 'kcisa-037', n: '라자트', y: 37.49884, x: 127.03664, k: 'r', s: 'U' }, 'kcisa'), true);
});
