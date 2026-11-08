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

const KR_CUISINES =
  'turkish|kebab|doner|uzbek|pakistani|arab|lebanese|middle_eastern|persian|iranian|afghan|indonesian|malaysian|egyptian|moroccan|bangladeshi|syrian|iraqi|yemeni|saudi|kazakh|kyrgyz|uyghur|uighur|tajik|turkmen|kurdish|palestinian|jordanian|tunisian|algerian|sudanese|somali|emirati|azerbaijani|shawarma|falafel|halal|central_asian';
const KR_NAMES =
  '할랄|halal|حلال|케밥|kebab|kebap|사마르칸트|samarkand|타슈켄트|tashkent|우즈벡|uzbek|이스탄불|istanbul|튀르키예|터키|turkish|아랍|arabian|파키스탄|pakistan|인도네시아|indonesia|말레이시아|malaysia|مطعم';

/**
 * Korea-only extras: likely-halal cuisines, halal-ish names (unconfirmed hints)
 * and mosques / prayer rooms. Uses a bounding box rather than an area lookup
 * because not every Overpass server has area data; the build keeps only
 * results inside South Korea.
 */
export function koreaQuery(timeout = 600) {
  const food = '["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]';
  const b = `(${bboxString(KOREA_QUERY_BBOX)})`;
  return `[out:json][timeout:${timeout}];
(
  nwr${food}["cuisine"~"${KR_CUISINES}",i]${b};
  nwr${food}["name"~"${KR_NAMES}",i]${b};
  nwr["shop"]["name"~"할랄|halal|حلال",i]${b};
  nwr["amenity"="place_of_worship"]["religion"="muslim"]${b};
);
out center tags qt;`;
}

// South Korea incl. Jeju, Ulleungdo and Dokdo, [w, s, e, n].
const KOREA_QUERY_BBOX = [124.5, 33.0, 131.95, 38.65];

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
 * opts: { endpoints, fetchImpl, signal, timeoutMs (per attempt), deadline (epoch ms, overall),
 *         retries (extra attempts per endpoint when it is busy: HTTP 429/502/503/504),
 *         retryDelayMs (first wait, doubled each time), sleep, onAttempt, onError, userAgent,
 *         accept(json) -> error message when the result is not plausible }
 */
export async function runOverpass(query, opts = {}) {
  const endpoints = opts.endpoints || OVERPASS_ENDPOINTS;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const retries = opts.retries ?? 0;
  const retryDelayMs = opts.retryDelayMs ?? 30000;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const timeLeft = () => (opts.deadline ? opts.deadline - Date.now() : Infinity);
  let lastErr;
  endpointLoop: for (const url of endpoints) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const left = timeLeft();
      if (left < 20000) {
        lastErr = lastErr || new Error('Overpass time budget used up');
        break endpointLoop;
      }
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeoutMs || 60000, left));
      let busy = false;
      try {
        opts.onAttempt?.(url, attempt);
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
        if (opts.userAgent) headers['User-Agent'] = opts.userAgent;
        const res = await fetchImpl(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          busy = [429, 502, 503, 504].includes(res.status);
          throw new Error(`HTTP ${res.status} from ${url}`);
        }
        const json = await res.json();
        if (!json || !Array.isArray(json.elements)) throw new Error(`Bad response from ${url}`);
        if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) {
          busy = /timed out|out of memory/i.test(json.remark);
          throw new Error(`Overpass remark from ${url}: ${json.remark}`);
        }
        // e.g. a mirror without complete data answers with far too few elements
        const problem = opts.accept?.(json);
        if (problem) throw new Error(`${problem} from ${url}`);
        return json;
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        lastErr = err;
        opts.onError?.(url, err, attempt);
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
      // A busy server (rate limit, overload) often frees a slot within minutes: wait and retry.
      if (!busy || attempt === retries) break;
      const wait = Math.min(retryDelayMs * 2 ** attempt, timeLeft() - 30000);
      if (wait <= 0) break;
      await sleep(wait);
    }
  }
  throw lastErr || new Error('No Overpass endpoint available');
}
