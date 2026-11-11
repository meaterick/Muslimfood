#!/usr/bin/env node
// From Korea's national store registry: 소상공인시장진흥공단_상가(상권)정보
// (data.go.kr 15083033, updated every quarter, 이용허락범위 제한 없음):
//   - branches of the chains in assets/js/core/brands.js -> kr-chains.json
//   - other kinds of food Muslims can eat (scripts/lib/registry-food.mjs):
//     Muslim-majority cuisines, vegetarian and seafood restaurants
//     -> kr-registry-cuisine.json, kr-registry-veg.json, kr-seafood.json, kr-dishes.json
//
//   node scripts/import-chains.mjs              # download (~350 MB) -> data/sources/
//   node scripts/import-chains.mjs --zip FILE   # use an archive that is already downloaded
//   node scripts/import-chains.mjs --out FILE   # write somewhere else
//   node scripts/import-chains.mjs --modified   # print the dataset's last update date and exit
//   node scripts/import-chains.mjs --download-only FILE  # only download the archive (for caching)

import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listZip, openEntry } from './lib/unzip.mjs';
import { BRANDS, matchBrand, branchName, startsWithBrand } from '../assets/js/core/brands.js';
import { isInKorea, roundCoord, distance } from '../assets/js/core/geo.js';
import { normText } from '../assets/js/core/text.js';
import { registryRecord, MAYBE, OUTPUTS } from './lib/registry-food.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PK = '15083033';
const PAGE = `https://www.data.go.kr/data/${PK}/fileData.do`;
const UA = 'MuslimfoodDataImport/1.0 (+https://github.com/meaterick/Muslimfood)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, init = {}, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      err = e;
      if (i < tries - 1) await sleep(2000 * 2 ** i);
    }
  }
  throw err;
}

/** File id and catalogue metadata of the dataset page. */
export async function datasetInfo() {
  const page = await (await fetchRetry(PAGE)).text();
  const uddi = new RegExp(`fn_fileDataDown\\('${PK}',\\s*'(uddi:[0-9a-f-]+)'`).exec(page)?.[1];
  if (!uddi) throw new Error(`no download link on ${PAGE}`);
  let meta = {};
  try {
    meta = JSON.parse(/(\{"@context":"https:\/\/schema\.org"[\s\S]*?\})\s*<\/script>/.exec(page)[1]);
  } catch {
    /* the metadata block is optional */
  }
  return {
    uddi,
    title: meta.name || '소상공인시장진흥공단_상가(상권)정보',
    edition: /_(\d{8})$/.exec(meta.alternateName || '')?.[1] || null,
    modified: meta.dateModified || null,
    license: meta.license?.name || '이용허락범위 제한 없음',
  };
}

async function download(info, file) {
  const body = new URLSearchParams({ publicDataDetailPk: info.uddi, publicDataPk: PK, atchFileId: '', fileDetailSn: '1', publicDataTyCode: 'PR0051' });
  const res = await fetchRetry('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do', {
    method: 'POST',
    body,
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const ticket = await res.json();
  if (!ticket.status) throw new Error('data.go.kr refused the download');
  const url = `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${ticket.atchFileId}&fileDetailSn=${ticket.fileDetailSn}&dataNm=${encodeURIComponent(info.title)}`;
  // The server does not resume downloads, so retry from the start.
  for (let i = 0; ; i++) {
    try {
      const r = await fetchRetry(url);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(`${file}.part`));
      await rename(`${file}.part`, file);
      return;
    } catch (err) {
      await rm(`${file}.part`, { force: true });
      if (i >= 2) throw err;
      console.warn(`download failed (${err.message}), retrying`);
      await sleep(10000);
    }
  }
}

/** Split one CSV line ("quoted, fields", "" escapes). */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') (cur += '"'), i++;
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') out.push(cur), (cur = '');
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Quick test before parsing a line: does it mention a chain at all?
const ANY_CHAIN = new RegExp(
  BRANDS.flatMap((b) => b.match)
    .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|'),
  'i',
);

/** Rows of a UTF-8 CSV stream whose line mentions a chain, as objects keyed by the header. */
export async function* chainRows(stream) {
  const decoder = new TextDecoder('utf-8');
  let header = null;
  let rest = '';
  let pending = '';
  const handle = function* (line) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (pending) (line = `${pending}\n${line}`), (pending = '');
    // An odd number of quotes means a quoted field continues on the next line.
    if ((line.match(/"/g) || []).length % 2) {
      pending = line;
      return;
    }
    if (!header) {
      header = parseCsvLine(line.replace(/^﻿/, '')).map((h) => h.trim());
      return;
    }
    if (!ANY_CHAIN.test(line) && !MAYBE.test(line)) return;
    const cells = parseCsvLine(line);
    yield Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  };
  for await (const chunk of stream) {
    const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');
    rest = lines.pop();
    for (const line of lines) yield* handle(line);
  }
  rest += decoder.decode();
  if (rest) yield* handle(rest);
}

/** A place record for one registry row, or null when it is not a chain restaurant. */
export function chainRecord(row) {
  const name = row['상호명'];
  const brand = matchBrand(name);
  if (!brand) return null;
  // Food businesses only ("써브웨이헤어" is a hair salon). A few chain shops are
  // filed under retail by mistake; trust those only for trademark names.
  const food = row['상권업종대분류코드'] === 'I2';
  const misfiled = row['상권업종대분류명'] === '소매' && brand.distinctive && startsWithBrand(brand, name);
  if (!food && !misfiled) return null;
  const y = Number(row['위도']);
  const x = Number(row['경도']);
  if (!isInKorea(y, x)) return null;
  return {
    id: `sbiz-${row['상가업소번호']}`,
    n: branchName(brand, name, row['지점명']),
    b: brand.id,
    y: roundCoord(y),
    x: roundCoord(x),
    k: brand.k,
    a: row['도로명주소'] || row['지번주소'] || undefined,
  };
}

/**
 * One record per shop. The registry sometimes lists a shop twice (an old and a
 * new registration at the same address, or the same name a few metres apart);
 * keep the more descriptive name, then the newer registration.
 */
export function dedupeBranches(places) {
  const pick = (a, b) => (b.n.length > a.n.length || (b.n.length === a.n.length && b.id > a.id) ? b : a);
  const byAddress = new Map();
  const noAddress = [];
  for (const p of places) {
    if (!p.a) {
      noAddress.push(p);
      continue;
    }
    const key = `${p.b}|${p.a.replace(/\s+/g, '')}`;
    byAddress.set(key, byAddress.has(key) ? pick(byAddress.get(key), p) : p);
  }
  const out = [];
  for (const p of [...byAddress.values(), ...noAddress]) {
    const twin = out.findIndex((o) => o.b === p.b && o.n === p.n && distance(o.y, o.x, p.y, p.x) < 30);
    if (twin >= 0) out[twin] = pick(out[twin], p);
    else out.push(p);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** One record per restaurant: the registry lists some twice under one name and address. */
export function dedupeFood(places) {
  const byKey = new Map();
  for (const p of places) {
    const key = `${normText(p.n)}|${(p.a || `${p.y},${p.x}`).replace(/\s+/g, '')}`;
    const prev = byKey.get(key);
    if (!prev || p.id > prev.id) byKey.set(key, p);
  }
  return [...byKey.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Chain branches and other Muslim-friendly food in every CSV of the registry archive. */
export async function extractRegistry(zipFile) {
  const chains = new Map();
  const food = { cuisine: [], veg: [], sea: [], dish: [] };
  for (const entry of await listZip(zipFile)) {
    if (!/\.csv$/i.test(entry.name)) continue;
    let n = 0;
    let m = 0;
    for await (const row of chainRows(await openEntry(zipFile, entry))) {
      const p = matchBrand(row['상호명']) ? chainRecord(row) : null;
      if (p) {
        chains.set(p.id, p);
        n++;
        continue;
      }
      if (matchBrand(row['상호명'])) continue; // a chain's other shops (cafés named after it, ...)
      const r = registryRecord(row);
      if (r) food[r.type].push(r.place), m++;
    }
    console.log(`${entry.name}: ${n} branches, ${m} other places`);
  }
  return { chains: dedupeBranches([...chains.values()]), food: Object.fromEntries(Object.entries(food).map(([k, v]) => [k, dedupeFood(v)])) };
}

/** Chain branches in every CSV of the registry archive. */
export async function extractChains(zipFile) {
  return (await extractRegistry(zipFile)).chains;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
  const info = await datasetInfo();
  if (args.includes('--modified')) {
    console.log(info.modified || info.edition || 'unknown');
    return;
  }
  if (args.includes('--download-only')) {
    const file = path.resolve(ROOT, opt('--download-only'));
    await mkdir(path.dirname(file), { recursive: true });
    console.log(`downloading ${info.title} (${info.edition || info.modified}) to ${path.relative(ROOT, file)}…`);
    await download(info, file);
    return;
  }
  let zip = opt('--zip', null);
  if (!zip) {
    await mkdir(path.join(ROOT, '.cache'), { recursive: true });
    zip = path.join(ROOT, '.cache', `stores-${info.edition || info.modified || 'latest'}.zip`);
    console.log(`downloading ${info.title} (${info.edition || info.modified})…`);
    await download(info, zip);
  }
  const { chains: places, food } = await extractRegistry(zip);
  const byBrand = Object.fromEntries(BRANDS.map((b) => [b.id, places.filter((p) => p.b === b.id).length]));
  console.log(`branches: ${JSON.stringify(byBrand)}`);
  if (places.length < 100) throw new Error(`only ${places.length} branches found; the file format may have changed`);
  const edition = info.edition ? `${info.edition.slice(0, 4)}-${info.edition.slice(4, 6)}-${info.edition.slice(6)}` : null;
  const out = {
    source: 'sbiz',
    title: info.title,
    publisher: '소상공인시장진흥공단 (Small Enterprise and Market Service)',
    url: PAGE,
    license: info.license,
    licenseNote: '공공데이터 이용허락범위 제한 없음 (no usage restrictions); attribution given in the app.',
    modified: info.modified,
    edition,
    fetched: new Date().toISOString().slice(0, 10),
    status: 'M',
    selection:
      'Food businesses whose name starts with a chain listed in assets/js/core/brands.js. The chain dishes and their diet labels come from that file, not from this dataset.',
    places: places.map((p) => (edition ? { ...p, d: edition } : p)),
  };
  const file = path.resolve(ROOT, opt('--out', 'data/sources/kr-chains.json'));
  await writeFile(file, JSON.stringify(out, null, 1) + '\n');
  console.log(`wrote ${places.length} branches to ${path.relative(ROOT, file)}`);
  // The other kinds of food, next to the chains file.
  for (const [type, list] of Object.entries(food)) {
    const meta = OUTPUTS[type];
    const target = path.join(path.dirname(file), meta.file);
    const status = { cuisine: 'U', veg: 'V', sea: 'S', dish: 'D' }[type];
    await writeFile(
      target,
      JSON.stringify({ ...out, status, selection: meta.selection, places: list.map((p) => (edition ? { ...p, d: edition } : p)) }, null, ['sea', 'dish'].includes(type) ? 0 : 1) + '\n',
    );
    console.log(`wrote ${list.length} ${type} places to ${path.relative(ROOT, target)}`);
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] || '')).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
