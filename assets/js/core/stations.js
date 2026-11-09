// Railway and subway stations in Korea, used to say where a place is
// ("near Yeoksam Stn.") in a way visitors can find on signs and maps.
// Built from OpenStreetMap by scripts/build-data.mjs into data/stations.json:
//   { v: 1, s: [[korean name, English name or 0, lat, lon], ...] }
// Names are stored without the "역" / "Station" suffix.

import { distance, isInKorea, roundCoord } from './geo.js';

export const NEAR_STATION_M = 600;
const SAME_STATION_M = 800;

const clean = (s) =>
  String(s || '')
    .normalize('NFKC')
    .replace(/\s*[([（].*?[)\]）]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "서울역" -> "서울", "역삼" stays (the suffix only when something is left). */
export function koreanBase(name) {
  const n = clean(name).replace(/\s*(KTX|SRT)$/i, '');
  return n.length >= 3 && n.endsWith('역') ? n.slice(0, -1).trim() : n;
}

/** "Yeoksam Station" -> "Yeoksam". */
export function englishBase(name) {
  return clean(name)
    .replace(/\s+(railway\s+)?(station|stn\.?)$/i, '')
    .trim();
}

function isRailStation(tags) {
  if (/^(station|halt)$/.test(tags.railway || '')) return tags.station !== 'funicular' && !/bus/.test(tags.station || '');
  if (tags.public_transport !== 'station') return false;
  return ['train', 'subway', 'light_rail', 'monorail'].some((k) => tags[k] === 'yes');
}

/** Station rows from Overpass elements (nodes, or ways/relations with a center). */
export function stationsFromOsm(elements) {
  const out = [];
  const grid = new Map();
  const cell = (y, x) => `${Math.floor(y * 50)}:${Math.floor(x * 50)}`;
  const rows = elements
    .map((el) => {
      const tags = el.tags || {};
      const y = el.lat ?? el.center?.lat;
      const x = el.lon ?? el.center?.lon;
      if (!isRailStation(tags) || !Number.isFinite(y) || !isInKorea(y, x)) return null;
      const ko = koreanBase(tags['name:ko'] || tags.name);
      if (!ko || !/[가-힣]/.test(ko)) return null;
      const en = englishBase(tags['name:en'] || '');
      return { ko, en: en && /^[\x20-\x7eÀ-ɏ]+$/.test(en) ? en : '', y, x, id: `${el.type}${el.id}` };
    })
    .filter(Boolean)
    // Stable order; prefer rows with an English name when duplicates collapse.
    .sort((a, b) => Number(Boolean(b.en)) - Number(Boolean(a.en)) || (a.id < b.id ? -1 : 1));
  for (const r of rows) {
    // One row per station: platforms and lines of one station share its name.
    const near = [];
    const cy = Math.floor(r.y * 50);
    const cx = Math.floor(r.x * 50);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) near.push(...(grid.get(`${cy + i}:${cx + j}`) || []));
    if (near.some((o) => o.ko === r.ko && distance(o.y, o.x, r.y, r.x) < SAME_STATION_M)) continue;
    const row = { ko: r.ko, en: r.en, y: roundCoord(r.y), x: roundCoord(r.x) };
    out.push(row);
    const key = cell(r.y, r.x);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(row);
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out.map((r) => [r.ko, r.en || 0, r.y, r.x]);
}

/** A lookup for the nearest station within `maxM` metres. */
export function stationIndex(rows, maxM = NEAR_STATION_M) {
  const grid = new Map();
  const key = (i, j) => `${i}:${j}`;
  for (const [ko, en, y, x] of rows || []) {
    const k = key(Math.floor(y * 100), Math.floor(x * 100));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ ko, en: en || '', y, x });
  }
  return (y, x) => {
    let best = null;
    const ci = Math.floor(y * 100);
    const cj = Math.floor(x * 100);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const s of grid.get(key(ci + i, cj + j)) || []) {
          const d = distance(y, x, s.y, s.x);
          if (d <= maxM && (!best || d < best.d)) best = { ...s, d };
        }
      }
    }
    return best;
  };
}
