import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koreanBase, englishBase, stationsFromOsm, stationIndex } from '../assets/js/core/stations.js';
import { stationsQuery } from '../assets/js/core/overpass.js';
import { branchOf } from '../assets/js/core/brands.js';
import { FEEDBACK_URL, ANALYTICS } from '../assets/js/config.js';

test('station names lose their suffix', () => {
  assert.equal(koreanBase('서울역'), '서울');
  assert.equal(koreanBase('역삼'), '역삼');
  assert.equal(koreanBase('강남역 (신분당선)'), '강남');
  assert.equal(englishBase('Seoul Station'), 'Seoul');
  assert.equal(englishBase('Yeoksam'), 'Yeoksam');
  assert.equal(englishBase('Gangnam (Line 2)'), 'Gangnam');
});

test('stations from OpenStreetMap: rail only, one row per station, Korea only', () => {
  const rows = stationsFromOsm([
    { type: 'node', id: 1, lat: 37.5006, lon: 127.0364, tags: { railway: 'station', name: '역삼', 'name:en': 'Yeoksam' } },
    // the same station on another line, 150 m away
    { type: 'node', id: 2, lat: 37.5016, lon: 127.0372, tags: { public_transport: 'station', subway: 'yes', name: '역삼역' } },
    { type: 'node', id: 3, lat: 37.5547, lon: 126.9707, tags: { railway: 'station', name: '서울역', 'name:en': 'Seoul Station' } },
    { type: 'node', id: 4, lat: 37.56, lon: 126.98, tags: { public_transport: 'station', bus: 'yes', name: '버스터미널' } },
    { type: 'way', id: 5, center: { lat: 35.6895, lon: 139.6917 }, tags: { railway: 'station', name: '新宿' } },
  ]);
  assert.deepEqual(rows, [
    ['역삼', 'Yeoksam', 37.5006, 127.0364],
    ['서울', 'Seoul', 37.5547, 126.9707],
  ]);
});

test('nearest station within walking distance', () => {
  const near = stationIndex([
    ['역삼', 'Yeoksam', 37.5006, 127.0364],
    ['강남', 'Gangnam', 37.4979, 127.0276],
  ]);
  assert.equal(near(37.5012, 127.037).ko, '역삼');
  assert.equal(near(37.498, 127.028).en, 'Gangnam');
  assert.equal(near(37.52, 127.06), null);
  assert.equal(stationIndex(null)(37.5, 127), null);
});

test('stations query stays inside Korea and asks for rail stations', () => {
  const q = stationsQuery(60);
  assert.match(q, /\[timeout:60\]/);
  assert.match(q, /railway/);
  assert.match(q, /33\.00000,124\.50000,38\.65000,131\.95000/);
});

test('branch part of a chain title', () => {
  assert.equal(branchOf({ b: 'starbucks', n: '스타벅스 역삼역점' }), '역삼역점');
  assert.equal(branchOf({ b: 'lotteria', n: '롯데리아' }), '');
  assert.equal(branchOf({ n: '살람' }), '');
});

test('settings are empty or point at the expected services', () => {
  assert.ok(FEEDBACK_URL === '' || /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(FEEDBACK_URL), FEEDBACK_URL);
  const gc = ANALYTICS.goatcounter;
  assert.ok(gc === '' || /^[a-z0-9-]+$/i.test(gc) || /^https:\/\/[\w.-]+\/count$/.test(gc), gc);
});
