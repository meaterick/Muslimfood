import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { deflateRawSync, crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BRANDS, BRAND_BY_ID, matchBrand, branchName, brandDiet } from '../assets/js/core/brands.js';
import { parseCsvLine, chainRecord, extractChains, dedupeBranches } from '../scripts/import-chains.mjs';
import { listZip } from '../scripts/lib/unzip.mjs';
import { applyBrand, mergeInto, groupByCell, searchRecords } from '../scripts/lib/build.mjs';

test('chain registry entries are complete and sourced', () => {
  const ids = new Set();
  for (const b of BRANDS) {
    assert.ok(!ids.has(b.id), `duplicate id ${b.id}`);
    ids.add(b.id);
    assert.ok(b.name.ko && b.name.en && b.match.length && b.countries.length, b.id);
    assert.ok(['r', 'f', 'c'].includes(b.k), `${b.id} category`);
    assert.match(b.url, /^https:\/\//, `${b.id} needs the official menu page`);
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
  const L = BRAND_BY_ID.get('lotteria');
  const S = BRAND_BY_ID.get('subway');
  const P = BRAND_BY_ID.get('papajohns');
  assert.equal(branchName(L, '롯데리아강릉', '포남점'), '롯데리아 강릉 포남점');
  assert.equal(branchName(L, '롯데리아화천사내점', ''), '롯데리아 화천사내점');
  assert.equal(branchName(L, '롯데리아', ''), '롯데리아');
  assert.equal(branchName(S, '써브웨이원주써브웨이원주', '혁신도시점'), '써브웨이 원주 혁신도시점');
  assert.equal(branchName(P, '파파존스피자남', '춘천점'), '파파존스 남춘천점');
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
  assert.deepEqual(p.mn, ['미라클버거']);
  assert.deepEqual(p.mv, ['v']);
  assert.deepEqual(p.ml, { en: ['Miracle Burger'] });
  assert.equal(p.nl.en, 'Lotteria');
  assert.equal(applyBrand({ id: 'x', b: 'gone', y: 37, x: 127 }), null, 'chains removed from the registry are dropped');
  const byCell = groupByCell([]);
  assert.equal(mergeInto(byCell, p, 'sbiz'), true);
  const twin = applyBrand({ id: 'sbiz-A2', n: '롯데리아 강릉', b: 'lotteria', y: 37.7701, x: 128.9101, k: 'f' });
  assert.equal(mergeInto(byCell, twin, 'sbiz'), true, 'two branches 15 m apart stay two places');
  assert.equal(searchRecords([...byCell.values()].flat())[0].b, 'lotteria');
});
