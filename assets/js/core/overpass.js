// Overpass API queries and a fetch helper with endpoint fail-over.
// Used by the GitHub Actions data build and by the browser when no prebuilt
// data is available for an area (or for prayer places outside Korea).

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Names that say "halal" in common scripts: Latin, Arabic, Korean, Chinese, Japanese, Turkish.
export const HALAL_NAME_PATTERN = 'halal|حلال|할랄|清真|ハラール|ハラル|helal';

const FOOD_AMENITIES = ['restaurant', 'fast_food', 'cafe', 'food_court'];
const FOOD_SHOPS = ['butcher', 'supermarket', 'convenience', 'deli', 'bakery', 'grocery'];

/** Elements explicitly tagged halal (the core worldwide dataset). */
export function taggedQuery(bbox, timeout = 900) {
  const b = bbox ? `(${bboxString(bbox)})` : '';
  return `[out:json][timeout:${timeout}];
(
  nwr["diet:halal"~"^(yes|only|limited)$"]${b};
  nwr["halal"~"^(yes|only)$"]${b};
);
out center tags qt;`;
}

/** Food places whose name says halal but which have no diet:halal tag yet. */
export function nameQuery(bbox, timeout = 900) {
  const b = bbox ? `(${bboxString(bbox)})` : '';
  const lines = [
    ...FOOD_AMENITIES.map((a) => `  nwr["amenity"="${a}"]["name"~"${HALAL_NAME_PATTERN}",i][!"diet:halal"]${b};`),
    ...FOOD_SHOPS.map((s) => `  nwr["shop"="${s}"]["name"~"${HALAL_NAME_PATTERN}",i][!"diet:halal"]${b};`),
  ];
  return `[out:json][timeout:${timeout}];
(
${lines.join('\n')}
);
out center tags qt;`;
}

const KR_CUISINES =
  'turkish|kebab|doner|uzbek|pakistani|arab|lebanese|middle_eastern|persian|iranian|afghan|indonesian|malaysian|egyptian|moroccan|bangladeshi|syrian|iraqi|yemeni|saudi|kazakh|kyrgyz|uyghur|uighur|tajik|turkmen|kurdish|palestinian|jordanian|tunisian|algerian|sudanese|somali|emirati|azerbaijani|shawarma|falafel|halal|central_asian';
const KR_NAMES =
  '할랄|halal|حلال|케밥|kebab|kebap|사마르칸트|samarkand|타슈켄트|tashkent|우즈벡|uzbek|이스탄불|istanbul|튀르키예|터키|turkish|아랍|arabian|파키스탄|pakistan|인도네시아|indonesia|말레이시아|malaysia|مطعم';

/**
 * Korea-only extras: likely-halal cuisines, halal-ish names (unconfirmed hints)
 * and mosques / prayer rooms.
 */
export function koreaQuery(timeout = 600) {
  const food = '["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]';
  return `[out:json][timeout:${timeout}];
area["ISO3166-1"="KR"][admin_level=2]->.kr;
(
  nwr(area.kr)${food}["cuisine"~"${KR_CUISINES}",i];
  nwr(area.kr)${food}["name"~"${KR_NAMES}",i];
  nwr(area.kr)["shop"]["name"~"할랄|halal|حلال",i];
  nwr(area.kr)["amenity"="place_of_worship"]["religion"="muslim"];
);
out center tags qt;`;
}

/** Mosques and prayer rooms in a bounding box (browser, outside Korea). */
export function prayerQuery(bbox, timeout = 25) {
  return `[out:json][timeout:${timeout}];
nwr["amenity"="place_of_worship"]["religion"="muslim"](${bboxString(bbox)});
out center tags qt;`;
}

/** Live query for a viewport when no prebuilt data exists. */
export function liveFoodQuery(bbox, timeout = 25) {
  const b = `(${bboxString(bbox)})`;
  return `[out:json][timeout:${timeout}];
(
  nwr["diet:halal"~"^(yes|only|limited)$"]${b};
  nwr["halal"~"^(yes|only)$"]${b};
  nwr["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]["name"~"${HALAL_NAME_PATTERN}",i][!"diet:halal"]${b};
);
out center tags qt;`;
}

/** Overpass bbox order is south,west,north,east. Input bbox is [w, s, e, n]. */
export function bboxString([w, s, e, n]) {
  const f = (v) => Number(v).toFixed(5);
  return `${f(s)},${f(w)},${f(n)},${f(e)}`;
}

/**
 * POST a query to the first Overpass endpoint that answers.
 * opts: { endpoints, fetchImpl, signal, timeoutMs (per endpoint), deadline (epoch ms, overall),
 *         onAttempt, userAgent }
 */
export async function runOverpass(query, opts = {}) {
  const endpoints = opts.endpoints || OVERPASS_ENDPOINTS;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  let lastErr;
  for (const url of endpoints) {
    const left = opts.deadline ? opts.deadline - Date.now() : Infinity;
    if (left < 20000) {
      lastErr = lastErr || new Error('Overpass time budget used up');
      break;
    }
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeoutMs || 60000, left));
    try {
      opts.onAttempt?.(url);
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
      if (opts.userAgent) headers['User-Agent'] = opts.userAgent;
      const res = await fetchImpl(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.elements)) throw new Error(`Bad response from ${url}`);
      if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
        throw new Error(`Overpass remark from ${url}: ${json.remark}`);
      }
      return json;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr || new Error('No Overpass endpoint available');
}
