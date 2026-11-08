import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeParts, groupByCell, mergeSources, mergeInto } from '../scripts/lib/build.mjs';

// Synthetic Overpass elements (test fixtures only).
const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags });
const ITAEWON = [37.5341, 126.9946];
const LONDON = [51.5155, -0.0722];

test('tagged results win over inferred ones, cuisine hints only inside Korea', () => {
  const parts = {
    tagged: { elements: [node(1, ...ITAEWON, { amenity: 'restaurant', name: '살람', cuisine: 'turkish', 'diet:halal': 'only' })], osmBase: '2026-11-07T00:00:00Z' },
    korea: {
      elements: [
        node(1, ...ITAEWON, { amenity: 'restaurant', name: '살람', cuisine: 'turkish', 'diet:halal': 'only' }),
        node(2, 37.535, 126.995, { amenity: 'restaurant', name: '케밥하우스', cuisine: 'kebab' }),
        node(3, 37.5337, 126.9976, { amenity: 'place_of_worship', religion: 'muslim', name: '서울중앙성원', building: 'mosque' }),
      ],
      osmBase: '2026-11-07T01:00:00Z',
    },
    names: {
      elements: [
        node(4, ...LONDON, { amenity: 'fast_food', name: 'Halal Fried Chicken' }),
        // a Turkish place in London without a halal tag or name is not a hint
        node(5, 51.51, -0.07, { amenity: 'restaurant', name: 'Ottoman Grill', cuisine: 'turkish' }),
        // prayer places outside Korea are not prebuilt
        node(6, 51.5, -0.1, { amenity: 'place_of_worship', religion: 'muslim', name: 'East London Mosque' }),
      ],
    },
  };
  const { byId, osmBase } = normalizeParts(parts);
  assert.equal(osmBase, '2026-11-07T01:00:00Z');
  assert.equal(byId.get('n1').s, 'O');
  assert.equal(byId.get('n2').s, 'U');
  assert.equal(byId.get('n2').why, 'cuisine');
  assert.equal(byId.get('n3').k, 'p');
  assert.equal(byId.get('n4').why, 'name');
  assert.ok(!byId.has('n5'));
  assert.ok(!byId.has('n6'));
});

test('official list upgrades a nearby unconfirmed OSM place and fills gaps', () => {
  const { byId } = normalizeParts({
    korea: { elements: [node(10, 37.3306, 126.7918, { amenity: 'restaurant', name: '뉴타지마할', cuisine: 'indian;pakistani' })] },
  });
  const byCell = groupByCell(byId.values());
  const stats = mergeSources(byCell, [
    {
      source: 'kcisa',
      file: 'kcisa.json',
      status: 'U',
      places: [{ id: 'kcisa-1', n: '뉴타지마할 레스토랑', y: 37.33065, x: 126.79176, k: 'r', s: 'U', why: 'cuisine', oh: 'Mo-Su 11:00-22:00' }],
    },
    {
      source: 'gg',
      file: 'gg.json',
      status: 'F',
      places: [
        { id: 'gg-1', n: '뉴타지마할', y: 37.33061, x: 126.79179, k: 'r', s: 'F', a: '경기도 안산시 단원구 다문화1길 49', ph: '031-492-7861', d: '2024-05-31' },
        { id: 'gg-2', n: '바타비아', y: 37.3311, x: 126.7905, k: 'r', s: 'F' },
      ],
    },
  ]);
  // official list is merged first, the unconfirmed hint second
  assert.deepEqual(stats.map((s) => [s.source, s.added]), [['gg', 1], ['kcisa', 0]]);
  const all = [...byCell.values()].flat();
  assert.equal(all.length, 2);
  const merged = all.find((p) => p.id === 'n10');
  assert.equal(merged.s, 'F');
  assert.equal(merged.why, undefined);
  assert.deepEqual(merged.srcs, ['osm', 'gg', 'kcisa']);
  assert.equal(merged.a, '경기도 안산시 단원구 다문화1길 49');
  assert.equal(merged.oh, 'Mo-Su 11:00-22:00');
  assert.equal(all.find((p) => p.id === 'gg-2').src, 'gg');
});

test('different names or far away places are not merged; prayer places merge by distance', () => {
  const byCell = groupByCell([{ id: 'n1', n: '살람', y: 37.5341, x: 126.9946, k: 'r', s: 'Y', src: 'osm' }, { id: 'n2', n: '', y: 37.3335, x: 126.7905, k: 'p', pt: 'mosque', src: 'osm' }]);
  assert.equal(mergeInto(byCell, { id: 'x1', n: '두바이 레스토랑', y: 37.5342, x: 126.9947, k: 'r', s: 'U' }, 'kcisa'), true);
  assert.equal(mergeInto(byCell, { id: 'x2', n: '살람', y: 37.55, x: 126.99, k: 'r', s: 'U' }, 'kcisa'), true);
  assert.equal(mergeInto(byCell, { id: 'p1', n: '', y: 37.3339, x: 126.7907, k: 'p', pt: 'mosque', a: '경기도 안산시 단원구 원곡공원로 16-1' }, 'gg'), false);
  const mosque = [...byCell.values()].flat().find((p) => p.id === 'n2');
  assert.equal(mosque.a, '경기도 안산시 단원구 원곡공원로 16-1');
});
