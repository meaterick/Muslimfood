#!/usr/bin/env node
// Restaurants with meat-free dishes on their actual menus, from public menu
// lists, placed with the national store registry (which has coordinates):
//
//   행정안전부_착한가격업소 현황 (data.go.kr 3045247): about 10,000 eateries with
//     up to four menu items each, matched to the registry by street address
//     and name -> data/sources/kr-goodprice-menus.json
//   서울특별시 영등포구_다국어메뉴정보 (15076743) + _식당운영정보 (15099326):
//     full menus of Yeongdeungpo restaurants (2022), matched by name inside
//     영등포구; only restaurants still in the registry are kept
//     -> data/sources/kr-ydp-menus.json
//
// A restaurant with a dish from scripts/lib/menu-dishes.mjs becomes "has
// vegetarian dishes" (M) or, with fish dishes only, a seafood restaurant (S),
// and shows those dishes as printed on its menu.
//
//   node scripts/import-menus.mjs --zip .cache/stores.zip [--cached]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listZip, openEntry } from './lib/unzip.mjs';
import { parseCsvLine } from './import-chains.mjs';
import { meatFreeDishes } from './lib/menu-dishes.mjs';
import { MEAT_NAME } from './lib/registry-food.mjs';
import { matchBrand } from '../assets/js/core/brands.js';
import { namesMatch, coreName } from '../assets/js/core/text.js';
import { isInKorea, roundCoord, distance } from '../assets/js/core/geo.js';
import { parseCsv } from './lib/csv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'menus');
const OUT = path.join(ROOT, 'data', 'sources');
const UA = 'MuslimfoodDataImport/1.0 (+https://github.com/meaterick/Muslimfood)';
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DATASETS = {
  goodprice: '3045247',
  ydpMenus: '15076743',
  ydpInfo: '15099326',
};

async function fetchRetry(url, init = {}, tries = 5) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      err = e;
      if (i < tries - 1) await sleep(3000 * 2 ** i);
    }
  }
  throw err;
}

/** Download a data.go.kr file dataset (cached in .cache/menus); returns { bytes, meta }. */
async function dataset(pk) {
  const file = path.join(CACHE, `${pk}.bin`);
  if (args.includes('--cached') && existsSync(file)) {
    return { bytes: await readFile(file), meta: JSON.parse(await readFile(`${file}.json`, 'utf8')) };
  }
  const page = await (await fetchRetry(`https://www.data.go.kr/data/${pk}/fileData.do`)).text();
  const uddi = new RegExp(`fn_fileDataDown\\('${pk}',\\s*'(uddi:[0-9a-f-]+)'`).exec(page)?.[1];
  if (!uddi) throw new Error(`no download link for ${pk}`);
  let ld = {};
  try {
    ld = JSON.parse(/(\{"@context":"https:\/\/schema\.org"[\s\S]*?\})\s*<\/script>/.exec(page)[1]);
  } catch {
    /* optional */
  }
  const body = new URLSearchParams({ publicDataDetailPk: uddi, publicDataPk: pk, atchFileId: '', fileDetailSn: '1', publicDataTyCode: 'PR0051' });
  const ticket = await (
    await fetchRetry('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do', {
      method: 'POST',
      body,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  ).json();
  if (!ticket.status) throw new Error(`download refused for ${pk}`);
  const url = `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${ticket.atchFileId}&fileDetailSn=${ticket.fileDetailSn}&dataNm=${encodeURIComponent(ld.name || pk)}`;
  const bytes = Buffer.from(await (await fetchRetry(url)).arrayBuffer());
  const meta = {
    title: ld.name || pk,
    edition: /_(\d{8})$/.exec(ld.alternateName || '')?.[1] || null,
    modified: ld.dateModified || null,
    license: ld.license?.name || '이용허락범위 제한 없음',
    url: `https://www.data.go.kr/data/${pk}/fileData.do`,
  };
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, bytes);
  await writeFile(`${file}.json`, JSON.stringify(meta, null, 1));
  return { bytes, meta };
}

function decode(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

/** CSV rows (objects) of a dataset file, or of the first matching file in a zip. */
async function csvObjects(bytes, member = null) {
  let data = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const tmp = path.join(CACHE, 'tmp.zip');
    await writeFile(tmp, bytes);
    const entry = (await listZip(tmp)).find((e) => (member ? member.test(e.name) : /\.csv$/i.test(e.name)));
    const chunks = [];
    for await (const c of await openEntry(tmp, entry)) chunks.push(c);
    data = Buffer.concat(chunks);
  }
  const rows = parseCsv(decode(data));
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** "서울특별시 노원구 동일로 1353 (상계동) 1층" -> "노원구|동일로1353" (city name dropped: provinces get renamed). */
export function addressKey(address) {
  let a = String(address || '').normalize('NFKC').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  // Drop the province (서울특별시, 경기도, 전북특별자치도, ...); 세종 has no district below it.
  const sido = /^(\S+?(?:특별시|광역시|특별자치시|특별자치도|통합특별시|도))\s+/.exec(a);
  if (sido) a = a.slice(sido[0].length);
  const m = /^(?:(\S+(?:구|군|시))\s+)?(?:\S+(?:구|시)\s+)?(?:\S+(?:읍|면)\s+)?(\S+(?:로|길))\s*(\d+(?:-\d+)?)/.exec(a);
  if (!m) return null;
  return `${m[1] || sido?.[1] || ''}|${m[2]}${m[3]}`;
}

// Meat restaurants (pork, beef, offal, chicken) stay off the list even when
// their menu has a fish or vegetable dish: the kitchen is about meat.
const MEAT_CATEGORY = /^I2010[3789]$|^I20110$|^I21006$/;
export const meatPlace = (name, code) => MEAT_CATEGORY.test(code || '') || MEAT_NAME.test(name || '');

const KIND = (code) => (/^I2120|^I2100[128]$/.test(code) ? 'c' : /^I2100[34567]$/.test(code) ? 'f' : 'r');
const CUISINE = { I201: 'korean', I202: 'chinese', I203: 'japanese', I204: 'western', I205: 'vietnamese' };

function placeOf(row) {
  const y = Number(row['위도']);
  const x = Number(row['경도']);
  if (!isInKorea(y, x)) return null;
  const code = row['상권업종소분류코드'];
  return {
    sbiz: row['상가업소번호'],
    n: [row['상호명'], row['지점명']].filter(Boolean).join(' ').trim(),
    y: roundCoord(y),
    x: roundCoord(x),
    k: KIND(code),
    a: row['도로명주소'] || row['지번주소'] || undefined,
    cu: CUISINE[code.slice(0, 4)] ? [CUISINE[code.slice(0, 4)]] : undefined,
    gu: row['시군구명'],
    code,
  };
}

/** The registry restaurant among candidates that has the same name, or null. */
export function pickByName(name, candidates) {
  const same = candidates.filter((c) => namesMatch(c.n, name));
  if (!same.length) return null;
  const exact = same.filter((c) => coreName(c.n) === coreName(name));
  const pool = exact.length ? exact : same;
  // Several shops of one name far apart: we cannot tell which one it is.
  return pool.every((c) => distance(c.y, c.x, pool[0].y, pool[0].x) < 100) ? pool[0] : null;
}

/** One record for a restaurant whose menu has meat-free dishes, or null. */
export function menuRecord(id, place, items, source) {
  const { veg, sea } = meatFreeDishes(items);
  if (!veg.length && !sea.length) return null;
  const dishes = [...veg, ...sea].slice(0, 6);
  const p = {
    id,
    n: place.n,
    y: place.y,
    x: place.x,
    k: place.k,
    a: place.a,
    s: veg.length ? 'M' : 'S',
    mn: dishes,
    mv: dishes.map((d) => (veg.includes(d) ? 'veg' : '')),
    src: source,
  };
  if (veg.length) p.dv = 'vegetarian';
  if (place.cu) p.cu = place.cu;
  return p;
}

async function main() {
  const zip = opt('--zip', path.join(ROOT, '.cache', 'stores.zip'));
  const gp = await dataset(DATASETS.goodprice);
  const ydpMenus = await dataset(DATASETS.ydpMenus);
  const ydpInfo = await dataset(DATASETS.ydpInfo);

  const goodprice = (await csvObjects(gp.bytes)).filter((r) => /식|요식|베이커리/.test(r['업종'] || '') && !/비요식/.test(r['업종']));
  const byAddress = new Map();
  for (const r of goodprice) {
    const key = addressKey(r['주소']);
    if (key) byAddress.set(key, [...(byAddress.get(key) || []), r]);
  }
  console.log(`착한가격업소: ${goodprice.length} eateries, ${byAddress.size} addresses`);

  const menus = await csvObjects(ydpMenus.bytes, /KOREAN\.csv$/i);
  const info = new Map((await csvObjects(ydpInfo.bytes)).map((r) => [r['식당(ID)'], r]));
  const ydp = new Map();
  for (const m of menus) {
    const id = m['식당(ID)'];
    if (!ydp.has(id)) ydp.set(id, { name: [m['식당명'], m['지점명']].filter(Boolean).join(' '), items: [], closed: info.get(id)?.['식당상태'] && info.get(id)['식당상태'] !== 'NORMAL' });
    ydp.get(id).items.push(m['메뉴명']);
  }
  console.log(`영등포구: ${ydp.size} restaurants, ${menus.length} menu items`);

  // One pass over the registry: food businesses at a 착한가격업소 address, and in 영등포구.
  const atAddress = new Map();
  const inYdp = [];
  for (const entry of await listZip(zip)) {
    if (!/\.csv$/i.test(entry.name)) continue;
    const dec = new TextDecoder('utf-8');
    let rest = '';
    let header = null;
    const take = (line) => {
      if (!header) {
        header = parseCsvLine(line.replace(/^﻿/, '')).map((h) => h.trim());
        return;
      }
      if (!line.includes(',I2,') && !line.includes('"I2"')) return;
      const c = parseCsvLine(line);
      const row = Object.fromEntries(header.map((h, i) => [h, (c[i] || '').trim()]));
      if (row['상권업종대분류코드'] !== 'I2' || /^I211/.test(row['상권업종소분류코드'])) return;
      const key = addressKey(row['도로명주소']);
      const isYdp = row['시군구명'] === '영등포구' && /서울/.test(row['시도명']);
      if (!isYdp && !(key && byAddress.has(key))) return;
      const p = placeOf(row);
      if (!p) return;
      if (key && byAddress.has(key)) atAddress.set(key, [...(atAddress.get(key) || []), p]);
      if (isYdp) inYdp.push(p);
    };
    for await (const chunk of await openEntry(zip, entry)) {
      const lines = (rest + dec.decode(chunk, { stream: true })).split('\n');
      rest = lines.pop();
      for (const line of lines) take(line.replace(/\r$/, ''));
    }
    if (rest) take(rest);
  }

  const out = { goodprice: [], ydp: [] };
  let matched = 0;
  for (const [key, shops] of byAddress) {
    for (const r of shops) {
      const place = pickByName(r['업소명'], atAddress.get(key) || []);
      if (!place || matchBrand(place.n)) continue;
      matched++;
      if (meatPlace(place.n, place.code)) continue;
      const items = [1, 2, 3, 4].map((i) => r[`메뉴${i}`]).filter(Boolean);
      const rec = menuRecord(`gp-${place.sbiz}`, place, items, 'goodprice');
      // Two list entries can be one restaurant (an old and a new registration).
      if (rec && !out.goodprice.some((o) => o.id === rec.id)) out.goodprice.push(rec);
    }
  }
  console.log(`착한가격업소: ${matched} placed on the map, ${out.goodprice.length} with meat-free dishes`);

  let ydpMatched = 0;
  for (const [id, r] of ydp) {
    if (r.closed) continue;
    const place = pickByName(r.name, inYdp);
    if (!place || matchBrand(place.n)) continue;
    ydpMatched++;
    if (meatPlace(place.n, place.code)) continue;
    const rec = menuRecord(`ydp-${id}`, place, r.items, 'ydp');
    if (rec && !out.ydp.some((o) => o.n === rec.n && o.y === rec.y && o.x === rec.x)) out.ydp.push(rec);
  }
  console.log(`영등포구: ${ydpMatched} still open and placed, ${out.ydp.length} with meat-free dishes`);

  const fmt = (e) => (e ? `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6)}` : null);
  const write = async (file, meta, source, places, selection, publisher) => {
    const edition = fmt(meta.edition);
    await writeFile(
      path.join(OUT, file),
      JSON.stringify(
        {
          source,
          title: meta.title,
          publisher,
          url: meta.url,
          license: meta.license,
          modified: meta.modified,
          edition,
          fetched: new Date().toISOString().slice(0, 10),
          status: 'M',
          selection,
          places: places.sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => (edition ? { ...p, d: edition } : p)),
        },
        null,
        1,
      ) + '\n',
    );
    console.log(`wrote ${places.length} places to data/sources/${file}`);
  };
  await write(
    'kr-goodprice-menus.json',
    gp.meta,
    'goodprice',
    out.goodprice,
    'Eateries whose listed menu items include a meat-free dish (scripts/lib/menu-dishes.mjs), placed with the store registry by street address and name.',
    '행정안전부 (Ministry of the Interior and Safety)',
  );
  await write(
    'kr-ydp-menus.json',
    { ...ydpMenus.meta, title: `${ydpMenus.meta.title} + ${ydpInfo.meta.title}` },
    'ydp',
    out.ydp,
    'Yeongdeungpo restaurants still in the 2026 store registry whose menu includes a meat-free dish (scripts/lib/menu-dishes.mjs), matched by name.',
    '서울특별시 영등포구 (Yeongdeungpo-gu, Seoul)',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
