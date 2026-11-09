import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, cellKey, cellsForBbox, inBbox, isInKorea, formatDistance } from '../assets/js/core/geo.js';
import { mapApps, naverLink, kakaoLink, koreanDistrict, googleRouteLink, osmLink, osmEditLink } from '../assets/js/core/links.js';
import { namesMatch, coreName, matchesQuery, esc } from '../assets/js/core/text.js';
import { taggedQuery, koreaQuery, liveFoodQuery, prayerQuery, bboxString, runOverpass } from '../assets/js/core/overpass.js';

test('distance', () => {
  // Seoul Station -> Itaewon station is roughly 3 km
  const d = distance(37.5547, 126.9707, 37.5345, 126.9946);
  assert.ok(d > 2800 && d < 3300, String(d));
  assert.equal(distance(1, 1, 1, 1), 0);
});

test('cell keys and bbox cover', () => {
  assert.equal(cellKey(37.53, 126.99), '37_126');
  assert.equal(cellKey(-33.9, 151.2), '-34_151');
  assert.equal(cellKey(51.5, -0.12), '51_-1');
  assert.deepEqual(cellsForBbox([126.5, 37.2, 127.5, 37.8]).sort(), ['37_126', '37_127']);
  // antimeridian
  const keys = cellsForBbox([179.5, -17.5, -179.5, -16.5]);
  assert.ok(keys.includes('-18_179') && keys.includes('-18_-180'), keys.join());
  assert.ok(inBbox(0, 179.9, [179, -1, -179, 1]));
});

test('isInKorea', () => {
  assert.ok(isInKorea(37.5665, 126.978)); // Seoul
  assert.ok(isInKorea(35.1796, 129.0756)); // Busan
  assert.ok(isInKorea(33.4996, 126.5312)); // Jeju
  assert.ok(isInKorea(37.4602, 126.4407)); // Incheon Airport
  assert.ok(isInKorea(37.4845, 130.9057)); // Ulleungdo
  assert.ok(!isInKorea(39.0392, 125.7625)); // Pyongyang
  assert.ok(!isInKorea(34.2, 129.3)); // Tsushima
  assert.ok(!isInKorea(35.6762, 139.6503)); // Tokyo
  assert.ok(!isInKorea(31.23, 121.47)); // Shanghai
});

test('formatDistance', () => {
  assert.equal(formatDistance(234, 'en'), '230 m');
  assert.equal(formatDistance(1534, 'en'), '1.5 km');
  assert.equal(formatDistance(25400, 'en'), '25 km');
});

test('map apps order: Korea first offers Naver and Kakao', () => {
  const kr = { id: 'n1', n: '살람', y: 37.534, x: 126.994, a: '서울특별시 용산구 우사단로 10' };
  const apps = mapApps(kr, { apple: false }).map((a) => a.id);
  assert.deepEqual(apps, ['naver', 'kakao', 'google']);
  assert.equal(naverLink(kr), 'https://map.naver.com/p/search/' + encodeURIComponent('살람 용산구'));
  assert.equal(kakaoLink({ ...kr, n: 'A, B' }), `https://map.kakao.com/link/map/${encodeURIComponent('A  B')},37.534,126.994`);
  const uk = { id: 'w5', n: 'Dishoom', y: 51.5, x: -0.12 };
  assert.deepEqual(mapApps(uk, { apple: true }).map((a) => a.id), ['apple', 'google']);
  assert.equal(googleRouteLink(uk), 'https://www.google.com/maps/dir/?api=1&destination=51.5,-0.12');
  assert.equal(osmLink(uk), 'https://www.openstreetmap.org/way/5');
  assert.equal(osmEditLink({ id: 'gg-001', y: 1, x: 2 }), 'https://www.openstreetmap.org/edit#map=19/1/2');
  assert.equal(koreanDistrict('부산광역시 해운대구 구남로 1'), '해운대구');
  assert.equal(koreanDistrict('경기도 안산시 단원구 다문화길 4'), '단원구');
  assert.equal(koreanDistrict('경기도 김포시 통진읍 조강로 40'), '김포시');
});

test('name matching for de-duplication', () => {
  assert.ok(namesMatch('케르반 레스토랑', '케르반'));
  assert.ok(namesMatch('Siti Sarah', 'SITI SARAH Restaurant'));
  assert.ok(!namesMatch('살람', '사마르칸트'));
  assert.equal(coreName('케르반 레스토랑'), '케르반');
  // when only generic words remain, fall back to the full normalised name
  assert.equal(coreName('The Halal Kitchen!'), 'thehalalkitchen');
});

test('search query matching', () => {
  const p = { n: '살람', nl: { en: 'Salam Restaurant' }, a: '서울 용산구', cu: ['turkish'] };
  assert.ok(matchesQuery(p, 'salam'));
  assert.ok(matchesQuery(p, '용산 turkish'));
  assert.ok(!matchesQuery(p, 'pizza'));
  assert.ok(matchesQuery(p, ''));
  // "halal" finds halal places only; diet words find vegetarian places and chain dishes
  assert.ok(matchesQuery({ ...p, s: 'Y' }, 'halal'));
  assert.ok(!matchesQuery({ ...p, s: 'U' }, 'halal'));
  const branch = { n: '롯데리아 강남역점', nl: { en: 'Lotteria' }, s: 'M', mn: ['미라클버거'], ml: { en: ['Miracle Burger'] } };
  assert.ok(!matchesQuery(branch, 'halal'));
  assert.ok(matchesQuery(branch, '비건 버거'));
  assert.ok(matchesQuery(branch, 'vegan burger'));
  assert.ok(matchesQuery(branch, 'Végétarien'));
  assert.ok(matchesQuery(branch, 'plant-based lotteria'));
});

test('html escaping', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('overpass queries are well formed', () => {
  assert.equal(bboxString([126.9, 37.5, 127.1, 37.6]), '37.50000,126.90000,37.60000,127.10000');
  const q = taggedQuery();
  assert.match(q, /\[out:json\]/);
  assert.match(q, /nwr\["diet:halal"~"\^\(yes\|only\|limited\|some\|halal\)\$",i\];/);
  assert.match(q, /nwr\["halal:certification"\];/);
  assert.match(q, /nwr\["cuisine"="halal"\];/);
  assert.match(q, /out center tags qt;/);
  assert.match(liveFoodQuery([0, 0, 1, 1]), /\[~"\^\(name\(:\[\^:\]\+\)\?\|brand\)\$"~"[^"]+",i\]\(0\.00000,0\.00000,1\.00000,1\.00000\);/);
  // bounding box (works on every Overpass server), not an area lookup
  assert.match(koreaQuery(), /\["religion"="muslim"\]\(33\.00000,124\.50000,38\.65000,131\.95000\);/);
  assert.doesNotMatch(koreaQuery(), /area/);
  // balanced parentheses
  for (const query of [q, koreaQuery(), liveFoodQuery([0, 0, 1, 1]), prayerQuery([0, 0, 1, 1])]) {
    const open = (query.match(/\(/g) || []).length;
    const close = (query.match(/\)/g) || []).length;
    assert.equal(open, close, query);
  }
});

test('runOverpass fails over to the next endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://a.example/api') return { ok: false, status: 429 };
    return { ok: true, json: async () => ({ elements: [{ type: 'node', id: 1 }] }) };
  };
  const json = await runOverpass('[out:json];', { endpoints: ['https://a.example/api', 'https://b.example/api'], fetchImpl });
  assert.equal(json.elements.length, 1);
  assert.deepEqual(calls, ['https://a.example/api', 'https://b.example/api']);
  await assert.rejects(
    runOverpass('[out:json];', { endpoints: ['https://a.example/api'], fetchImpl }),
    /HTTP 429/,
  );
});

test('approximate or unnamed places link by address', () => {
  const approx = { id: 'gg-1', n: '하스케밥', y: 37.9, x: 127.05, a: '경기도 동두천시 평화로 2553', ap: 1 };
  assert.equal(
    mapApps(approx, { apple: false })[1].href,
    'https://map.kakao.com/link/search/' + encodeURIComponent('하스케밥 동두천시'),
  );
  const unnamed = { id: 'ggp-1', n: '', k: 'p', y: 37.3, x: 126.8, a: '경기도 안산시 단원구 원곡공원로 16-1' };
  assert.equal(naverLink(unnamed), 'https://map.naver.com/p/search/' + encodeURIComponent(unnamed.a));
  assert.equal(googleRouteLink(approx), 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(approx.a));
});

test('runOverpass respects the overall deadline', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: false, status: 504 };
  };
  await assert.rejects(runOverpass('[out:json];', { endpoints: ['https://a/', 'https://b/'], fetchImpl, deadline: Date.now() + 5000 }), /budget/);
  assert.equal(calls, 0);
});

test('runOverpass waits and retries a busy server before moving on', async () => {
  const calls = [];
  const waits = [];
  let n = 0;
  const fetchImpl = async (url) => {
    calls.push(url);
    n++;
    if (url === 'https://main/' && n <= 2) return { ok: false, status: 429 };
    return { ok: true, json: async () => ({ elements: [{ type: 'node', id: 7 }] }) };
  };
  const json = await runOverpass('[out:json];', {
    endpoints: ['https://main/', 'https://mirror/'],
    fetchImpl,
    retries: 3,
    retryDelayMs: 1000,
    sleep: async (ms) => waits.push(ms),
  });
  assert.equal(json.elements[0].id, 7);
  assert.deepEqual(calls, ['https://main/', 'https://main/', 'https://main/']);
  assert.deepEqual(waits, [1000, 2000]);
});

test('runOverpass does not retry errors that are not "busy"', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return url === 'https://main/' ? { ok: false, status: 400 } : { ok: true, json: async () => ({ elements: [] }) };
  };
  const errors = [];
  await runOverpass('[out:json];', {
    endpoints: ['https://main/', 'https://mirror/'],
    fetchImpl,
    retries: 3,
    sleep: async () => assert.fail('should not wait'),
    onError: (url, err) => errors.push(err.message),
  });
  assert.deepEqual(calls, ['https://main/', 'https://mirror/']);
  assert.deepEqual(errors, ['HTTP 400 from https://main/']);
});

test('runOverpass treats implausible results as a failure and tries the next server', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const elements = url === 'https://mirror/' ? [] : [{ type: 'node', id: 1 }, { type: 'node', id: 2 }];
    return { ok: true, json: async () => ({ elements }) };
  };
  const accept = (json) => (json.elements.length < 2 ? 'too few' : null);
  const json = await runOverpass('[out:json];', { endpoints: ['https://mirror/', 'https://main/'], fetchImpl, accept });
  assert.equal(json.elements.length, 2);
  assert.deepEqual(calls, ['https://mirror/', 'https://main/']);
  // 502 Bad Gateway is retried like 429/503/504
  let n = 0;
  const flaky = async () => (++n === 1 ? { ok: false, status: 502 } : { ok: true, json: async () => ({ elements: [{}, {}] }) });
  const waits = [];
  await runOverpass('[out:json];', { endpoints: ['https://main/'], fetchImpl: flaky, retries: 2, retryDelayMs: 5, sleep: async (ms) => waits.push(ms), accept });
  assert.deepEqual(waits, [5]);
});
