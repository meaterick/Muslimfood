import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { deflateRawSync, crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BRANDS, BRAND_BY_ID, matchBrand, branchName, brandDiet, placeDishes } from '../assets/js/core/brands.js';
import { parseCsvLine, chainRecord, extractChains, dedupeBranches } from '../scripts/import-chains.mjs';
import { listZip } from '../scripts/lib/unzip.mjs';
import { applyBrand, mergeInto, groupByCell, searchRecords, normalizeParts, supplementChains } from '../scripts/lib/build.mjs';
import { chainsQuery } from '../assets/js/core/overpass.js';
import { readFileSync } from 'node:fs';

test('chain registry entries are complete and sourced', () => {
  const ids = new Set();
  for (const b of BRANDS) {
    assert.ok(!ids.has(b.id), `duplicate id ${b.id}`);
    ids.add(b.id);
    assert.ok(b.name.ko && b.name.en && b.match.length && b.countries.length, b.id);
    assert.ok(['r', 'f', 'c'].includes(b.k), `${b.id} category`);
    assert.match(b.url, /^https?:\/\//, `${b.id} needs the official menu page`);
    assert.match(b.checked, /^\d{4}-\d{2}-\d{2}$/, `${b.id} checked date`);
    assert.ok(b.items.length, `${b.id} has no dishes`);
    for (const i of b.items) {
      assert.ok(i.n && i.en, `${b.id} dish names`);
      assert.ok(['v', 'l', 'o', 'lo', 'veg'].includes(i.d), `${b.id} ${i.n} diet ${i.d}`);
    }
  }
});

test('business names map to chains and branch titles read naturally', () => {
  assert.equal(matchBrand('롯데리아강남역점')?.id, 'lotteria');
  assert.equal(matchBrand('파파존스피자남')?.id, 'papajohns');
  assert.equal(matchBrand('SUBWAY 강남')?.id, 'subway');
  assert.equal(matchBrand('롯데마트'), null);
  assert.equal(matchBrand('롯데리아', 'JP'), null, 'rules are per country');
  // operators and locations often come first in the registry
  assert.equal(matchBrand('에스엠디롯데리아귀인점')?.id, 'lotteria');
  assert.equal(matchBrand('시흥하늘휴게소롯데리아')?.id, 'lotteria');
  assert.equal(matchBrand('지우도미노피자진주')?.id, 'dominos');
  assert.equal(matchBrand('본죽&비빔밥cafe 역삼점')?.id, 'bonjuk');
  // look-alike names of other businesses
  assert.equal(matchBrand('카페삼내음샐러디아'), null);
  assert.equal(matchBrand('대한노인회율면분회본죽2리경로당'), null);
  assert.equal(matchBrand('본앤본죽원주'), null);
  assert.equal(matchBrand('스타벅스캡슐무인카페용봉점'), null);
  assert.equal(matchBrand('스타벅스 사가정역')?.id, 'starbucks');
  const L = BRAND_BY_ID.get('lotteria');
  const S = BRAND_BY_ID.get('subway');
  const P = BRAND_BY_ID.get('papajohns');
  assert.equal(branchName(L, '롯데리아강릉', '포남점'), '롯데리아 강릉 포남점');
  assert.equal(branchName(L, '롯데리아화천사내점', ''), '롯데리아 화천사내점');
  assert.equal(branchName(L, '롯데리아', ''), '롯데리아');
  assert.equal(branchName(S, '써브웨이원주써브웨이원주', '혁신도시점'), '써브웨이 원주 혁신도시점');
  assert.equal(branchName(P, '파파존스피자남', '춘천점'), '파파존스 남춘천점');
  assert.equal(branchName(P, '한국파파존스광명', '소하점'), '파파존스 광명 소하점');
  assert.equal(branchName(P, '한국파파존스주', ''), '파파존스');
  assert.equal(branchName(L, '에스엠디롯데리아귀인점', ''), '롯데리아 귀인점');
  assert.equal(branchName(L, '하나로마트롯데리아', '춘천점'), '롯데리아 춘천점');
  assert.equal(branchName(L, '시흥하늘휴게소롯데리아', ''), '롯데리아 시흥하늘휴게소');
  assert.equal(branchName(L, '대민롯데리아공도드라이브점주', ''), '롯데리아 공도드라이브점');
  assert.equal(branchName(S, '경기써브스써브웨이의정부역점', ''), '써브웨이 의정부역점');
  assert.equal(branchName(BRAND_BY_ID.get('bonjuk'), '본죽&비빔밥cafe', '역삼점'), '본죽 역삼점');
  assert.equal(brandDiet(L), 'vegan');
  assert.equal(brandDiet(S), 'vegetarian');
});

test('store registry rows: food businesses of listed chains only', () => {
  assert.deepEqual(parseCsvLine('"a","b, c",3,,"say ""hi"""'), ['a', 'b, c', '3', '', 'say "hi"']);
  const row = {
    상가업소번호: 'MA010120220810389732', 상호명: '롯데리아강릉', 지점명: '포남점', 상권업종대분류코드: 'I2',
    도로명주소: '강원특별자치도 강릉시 하슬라로 1', 경도: '128.9123456', 위도: '37.7712345',
  };
  assert.deepEqual(chainRecord(row), {
    id: 'sbiz-MA010120220810389732', n: '롯데리아 강릉 포남점', b: 'lotteria', y: 37.77123, x: 128.91235, k: 'f', a: '강원특별자치도 강릉시 하슬라로 1',
  });
  assert.equal(chainRecord({ ...row, 상호명: '써브웨이헤어', 상권업종대분류코드: 'G2' }), null, 'a hair salon is not a Subway');
  // trademark names filed under retail by mistake still count, generic ones do not
  const retail = { ...row, 상권업종대분류코드: 'G2', 상권업종대분류명: '소매' };
  assert.equal(chainRecord({ ...retail, 상호명: '롯데리아마들역', 지점명: '' })?.n, '롯데리아 마들역');
  assert.equal(chainRecord({ ...retail, 상호명: '서브웨이', 지점명: '' }), null);
  assert.equal(chainRecord({ ...retail, 상호명: '금해유통본죽&비빔밥이마트', 지점명: '여수점' }), null);
  assert.equal(chainRecord({ ...row, 상호명: '김밥천국' }), null);
  assert.equal(chainRecord({ ...row, 위도: '0', 경도: '0' }), null);
});

test('a shop listed twice in the registry becomes one branch', () => {
  const a = { id: 'sbiz-A1', n: '써브웨이', b: 'subway', y: 37.5, x: 127.0, a: '서울특별시 구로구 경인로 661' };
  const b = { id: 'sbiz-A2', n: '써브웨이 신도림', b: 'subway', y: 37.5001, x: 127.0001, a: '서울특별시 구로구  경인로 661' };
  const c = { id: 'sbiz-A3', n: '써브웨이 신도림', b: 'subway', y: 37.5002, x: 127.0, a: '서울특별시 구로구 경인로 662' };
  const other = { id: 'sbiz-B1', n: '롯데리아 신도림', b: 'lotteria', y: 37.5, x: 127.0, a: '서울특별시 구로구 경인로 661' };
  const far = { id: 'sbiz-A4', n: '써브웨이 신도림', b: 'subway', y: 37.51, x: 127.0, a: '서울특별시 구로구 경인로 700' };
  assert.deepEqual(dedupeBranches([a, b, c, other, far]).map((p) => p.id), ['sbiz-A3', 'sbiz-A4', 'sbiz-B1']);
});

/** A tiny ZIP writer for the test (deflated entries, central directory). */
function zipFile(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('branches are read from every CSV in the registry archive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mf-chains-'));
  try {
    const head = '"상가업소번호","상호명","지점명","상권업종대분류코드","도로명주소","경도","위도"\r\n';
    const zip = zipFile([
      ['[필독]파일열람방법.txt', 'UTF-8로 된 CSV 파일입니다.'],
      ['상가_강원_202609.csv', `﻿${head}"A1","롯데리아강릉","포남점","I2","강원특별자치도 강릉시 하슬라로 1",128.91,37.77\r\n"A2","카페595","","I2","강원 철원",127.41,38.16\r\n`],
      ['상가_서울_202609.csv', `${head}"B1","써브웨이","역삼점","I2","서울특별시 강남구 테헤란로 1, 1층",127.03,37.5\r\n"B2","파파존스피자남","춘천점","I2","",127.73,37.86\r\n"B3","써브웨이헤어","","G2","",127.1,37.6\r\n`],
    ]);
    const file = path.join(dir, 'stores.zip');
    await writeFile(file, zip);
    assert.deepEqual((await listZip(file)).map((e) => e.name), ['[필독]파일열람방법.txt', '상가_강원_202609.csv', '상가_서울_202609.csv']);
    const places = await extractChains(file);
    assert.deepEqual(places.map((p) => [p.id, p.n, p.b]), [
      ['sbiz-A1', '롯데리아 강릉 포남점', 'lotteria'],
      ['sbiz-B1', '써브웨이 역삼점', 'subway'],
      ['sbiz-B2', '파파존스 남춘천점', 'papajohns'],
    ]);
    assert.equal(places[1].a, '서울특별시 강남구 테헤란로 1, 1층');
    assert.equal(places[2].a, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the build gives every branch its chain dishes and keeps neighbouring branches apart', () => {
  const p = applyBrand({ id: 'sbiz-A1', n: '롯데리아 강릉 포남점', b: 'lotteria', y: 37.77, x: 128.91, k: 'f' });
  assert.equal(p.s, 'M');
  assert.equal(p.dv, 'vegan');
  assert.equal(p.mn, undefined, 'dishes are not copied into every branch');
  assert.deepEqual(placeDishes(p, 'ko'), { names: ['미라클버거'], diets: ['v'] });
  assert.deepEqual(placeDishes(p, 'fr').names, ['Miracle Burger']);
  assert.deepEqual(placeDishes({ mn: ['김밥'], mv: ['v'] }, 'en'), { names: ['김밥'], diets: ['v'] }, "a place's own dishes win");
  assert.equal(p.nl.en, 'Lotteria');
  assert.equal(applyBrand({ id: 'x', b: 'gone', y: 37, x: 127 }), null, 'chains removed from the registry are dropped');
  const byCell = groupByCell([]);
  assert.equal(mergeInto(byCell, p, 'sbiz'), true);
  const twin = applyBrand({ id: 'sbiz-A2', n: '롯데리아 강릉', b: 'lotteria', y: 37.7701, x: 128.9101, k: 'f' });
  assert.equal(mergeInto(byCell, twin, 'sbiz'), true, 'two branches 15 m apart stay two places');
  assert.equal(searchRecords([...byCell.values()].flat())[0].b, 'lotteria');
});

test('a chain shop from two sources is one place and keeps the chain menu', () => {
  // OpenStreetMap knows the shop as "Lotteria" with vegetarian options
  const { byId } = normalizeParts({
    korea: { elements: [{ type: 'node', id: 7, lat: 37.4979, lon: 127.0276, tags: { amenity: 'fast_food', name: 'Lotteria', 'diet:vegetarian': 'yes' } }] },
  });
  const osm = byId.get('n7');
  assert.equal(osm.b, 'lotteria');
  assert.deepEqual(placeDishes(osm, 'ko').names, ['미라클버거']);
  const byCell = groupByCell([osm]);
  // the registry has the same shop 30 m away under its Korean branch name
  const reg = applyBrand({ id: 'sbiz-X1', n: '롯데리아 강남역점', b: 'lotteria', y: 37.4981, x: 127.0278, k: 'f' });
  assert.equal(mergeInto(byCell, reg, 'sbiz'), false, 'merged into the OpenStreetMap shop');
  // a Seoul-listed Subway without chain information picks it up when merged
  const seoul = { id: 'seoul-1', n: '써브웨이 역삼점', y: 37.5, x: 127.036, k: 'r', s: 'M', dv: 'vegetarian', src: 'seoul' };
  const byCell2 = groupByCell([seoul]);
  const branch = applyBrand({ id: 'sbiz-S1', n: '써브웨이 역삼점', b: 'subway', y: 37.5001, x: 127.036, k: 'f' });
  assert.equal(mergeInto(byCell2, branch, 'sbiz'), false);
  assert.equal(seoul.b, 'subway');
  assert.ok(placeDishes(seoul, 'ko').names.includes('베지'));
});

test('every chain has a short note in every language', () => {
  const en = JSON.parse(readFileSync(new URL('../assets/i18n/en.json', import.meta.url), 'utf8'));
  for (const b of BRANDS) assert.ok(en.brandNote?.[b.id], `brandNote.${b.id} missing in en.json`);
});

test('OpenStreetMap chain shops fill gaps in the store registry', () => {
  const q = chainsQuery(BRANDS);
  assert.match(q, /"brand:wikidata"~"\^\(Q249525\|/);
  assert.match(q, /\["name"~"롯데리아\|[^"]*본죽[^"]*",i\]/);
  const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags: { amenity: 'fast_food', ...tags } });
  const { chainShops } = normalizeParts({
    chains: {
      elements: [
        node(1, 37.55427, 126.97089, { name: '롯데리아', 'brand:wikidata': 'Q249525' }), // inside Seoul Station
        node(2, 37.5545, 126.9721, { name: '롯데리아' }), // 130 m from node 1
        node(3, 37.5701, 126.9800, { name: '도미노피자', branch: '종로점' }), // registry has it 450 m away
        node(4, 37.5800, 126.9900, { name: '샐러디아' }), // another brand
        node(5, 37.5900, 127.0000, { name: '롯데리아', amenity: 'bank' }), // not a place to eat
      ],
    },
  });
  assert.deepEqual(chainShops.map((p) => p.id), ['n1', 'n2', 'n3']);
  assert.deepEqual([chainShops[0].b, chainShops[0].s, chainShops[0].src], ['lotteria', 'M', 'osm']);
  assert.equal(chainShops[2].n, '도미노피자 종로점');
  const registry = [
    applyBrand({ id: 'sbiz-1', n: '롯데리아 후암점', b: 'lotteria', y: 37.5488, x: 126.9741, k: 'f', src: 'sbiz' }), // 700 m away
    applyBrand({ id: 'sbiz-2', n: '도미노피자 종로점', b: 'dominos', y: 37.5711, x: 126.9849, k: 'f', src: 'sbiz' }),
  ];
  const byCell = groupByCell(registry);
  assert.equal(supplementChains(byCell, chainShops), 1, 'only the Seoul Station shop is new');
  const all = [...byCell.values()].flat();
  assert.ok(all.some((p) => p.id === 'n1'));
  assert.ok(!all.some((p) => p.id === 'n2'), 'a second OSM node 130 m away is the same shop');
  assert.ok(!all.some((p) => p.id === 'n3'), 'same branch name as a registry shop');
});
