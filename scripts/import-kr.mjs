#!/usr/bin/env node
// Import Korean public datasets (data.go.kr, "이용허락범위 제한 없음") into
// data/sources/*.json. Run manually when the source datasets change:
//
//   node scripts/import-kr.mjs            # download, geocode, write
//   node scripts/import-kr.mjs --offline  # reuse files in .cache/ only
//
// Geocoding uses OpenStreetMap Nominatim / Photon (max 1 request per second)
// and is cached in .cache/geocode.json so re-runs are cheap.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvObjects, decodeKorean } from './lib/csv.mjs';
import { combineKoreanHours } from './lib/kr-hours.mjs';
import { namesMatch } from '../assets/js/core/text.js';
import { distance, roundCoord } from '../assets/js/core/geo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'data', 'sources');
const UA = 'MuslimfoodDataImport/1.0 (+https://github.com/meaterick/Muslimfood)';
const OFFLINE = process.argv.includes('--offline');

const DATASETS = {
  gg_restaurants: { pk: '15099378', title: '경기관광공사_경기도 무슬림 친화 음식점' },
  gg_prayer: { pk: '15099380', title: '경기관광공사_경기도 이슬람 예배당 및 예배소 현황' },
  kcisa_world: { pk: '15111398', title: '한국문화정보원_전국 세계 음식점 데이터' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- download

async function fetchRetry(url, init = {}, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      err = e;
      await sleep(2000 * 2 ** i);
    }
  }
  throw err;
}

async function downloadDataset(key) {
  const file = path.join(CACHE, `${key}.csv`);
  if (OFFLINE || (existsSync(file) && process.argv.includes('--cached'))) {
    return { text: decodeKorean(await readFile(file)), meta: JSON.parse(await readFile(file + '.json', 'utf8')) };
  }
  const { pk } = DATASETS[key];
  const page = await (await fetchRetry(`https://www.data.go.kr/data/${pk}/fileData.do`)).text();
  const uddi = new RegExp(`fn_fileDataDown\\('${pk}',\\s*'(uddi:[0-9a-f-]+)'`).exec(page)?.[1];
  if (!uddi) throw new Error(`Could not find file id for dataset ${pk}`);
  const ld = /(\{"@context":"https:\/\/schema\.org"[\s\S]*?\})\s*<\/script>/.exec(page);
  let modified = null;
  let name = DATASETS[key].title;
  let license = null;
  try {
    const j = JSON.parse(ld[1]);
    modified = j.dateModified;
    name = j.alternateName || j.name;
    license = j.license?.name;
  } catch {
    /* page layout changed; metadata is optional */
  }
  const body = new URLSearchParams({
    publicDataDetailPk: uddi,
    publicDataPk: pk,
    atchFileId: '',
    fileDetailSn: '1',
    publicDataTyCode: 'PR0051',
  });
  const info = await (
    await fetchRetry('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do', {
      method: 'POST',
      body,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  ).json();
  if (!info.status) throw new Error(`Download refused for ${pk}`);
  const url = `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${info.atchFileId}&fileDetailSn=${info.fileDetailSn}&dataNm=${encodeURIComponent(name)}`;
  const bytes = new Uint8Array(await (await fetchRetry(url)).arrayBuffer());
  const meta = {
    title: name,
    url: `https://www.data.go.kr/data/${pk}/fileData.do`,
    modified,
    license: license || '이용허락범위 제한 없음',
    fetched: new Date().toISOString().slice(0, 10),
  };
  await writeFile(file, bytes);
  await writeFile(file + '.json', JSON.stringify(meta, null, 2));
  return { text: decodeKorean(bytes), meta };
}

// ---------------------------------------------------------------- geocoding

let geoCache = {};
let lastGeoRequest = 0;

async function politeJson(url) {
  const wait = lastGeoRequest + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastGeoRequest = Date.now();
  const res = await fetchRetry(url, { headers: { 'Accept-Language': 'ko,en' } }, 3);
  return res.json();
}

function splitAddress(addr) {
  // "경기도 수원시 팔달구 매산로 7-1 2층" -> { street: "매산로", number: "7-1", main: "7" }
  const m = /([가-힣0-9.]+(?:로|길))\s*(\d+(?:-\d+)?)/.exec(addr);
  if (!m) return null;
  return { street: m[1], number: m[2], main: m[2].split('-')[0] };
}

function cleanAddress(addr) {
  return addr
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s\d+층.*$/, '')
    .replace(/\s(지하|B)\d*.*$/, '')
    .replace(/\s\d+호.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns { y, x, precision: "building" | "street" | "area" } or null. */
async function geocode(address) {
  const key = address;
  if (geoCache[key] !== undefined) return geoCache[key];
  if (OFFLINE) return null;
  const clean = cleanAddress(address);
  const parts = splitAddress(clean);
  let result = null;

  // 1) Nominatim free-form, accept building-level hits
  try {
    const q = new URLSearchParams({ q: clean, format: 'jsonv2', limit: '1', countrycodes: 'kr' });
    const [hit] = await politeJson(`https://nominatim.openstreetmap.org/search?${q}`);
    if (hit && hit.place_rank >= 28) result = { y: +hit.lat, x: +hit.lon, precision: 'building' };
  } catch (e) {
    console.warn('nominatim', e.message);
  }

  // 2) Photon, accept only when street and house number match
  if (!result && parts) {
    try {
      const q = new URLSearchParams({ q: clean, limit: '3' });
      const json = await politeJson(`https://photon.komoot.io/api/?${q}`);
      for (const f of json.features || []) {
        const p = f.properties || {};
        if (p.countrycode && p.countrycode !== 'KR') continue;
        if (p.street === parts.street && (p.housenumber === parts.number || p.housenumber === parts.main)) {
          const [x, y] = f.geometry.coordinates;
          result = { y, x, precision: 'building' };
          break;
        }
      }
    } catch (e) {
      console.warn('photon', e.message);
    }
  }

  // 3) Street-level fallback (approximate)
  if (!result && parts) {
    try {
      const prefix = clean.slice(0, clean.indexOf(parts.street)).trim();
      const q = new URLSearchParams({ q: `${prefix} ${parts.street}`, format: 'jsonv2', limit: '1', countrycodes: 'kr' });
      const [hit] = await politeJson(`https://nominatim.openstreetmap.org/search?${q}`);
      if (hit) result = { y: +hit.lat, x: +hit.lon, precision: 'street' };
    } catch (e) {
      console.warn('nominatim street', e.message);
    }
  }

  // 4) Neighbourhood / district fallback (very approximate)
  if (!result) {
    try {
      const area = clean.split(' ').slice(0, 3).join(' ');
      const q = new URLSearchParams({ q: area, format: 'jsonv2', limit: '1', countrycodes: 'kr' });
      const [hit] = await politeJson(`https://nominatim.openstreetmap.org/search?${q}`);
      if (hit) result = { y: +hit.lat, x: +hit.lon, precision: 'area' };
    } catch (e) {
      console.warn('nominatim area', e.message);
    }
  }

  geoCache[key] = result;
  return result;
}

// ---------------------------------------------------------------- helpers

const PROVINCE_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/;

function withProvince(addr, province) {
  const a = addr.replace(/\s+/g, ' ').trim();
  return PROVINCE_RE.test(a) ? a : `${province} ${a}`;
}

function cityOf(addr) {
  return /([가-힣]+시|[가-힣]+군)/.exec(addr.replace(/^[가-힣]+도\s/, ''))?.[1] || '';
}

const GG_CUISINE = {
  인도식: ['indian'],
  네팔인도식: ['nepalese', 'indian'],
  방글라데시식: ['bangladeshi'],
  우즈베키스탄식: ['uzbek'],
  인도네시아식: ['indonesian'],
  터키식: ['turkish'],
  파키스탄식: ['pakistani'],
  지중해식: ['mediterranean'],
  아랍식: ['arab'],
  말레이시아식: ['malaysian'],
};

// Korean cuisine words (KCISA categories) -> OSM cuisine tokens
const KCISA_CUISINE = {
  터키: 'turkish',
  우즈베키스탄: 'uzbek',
  파키스탄: 'pakistani',
  방글라데시: 'bangladeshi',
  방글라데쉬: 'bangladeshi',
  인도네시아: 'indonesian',
  말레이시아: 'malaysian',
  아랍: 'arab',
  이집트: 'egyptian',
  모로코: 'moroccan',
  레바논: 'lebanese',
  페르시아: 'persian',
  이란: 'iranian',
  중동: 'middle_eastern',
  중앙아시아: 'central_asian',
  카자흐스탄: 'kazakh',
  인도: 'indian',
  네팔: 'nepalese',
  지중해: 'mediterranean',
  러시아: 'russian',
  싱가포르: 'singaporean',
};
const LIKELY_KR = ['터키', '우즈베키스탄', '파키스탄', '방글라데시', '방글라데쉬', '인도네시아', '말레이시아', '아랍', '이집트', '모로코', '레바논', '페르시아', '이란', '중동', '중앙아시아', '카자흐스탄'];
// Mixed menus with cuisines that commonly use pork/alcohol -> not a useful hint.
const UNLIKELY_KR = ['멕시코', '미국', '이탈리아', '일본', '중국', '프랑스', '스페인', '베트남', '태국', '필리핀', '대만', '독일', '하와이', '브라질'];
const HALAL_NAME = /할랄|halal|حلال/i;
const LIKELY_NAME = /케밥|kebab|kebap|사마르칸트|samarkand|타슈켄트|tashkent|우즈벡|uzbek|인도네시아|indonesia|말레이시아|malaysia|파키스탄|pakistan|아랍|arab|이스탄불|istanbul|두바이|dubai/i;
const EXCLUDE_NAME = /발리|bali|펍|pub|\bbar\b|호프|포차|술집|비어|beer|와인|wine|bistro|비스트로/i;

function kcisaCuisine(cat3) {
  const out = [];
  for (const w of cat3.split(/\s+/)) {
    const t = KCISA_CUISINE[w];
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function kcisaCandidate(r) {
  const name = r['시설명'];
  if (EXCLUDE_NAME.test(name)) return null;
  const cat2 = r['카테고리2'];
  const words = r['카테고리3'].split(/\s+/);
  if (HALAL_NAME.test(name)) return 'name';
  const likely =
    words.some((w) => LIKELY_KR.includes(w)) || ['중동음식', '중앙아시아음식', '서아시아음식'].includes(cat2);
  const unlikely = words.some((w) => UNLIKELY_KR.includes(w));
  if (likely && !unlikely) return 'cuisine';
  if (LIKELY_NAME.test(name) && !unlikely && cat2 !== '남미음식') return 'cuisine';
  return null;
}

function koreanPhone(p) {
  const v = String(p || '').trim();
  return /^[0-9+][0-9\- ]{6,}$/.test(v) ? v : undefined;
}

function sourceHeader(key, meta, extra = {}) {
  return {
    source: key,
    title: meta.title,
    publisher: key.startsWith('gg') ? '경기관광공사 (Gyeonggi Tourism Organization)' : '한국문화정보원 (Korea Culture Information Service Agency)',
    url: meta.url,
    license: meta.license,
    licenseNote: '공공데이터포털 이용허락범위 제한 없음 (no usage restrictions); attribution given in the app.',
    modified: meta.modified,
    fetched: meta.fetched,
    ...extra,
  };
}

// ---------------------------------------------------------------- main

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const geoFile = path.join(CACHE, 'geocode.json');
  if (existsSync(geoFile)) geoCache = JSON.parse(await readFile(geoFile, 'utf8'));
  const saveGeo = () => writeFile(geoFile, JSON.stringify(geoCache, null, 1));

  // ---- KCISA world restaurants (has coordinates)
  const world = await downloadDataset('kcisa_world');
  const worldRows = parseCsvObjects(world.text);
  console.log(`KCISA world restaurants: ${worldRows.length} rows`);
  const kcisa = [];
  for (const r of worldRows) {
    const why = kcisaCandidate(r);
    if (!why) continue;
    const y = +r['위도'];
    const x = +r['경도'];
    if (!Number.isFinite(y) || !Number.isFinite(x) || !y || !x) continue;
    const oh = combineKoreanHours(r['평일 운영시간'], r['주말 운영시간']);
    const ohx =
      !oh && (r['평일 운영시간'] !== '정보없음' || r['주말 운영시간'] !== '정보없음')
        ? `평일 ${r['평일 운영시간']} / 주말 ${r['주말 운영시간']}`
        : undefined;
    kcisa.push({
      n: r['시설명'],
      y: roundCoord(y),
      x: roundCoord(x),
      k: 'r',
      s: 'U',
      why,
      cu: kcisaCuisine(r['카테고리3']),
      a: r['도로명주소'] || r['지번주소'],
      ph: koreanPhone(r['전화번호']),
      oh: oh || undefined,
      ohx,
      v: r['채식메뉴 보유여부'] === 'Y' ? 1 : undefined,
      d: r['최종작성일'] || undefined,
    });
  }
  kcisa.sort((a, b) => a.a.localeCompare(b.a, 'ko') || a.n.localeCompare(b.n, 'ko'));
  kcisa.forEach((p, i) => (p.id = `kcisa-${String(i + 1).padStart(3, '0')}`));
  console.log(`KCISA candidates: ${kcisa.length}`);

  // ---- Gyeonggi Muslim-friendly restaurants (address only)
  const gg = await downloadDataset('gg_restaurants');
  const ggRows = parseCsvObjects(gg.text);
  const ggOut = [];
  let i = 0;
  for (const r of ggRows) {
    const name = r['상호'];
    if (!name) continue;
    const address = withProvince(r['주소'], '경기도');
    const city = cityOf(address);
    // Prefer coordinates from the KCISA dataset (same business, same city).
    const match = worldRows.find(
      (w) => w['시군구 명칭'].startsWith(city) && namesMatch(w['시설명'], name) && +w['위도'] && +w['경도'],
    );
    let geo = match ? { y: +match['위도'], x: +match['경도'], precision: 'building' } : await geocode(address);
    if (!geo) {
      console.warn(`  ! could not geocode ${name} (${address})`);
      continue;
    }
    ggOut.push({
      id: `gg-${String(++i).padStart(3, '0')}`,
      n: name,
      y: roundCoord(geo.y),
      x: roundCoord(geo.x),
      k: 'r',
      s: 'F',
      cu: GG_CUISINE[r['종류']] || [],
      a: address,
      ph: koreanPhone(r['연락처']),
      // approximate location: 1 = street level, 2 = neighbourhood level
      ap: geo.precision === 'street' ? 1 : geo.precision === 'area' ? 2 : undefined,
      d: gg.meta.title.match(/_(\d{4})(\d{2})(\d{2})$/)?.slice(1).join('-'),
    });
    await saveGeo();
  }
  console.log(`Gyeonggi restaurants: ${ggOut.length}/${ggRows.length} geocoded`);

  // ---- Gyeonggi mosques & prayer rooms (address only, 2018 survey)
  const pr = await downloadDataset('gg_prayer');
  const prRows = parseCsvObjects(pr.text);
  const prOut = [];
  i = 0;
  for (const r of prRows) {
    const address = withProvince(r['주소'], '경기도');
    const geo = await geocode(address);
    // Unnamed places need a usable pin; neighbourhood-level guesses are too vague.
    if (!geo || geo.precision === 'area') {
      console.warn(`  ! skipped prayer place without precise location (${address})`);
      continue;
    }
    prOut.push({
      id: `ggp-${String(++i).padStart(3, '0')}`,
      n: '',
      y: roundCoord(geo.y),
      x: roundCoord(geo.x),
      k: 'p',
      pt: /MASJID/i.test(r['구분']) ? 'mosque' : 'musalla',
      a: address,
      ap: geo.precision === 'street' ? 1 : undefined,
      d: pr.meta.title.match(/_(\d{4})(\d{2})(\d{2})$/)?.slice(1).join('-'),
    });
    await saveGeo();
  }
  console.log(`Gyeonggi prayer places: ${prOut.length}/${prRows.length} geocoded`);

  // KCISA entries that duplicate an official Gyeonggi entry are dropped there.
  const kcisaDeduped = kcisa.filter(
    (p) => !ggOut.some((g) => distance(g.y, g.x, p.y, p.x) < 150 && namesMatch(g.n, p.n)),
  );

  const clean = (arr) =>
    arr.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))));

  await writeFile(
    path.join(OUT, 'kr-gyeonggi-restaurants.json'),
    JSON.stringify({ ...sourceHeader('gg', gg.meta, { status: 'F' }), places: clean(ggOut) }, null, 1) + '\n',
  );
  await writeFile(
    path.join(OUT, 'kr-gyeonggi-prayer.json'),
    JSON.stringify({ ...sourceHeader('gg', pr.meta), places: clean(prOut) }, null, 1) + '\n',
  );
  await writeFile(
    path.join(OUT, 'kr-kcisa-world-cuisine.json'),
    JSON.stringify(
      {
        ...sourceHeader('kcisa', world.meta, {
          status: 'U',
          selection:
            'Restaurants whose name mentions halal, or whose cuisine is usually halal in Korea (Turkish, Uzbek, Middle Eastern, Pakistani, Indonesian, ...). Shown as unconfirmed.',
        }),
        places: clean(kcisaDeduped),
      },
      null,
      1,
    ) + '\n',
  );
  console.log('Wrote data/sources/*.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
