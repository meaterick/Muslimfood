import { test } from 'node:test';
import assert from 'node:assert/strict';

test('discovery uses halal category hints conservatively and keeps safe menu URLs', () => {
  const place = (tags) => fromOsmElement({ type: 'node', id: 42, lat: 48.85, lon: 2.35, tags: {
    amenity: 'restaurant', name: 'Chez Amine', ...tags,
  } }, { infer: 'name' });
  assert.equal(place({ cuisine: 'french;halal' }).s, 'U');
  assert.equal(place({ cuisine: 'french;halal', 'diet:halal': 'No' }), null);
  assert.equal(place({ cuisine: 'halal', name: 'Chez Amine, pas halal' }), null);
  assert.equal(place({ 'halal:certification': 'yes' }).s, 'C');
  assert.equal(place({ 'name:fr': 'Chez Amine halal', 'website:menu': 'javascript:alert(1)', 'contact:menu': 'https://example.com/menu' }).mu, 'https://example.com/menu');
});
import {
  fromOsmElement,
  taggedStatus,
  categoryOf,
  cuisineTokens,
  inferStatus,
  betterStatus,
  placeCuisineGroup,
  addressOf,
} from '../assets/js/core/normalize.js';

const node = (id, tags, lat = 37.534, lon = 126.994) => ({ type: 'node', id, lat, lon, tags });

test('tagged status levels', () => {
  assert.equal(taggedStatus({ 'diet:halal': 'only' }), 'O');
  assert.equal(taggedStatus({ 'diet:halal': 'yes' }), 'Y');
  assert.equal(taggedStatus({ 'diet:halal': 'limited' }), 'L');
  assert.equal(taggedStatus({ 'diet:halal': 'no' }), null);
  assert.equal(taggedStatus({ halal: 'yes' }), 'Y');
  assert.equal(taggedStatus({ 'diet:halal': 'yes', 'halal:certification': 'KMF' }), 'C');
  assert.equal(taggedStatus({ 'diet:halal': 'only', 'diet:halal:certification:certifier': 'JAKIM' }), 'C');
  assert.equal(taggedStatus({}), null);
});

test('categories', () => {
  assert.equal(categoryOf({ amenity: 'restaurant' }), 'r');
  assert.equal(categoryOf({ amenity: 'fast_food' }), 'f');
  assert.equal(categoryOf({ shop: 'bakery' }), 'c');
  assert.equal(categoryOf({ shop: 'butcher' }), 'm');
  assert.equal(categoryOf({ amenity: 'place_of_worship', religion: 'muslim' }), 'p');
  assert.equal(categoryOf({ amenity: 'place_of_worship', religion: 'christian' }), null);
  assert.equal(categoryOf({ tourism: 'hotel' }), 'o');
  assert.equal(categoryOf({ shop: 'clothes' }), null);
});

test('fromOsmElement builds a compact record', () => {
  const p = fromOsmElement(
    node(42, {
      amenity: 'restaurant',
      name: '살람',
      'name:en': 'Salam',
      'diet:halal': 'only',
      cuisine: 'turkish;Kebab',
      'addr:city': '서울특별시',
      'addr:district': '용산구',
      'addr:street': '우사단로',
      'addr:housenumber': '10',
      phone: '+82 2-123-4567;+82 10-1234-5678',
      website: 'www.example.com',
      opening_hours: 'Mo-Su 11:00-22:00',
      'check_date:diet:halal': '2025-03-01',
      'contact:instagram': '@salam_seoul',
    }),
  );
  assert.equal(p.id, 'n42');
  assert.equal(p.n, '살람');
  assert.deepEqual(p.nl, { en: 'Salam' });
  assert.equal(p.s, 'O');
  assert.equal(p.k, 'r');
  assert.deepEqual(p.cu, ['turkish', 'kebab']);
  assert.equal(p.a, '서울특별시 용산구 우사단로 10');
  assert.equal(p.ph, '+82 2-123-4567');
  assert.equal(p.w, 'https://www.example.com');
  assert.equal(p.ig, 'https://www.instagram.com/salam_seoul/');
  assert.equal(p.ck, '2025-03-01');
  assert.equal(p.src, 'osm');
  assert.equal(p.al, undefined);
  assert.equal(p.why, undefined);
});

test('ways use their center, elements without coordinates are dropped', () => {
  const w = fromOsmElement({ type: 'way', id: 7, center: { lat: 51.5, lon: -0.1 }, tags: { amenity: 'fast_food', name: 'X', 'diet:halal': 'yes' } });
  assert.equal(w.id, 'w7');
  assert.equal(w.y, 51.5);
  assert.equal(fromOsmElement({ type: 'way', id: 8, tags: { amenity: 'cafe', name: 'Y', 'diet:halal': 'yes' } }), null);
});

test('places without halal tags need inference', () => {
  const kebab = node(1, { amenity: 'restaurant', name: 'Istanbul Kebab', cuisine: 'turkish' });
  assert.equal(fromOsmElement(kebab), null);
  const inferred = fromOsmElement(kebab, { infer: true });
  assert.equal(inferred.s, 'U');
  assert.equal(inferred.why, 'cuisine');
  const named = fromOsmElement(node(2, { amenity: 'restaurant', name: '할랄 가이즈' }), { infer: true });
  assert.equal(named.why, 'name');
  assert.equal(fromOsmElement(node(3, { amenity: 'restaurant', name: 'Non-Halal Noodles' }), { infer: true }), null);
  assert.equal(fromOsmElement(node(4, { amenity: 'restaurant', name: 'Kimbap Heaven', cuisine: 'korean' }), { infer: true }), null);
});

test('explicit "no" is never shown, even if the name says halal', () => {
  assert.equal(fromOsmElement(node(5, { amenity: 'restaurant', name: 'Halal Bros', 'diet:halal': 'no' }), { infer: true }), null);
  assert.equal(fromOsmElement(node(6, { amenity: 'restaurant', name: 'Pork Place', 'diet:non-halal': 'only' }), { infer: true }), null);
});

test('alcohol, non-halal and prayer flags', () => {
  const pub = fromOsmElement(node(9, { amenity: 'pub', name: 'Curry Pub', 'diet:halal': 'yes' }));
  assert.equal(pub.al, 1);
  assert.equal(pub.k, 'o');
  const mixed = fromOsmElement(node(10, { amenity: 'restaurant', name: 'Mix', 'diet:halal': 'yes', 'diet:non-halal': 'yes', alcohol: 'no' }));
  assert.equal(mixed.nh, 1);
  assert.equal(mixed.al, 0);
  const mosque = fromOsmElement(node(11, { amenity: 'place_of_worship', religion: 'muslim', name: 'Seoul Central Mosque', building: 'mosque' }));
  assert.equal(mosque.k, 'p');
  assert.equal(mosque.pt, 'mosque');
  assert.equal(mosque.s, undefined);
  const room = fromOsmElement(node(12, { amenity: 'place_of_worship', religion: 'muslim', name: 'Prayer Room', level: '3' }));
  assert.equal(room.pt, 'musalla');
});

test('cuisine helpers', () => {
  assert.deepEqual(cuisineTokens({ cuisine: 'Indian; Pakistani ;non_halal' }), ['indian', 'pakistani']);
  assert.equal(placeCuisineGroup({ cu: ['kebab'] }), 'turkish');
  assert.equal(placeCuisineGroup({ cu: ['unknown_thing', 'uzbek'] }), 'central_asian');
  assert.equal(inferStatus({ name: 'Samarkand' }).why, 'cuisine');
});

test('betterStatus prefers stronger evidence', () => {
  assert.equal(betterStatus('U', 'F'), 'F');
  assert.equal(betterStatus('Y', 'F'), 'Y');
  assert.equal(betterStatus('C', 'O'), 'C');
  assert.equal(betterStatus(undefined, 'U'), 'U');
});

test('address formats by region', () => {
  assert.equal(addressOf({ 'addr:housenumber': '12', 'addr:street': 'Brick Lane', 'addr:city': 'London' }, 51.52, -0.07), '12 Brick Lane, London');
  assert.equal(addressOf({ 'addr:housenumber': '12', 'addr:street': 'Hauptstraße', 'addr:city': 'Berlin' }, 52.5, 13.4), 'Hauptstraße 12, Berlin');
  assert.equal(addressOf({ 'addr:full': '서울 용산구 이태원로 1' }, 37.5, 127), '서울 용산구 이태원로 1');
  assert.equal(addressOf({}, 0, 0), undefined);
});

test("infer: 'name' accepts halal names but not cuisine hints", () => {
  const turkish = node(20, { amenity: 'restaurant', name: 'Ottoman Grill', cuisine: 'turkish' });
  assert.equal(fromOsmElement(turkish, { infer: 'name' }), null);
  assert.equal(fromOsmElement(turkish, { infer: true }).why, 'cuisine');
  assert.equal(fromOsmElement(node(21, { amenity: 'fast_food', name: 'Halal Bites' }), { infer: 'name' }).why, 'name');
});

test('meat-free statuses from diet:vegan / diet:vegetarian', async () => {
  const { vegStatus, isHalalStatus } = await import('../assets/js/core/normalize.js');
  assert.deepEqual(vegStatus({ 'diet:vegan': 'only' }), { s: 'V', dv: 'vegan' });
  assert.deepEqual(vegStatus({ 'diet:vegetarian': 'only', 'diet:vegan': 'yes' }), { s: 'V', dv: 'vegetarian' });
  assert.deepEqual(vegStatus({ 'diet:vegetarian': 'yes' }), { s: 'M', dv: 'vegetarian' });
  assert.equal(vegStatus({ 'diet:vegan': 'no' }), null);
  const vegan = node(30, { amenity: 'restaurant', name: 'Plant Kitchen', 'diet:vegan': 'only' });
  assert.equal(fromOsmElement(vegan), null, 'not shown unless meat-free places are requested');
  const p = fromOsmElement(vegan, { veg: 'only' });
  assert.equal(p.s, 'V');
  assert.equal(p.dv, 'vegan');
  const options = node(31, { amenity: 'restaurant', name: 'Bistro', 'diet:vegetarian': 'yes' });
  assert.equal(fromOsmElement(options, { veg: 'only' }), null, "'only' skips places with just some dishes");
  assert.equal(fromOsmElement(options, { veg: true }).s, 'M');
  // a halal tag always wins; the vegetarian info stays as a flag
  const halal = fromOsmElement(node(32, { amenity: 'restaurant', name: 'H', 'diet:halal': 'yes', 'diet:vegan': 'only' }), { veg: true });
  assert.equal(halal.s, 'Y');
  assert.equal(halal.v, 1);
  // an explicit "not halal" is respected
  assert.equal(fromOsmElement(node(33, { amenity: 'restaurant', name: 'X', 'diet:halal': 'no', 'diet:vegan': 'only' }), { veg: true }), null);
  // a fully meat-free kitchen ranks above a cuisine hint, a hint above "some vegetarian dishes"
  assert.equal(fromOsmElement(node(34, { amenity: 'restaurant', name: 'Istanbul Veg', cuisine: 'turkish', 'diet:vegetarian': 'only' }), { infer: true, veg: true }).s, 'V');
  assert.equal(fromOsmElement(node(35, { amenity: 'restaurant', name: 'Istanbul Grill', cuisine: 'turkish', 'diet:vegetarian': 'yes' }), { infer: true, veg: true }).s, 'U');
  assert.ok(isHalalStatus('C') && isHalalStatus('L') && !isHalalStatus('V') && !isHalalStatus('U'));
});
