#!/usr/bin/env node
// Public restaurant directory, with cursor pagination and Korean/English names.
// Keep only factual listings and a link to MUFKO, not photos, reviews or prose.
// node scripts/import-mufko.mjs [--cache FILE] [--reuse]
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInKorea, roundCoord } from '../assets/js/core/geo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/sources/kr-mufko-restaurants.json');
const API = 'https://api-v2.mufko.com/v1/places';

/** Read every page; a broken cursor or response must not replace a good list. */
export async function fetchRestaurants(locale, { fetchFn = fetch } = {}) {
  const items = [];
  const cursors = new Set();
  const ids = new Set();
  let cursor = null;
  do {
    const url = new URL(API);
    url.searchParams.set('kind', 'restaurant');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json', 'Accept-Language': locale, 'User-Agent': 'MuslimfoodDataImport/1.0 (+https://github.com/meaterick/Muslimfood)' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`MUFKO ${locale}: HTTP ${res.status}`);
    const page = await res.json();
    if (!Array.isArray(page.items) || !Object.hasOwn(page, 'nextCursor') ||
        (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor))) {
      throw new Error(`MUFKO ${locale}: invalid page`);
    }
    for (const item of page.items) {
      if (!Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)) throw new Error(`MUFKO ${locale}: invalid or repeated id`);
      ids.add(item.id);
      items.push(item);
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (!page.items.length || cursors.has(cursor) || cursors.size >= 100) throw new Error(`MUFKO ${locale}: pagination did not advance`);
      cursors.add(cursor);
    }
  } while (cursor);
  if (!items.length) throw new Error(`MUFKO ${locale}: empty directory`);
  return items;
}

/** Map the source's categories conservatively, keeping its original grade. */
export function mufkoPlace(row, korean, date) {
  const y = row.location?.lat;
  const x = row.location?.lng;
  if (row.kind !== 'restaurant' || !Number.isSafeInteger(row.id) || row.id <= 0 ||
      !Number.isFinite(y) || !Number.isFinite(x) || !isInKorea(y, x) ||
      !row.name?.trim() || ['closed', 'permanently_closed', 'temporarily_closed'].includes(row.operatingStatus)) return null;
  const mc = row.halalCategory?.code || 'unknown';
  const s = mc === 'muslim_certified' && row.halalCategory.isCertified === true ? 'C'
    : mc === 'self_certified' ? 'Y' : mc === 'halal_meat' ? 'L' : mc === 'veggie' ? 'M' : 'U';
  const n = korean?.name?.trim() || row.name.trim();
  return {
    id: `mufko-${row.id}`, n,
    ...(n !== row.name.trim() ? { nl: { en: row.name.trim() } } : {}),
    y: roundCoord(y), x: roundCoord(x), k: 'r', s,
    ...(s === 'U' ? { why: 'directory' } : {}),
    ...(s === 'M' ? { dv: 'vegetarian' } : {}),
    cu: [...new Set((row.cuisines || []).map((c) => c.code).filter((c) => c && c !== 'others'))],
    a: korean?.address?.trim() || row.address?.trim(),
    mf: row.id, mc,
    // Snapshot date, not the date of halal verification or certification.
    d: date,
  };
}

export async function importRestaurants({ fetchFn = fetch, previous, date = new Date().toISOString().slice(0, 10) } = {}) {
  const en = await fetchRestaurants('en', { fetchFn });
  const ko = new Map((await fetchRestaurants('ko', { fetchFn })).map((p) => [p.id, p]));
  if (ko.size !== en.length || en.some((p) => !ko.has(p.id))) throw new Error('MUFKO: language listings disagree');
  const places = en.map((p) => mufkoPlace(p, ko.get(p.id), date)).filter(Boolean).sort((a, b) => a.mf - b.mf);
  // Catch truncated responses that look like a complete single page.
  if (!places.length || (previous && places.length < previous.places.length * 0.8)) throw new Error(`MUFKO: suspicious directory size (${places.length})`);
  return {
    source: 'mufko',
    title: 'MUFKO (Muslim Friendly Korea) restaurant directory',
    publisher: 'MUFKO',
    url: 'https://app.mufko.com/restaurants',
    license: 'Factual restaurant information with source attribution',
    licenseNote: 'Public listing facts only; photos, descriptions and reviews are not reproduced. Each record links to the original MUFKO page.',
    fetched: date,
    selection: 'All pages of the public restaurant directory in English and Korean, with valid Korean coordinates; closed places excluded. Muslim Certified → C only with isCertified=true; Self Certified → Y; Halal Meat → L; Veggie → M (vegetarian dishes, not a fully vegetarian kitchen); Seafood, Salam and unknown categories → U (directory listing, not halal verification).',
    records: en.length,
    places,
  };
}

async function readSource(file) {
  try {
    const j = JSON.parse(await readFile(file, 'utf8'));
    if (j.source === 'mufko' && j.places?.length && j.places.every((p) => p.id === `mufko-${p.mf}` && p.n && Number.isFinite(p.y) && Number.isFinite(p.x) && isInKorea(p.y, p.x))) return j;
  } catch { /* absent or damaged cache: use the committed copy */ }
  return null;
}

async function save(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}

export async function main(args = process.argv.slice(2), { out = OUT, fetchFn = fetch } = {}) {
  const cache = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null;
  const cached = cache ? await readSource(cache) : null;
  const committed = await readSource(out);
  const previous = cached && (!committed || cached.fetched >= committed.fetched) ? cached : committed;
  let data = previous;
  if (!args.includes('--reuse') || !previous) {
    try {
      data = await importRestaurants({ previous, fetchFn });
      if (cache) await save(cache, data);
    } catch (err) {
      if (!previous) throw err;
      console.warn(`::warning::${err.message}; keeping the MUFKO snapshot from ${previous.fetched}`);
    }
  }
  await save(out, data);
  console.log(`MUFKO: ${data.places.length} places (snapshot ${data.fetched}, ${data.records} source records)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
