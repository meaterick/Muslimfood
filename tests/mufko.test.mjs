import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchRestaurants, importRestaurants, mufkoPlace, main } from '../scripts/import-mufko.mjs';
import { groupByCell, mergeInto, searchRecords } from '../scripts/lib/build.mjs';
import { matchesQuery } from '../assets/js/core/text.js';
import { detailHtml, statusDesc } from '../assets/js/ui/render.js';
import { setLang } from '../assets/js/ui/i18n.js';

const row = (id = 15, code = 'self_certified') => ({
  id, kind: 'restaurant', name: 'Halal India Restaurant', address: 'Gimpo, Korea',
  location: { lat: 37.689768, lng: 126.6005059 }, operatingStatus: 'unknown',
  halalCategory: { code, isCertified: code === 'muslim_certified' },
  cuisines: [{ code: 'indian' }, { code: 'others' }],
});
const date = '2026-11-10';
const response = (items, nextCursor = null) => Response.json({ items, nextCursor });

test('MUFKO follows opaque cursors to the last page in each language', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push([url.searchParams.get('cursor'), options.headers['Accept-Language']]);
    assert.equal(url.searchParams.get('kind'), 'restaurant');
    const korean = options.headers['Accept-Language'] === 'ko';
    const item = { ...row(url.searchParams.has('cursor') ? 16 : 15), ...(korean ? { name: '할랄 인디아', address: '경기도 김포시' } : {}) };
    return response([item], url.searchParams.has('cursor') ? null : 'opaque+/=cursor');
  };
  const result = await importRestaurants({ fetchFn, date });
  assert.deepEqual(calls, [[null, 'en'], ['opaque+/=cursor', 'en'], [null, 'ko'], ['opaque+/=cursor', 'ko']]);
  assert.equal(result.records, 2);
  assert.equal(result.places.length, 2);
  assert.deepEqual(result.places[0], {
    id: 'mufko-15', n: '할랄 인디아', nl: { en: 'Halal India Restaurant' },
    y: 37.68977, x: 126.60051, k: 'r', s: 'Y', cu: ['indian'], a: '경기도 김포시', mf: 15, mc: 'self_certified', d: date,
  });
});

test('MUFKO grades do not turn seafood, Salam or vegetarian options into halal certificates', () => {
  for (const [code, status] of Object.entries({ muslim_certified: 'C', self_certified: 'Y', halal_meat: 'L', veggie: 'M', seafood: 'U', salam: 'U', future_category: 'U' })) {
    const p = mufkoPlace(row(15, code), null, date);
    assert.equal(p.s, status, code);
    assert.equal(p.mc, code);
    assert.equal(p.ck, undefined, 'a download is not a halal verification');
    assert.equal(p.al, undefined, 'do not infer alcohol-free from a grade');
    if (status === 'U') assert.equal(p.why, 'directory');
    if (status === 'M') assert.equal(p.dv, 'vegetarian');
  }
  assert.equal(mufkoPlace({ ...row(15, 'muslim_certified'), halalCategory: { code: 'muslim_certified', isCertified: false } }, null, date).s, 'U');
});

test('MUFKO excludes closed places, other kinds and invalid locations', () => {
  for (const extra of [
    { kind: 'prayer_spot' }, { id: 0 }, { name: '' }, { location: { lat: 0, lng: 0 } },
    { location: { lat: '37.5', lng: 127 } }, { location: null },
    { operatingStatus: 'closed' }, { operatingStatus: 'permanently_closed' }, { operatingStatus: 'temporarily_closed' },
  ]) assert.equal(mufkoPlace({ ...row(), ...extra }, null, date), null);
});

test('MUFKO rejects incomplete, empty or looping pagination and failed later pages', async () => {
  for (const fetchFn of [
    async () => Response.json({ items: [row()] }),
    async () => response([]),
    async () => response([row()], 'same-cursor'),
    async (url) => url.searchParams.has('cursor') ? new Response('', { status: 503 }) : response([row()], 'next'),
    async () => response([row()], 123),
  ]) await assert.rejects(fetchRestaurants('en', { fetchFn }));
});

test('MUFKO rejects a truncated directory or mismatched translated pages', async () => {
  await assert.rejects(importRestaurants({
    previous: { places: Array(10).fill({}) },
    fetchFn: async () => response([row()]),
  }), /suspicious directory size/);
  await assert.rejects(importRestaurants({
    fetchFn: async (_, options) => response([row(options.headers['Accept-Language'] === 'ko' ? 16 : 15)]),
  }), /language listings disagree/);
});

test('a failed MUFKO refresh and push rebuild keep the latest good snapshot', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mufko-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'source.json');
  const cache = path.join(dir, 'cached.json');
  const old = { source: 'mufko', fetched: '2026-11-09', records: 1, places: [mufkoPlace(row(), null, '2026-11-09')] };
  const good = { ...old, fetched: date, places: [mufkoPlace(row(), null, date)] };
  await writeFile(out, JSON.stringify(old));
  await writeFile(cache, JSON.stringify(good));
  let requests = 0;
  const fetchFn = async () => { requests++; throw new Error('upstream unavailable'); };
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  await main(['--cache', cache], { out, fetchFn });
  assert.equal(requests, 1);
  assert.deepEqual(JSON.parse(await readFile(out)), good);
  assert.deepEqual(JSON.parse(await readFile(cache)), good);
  await main(['--cache', cache, '--reuse'], { out, fetchFn });
  assert.equal(requests, 1, 'push deploys need no MUFKO network access');
  // A newer committed snapshot also wins over an older Actions cache.
  await writeFile(cache, JSON.stringify(old));
  await main(['--cache', cache, '--reuse'], { out, fetchFn });
  assert.deepEqual(JSON.parse(await readFile(out)), good);
});

test('MUFKO merges into existing places with both names, source links and stable aliases', () => {
  const existing = { id: 'kto-india', n: 'Halal India Restaurant', y: 37.68977, x: 126.60051, k: 'r', s: 'C', src: 'kto', su: 'https://english.visitkorea.or.kr/example' };
  const cells = groupByCell([existing]);
  const p = mufkoPlace(row(), { name: '할랄 인디아' }, date);
  assert.equal(mergeInto(cells, p, 'mufko'), false);
  assert.equal(existing.s, 'C', 'do not downgrade stronger evidence');
  assert.equal(existing.n, '할랄 인디아');
  assert.equal(existing.nl.en, 'Halal India Restaurant');
  assert.equal(existing.su, 'https://english.visitkorea.or.kr/example');
  assert.equal(existing.mf, 15);
  assert.equal(existing.mc, 'self_certified');
  assert.ok(existing.ids.includes('mufko-15'));
  assert.deepEqual(existing.srcs, ['kto', 'mufko']);
  const [search] = searchRecords([existing]);
  assert.ok(matchesQuery(search, '할랄 인디아'));
  assert.ok(matchesQuery(search, 'Halal India Restaurant'));
  assert.equal(mergeInto(cells, { ...p, id: 'mufko-16', n: '할랄 인디아 2호점', nl: undefined, mf: 16 }, 'mufko'), true, 'a nearby separate branch remains visible');
});

test('distinct MUFKO neighbours and conflicting grades keep their own records', () => {
  for (const [first, second] of [
    ['URGUT', 'URGUT2'], ['Shohona Kebab', 'The Kebab'], ['푸른델리', '프라나 테이블'],
  ]) {
    const a = { ...mufkoPlace(row(1), null, date), n: first, src: 'mufko' };
    const b = { ...mufkoPlace(row(2), null, date), n: second };
    assert.equal(mergeInto(groupByCell([a]), b, 'mufko'), true, second);
    assert.equal(mergeInto(groupByCell([{ ...a, id: 'n1', src: 'osm', mf: undefined, mc: undefined }]), b, 'mufko'), true, `${second} vs OSM`);
  }
  const a = { ...mufkoPlace(row(), null, date), src: 'mufko' };
  const cells = groupByCell([a]);
  assert.equal(mergeInto(cells, mufkoPlace(row(16, 'salam'), null, date), 'mufko'), true);
  assert.equal(mergeInto(cells, mufkoPlace(row(17), null, date), 'mufko'), false, 'an exact duplicate with the same grade is still merged');
});

test('details retain the MUFKO page and original grade after a merge', async (t) => {
  const prevDocument = globalThis.document;
  globalThis.document = { documentElement: {} };
  t.after(() => { globalThis.document = prevDocument; });
  t.mock.method(globalThis, 'fetch', async () => new Response(await readFile(new URL('../assets/i18n/en.json', import.meta.url))));
  await setLang('en');
  const p = { ...mufkoPlace(row(15, 'seafood'), null, date), id: 'n123', src: 'osm', srcs: ['osm', 'mufko'] };
  const html = detailHtml(p, { dist: 10, tz: 'Asia/Seoul' });
  assert.ok(html.includes('href="https://app.mufko.com/places/15"'));
  assert.ok(html.includes('MUFKO (Muslim Friendly Korea) — Seafood'));
  assert.ok(statusDesc(p).includes('without verified halal evidence'));
  assert.ok(!html.includes('source.mufko'));
});
