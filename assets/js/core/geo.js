// Geographic helpers shared by the browser app and the Node data build.
// Pure functions only (no DOM), so they can be unit-tested with `node --test`.

const R = 6371008.8; // mean Earth radius in metres

/** Great-circle distance in metres between two lat/lon points. */
export function distance(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Size of one data cell in degrees. Data files are split on this grid. */
export const CELL_SIZE = 1;

/** Key of the grid cell containing a point, e.g. "37_126". */
export function cellKey(lat, lon, size = CELL_SIZE) {
  const y = Math.floor(lat / size) * size;
  // normalise longitude into [-180, 180)
  const nlon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const x = Math.floor(nlon / size) * size;
  return `${y}_${x}`;
}

/**
 * All cell keys intersecting a bounding box.
 * bbox = [west, south, east, north]; handles antimeridian crossing (west > east).
 */
export function cellsForBbox(bbox, size = CELL_SIZE, max = 400) {
  let [w, s, e, n] = bbox;
  s = Math.max(-90, s);
  n = Math.min(89.999999, n);
  const ranges = w <= e ? [[w, e]] : [[w, 180], [-180, e]];
  const keys = [];
  for (const [rw, re] of ranges) {
    const x0 = Math.floor(Math.max(-180, rw) / size);
    const x1 = Math.floor(Math.min(179.999999, re) / size);
    const y0 = Math.floor(s / size);
    const y1 = Math.floor(n / size);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        keys.push(`${y * size}_${x * size}`);
        if (keys.length >= max) return keys;
      }
    }
  }
  return keys;
}

/** True when the point lies inside bbox [w, s, e, n] (antimeridian aware). */
export function inBbox(lat, lon, bbox) {
  const [w, s, e, n] = bbox;
  if (lat < s || lat > n) return false;
  return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
}

/** Expand bbox by a fraction of its size on every side. */
export function padBbox(bbox, ratio = 0.1) {
  const [w, s, e, n] = bbox;
  const dx = (e - w) * ratio;
  const dy = (n - s) * ratio;
  return [w - dx, s - dy, e + dx, n + dy];
}

/**
 * Rough bounding box of South Korea (mainland, Jeju, Ulleungdo, Dokdo).
 * Used for Korea-specific behaviour (map links order, time zone, guide prompts).
 */
export const KOREA_BBOX = [124.5, 33.0, 131.95, 38.65];

/** Polygon-ish test that excludes most of North Korea, China and Tsushima. */
export function isInKorea(lat, lon) {
  if (!inBbox(lat, lon, KOREA_BBOX)) return false;
  // Exclude Tsushima / Kyushu (Japan)
  if (lat < 34.8 && lon > 129.0) return false;
  // Exclude North Korea: north of the DMZ which runs roughly from the Han
  // estuary (37.8N, 126.6E) to the east coast at Goseong (38.6N, 128.36E).
  const dmzLat =
    lon < 126.68 ? 37.8 : lon < 127.0 ? 38.0 : lon < 127.4 ? 38.3 : lon < 128.1 ? 38.35 : 38.62;
  if (lat > dmzLat) return false;
  // Exclude Chinese coast west of the Yellow Sea
  if (lon < 124.6) return false;
  return true;
}

/** Format a distance for humans using the given locale. */
export function formatDistance(m, locale = 'en') {
  if (!Number.isFinite(m)) return '';
  if (m < 950) {
    const v = Math.max(10, Math.round(m / 10) * 10);
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 }).format(v);
  }
  const km = m / 1000;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'kilometer',
    maximumFractionDigits: km < 10 ? 1 : 0,
  }).format(km);
}

/** Round coordinates for compact storage (~1 m precision). */
export function roundCoord(v) {
  return Math.round(v * 1e5) / 1e5;
}
