// Muslimfood — app entry. Wires state, URL, map, list, detail, filters,
// search, dialogs and the service worker together.

import { detectLang, setLang, t, lang, applyDom } from './ui/i18n.js';
import { $, storage, debounce, toast, copyText } from './ui/util.js';
import {
  store,
  loadIndex,
  ensureArea,
  ensureLive,
  hasMoreToDiscover,
  placesIn,
  getPlace,
  findPlace,
  loadSearchCatalog,
  tzFor,
  summaryGeoJSON,
  countInView,
  loadStations,
  DETAIL_ZOOM,
  LIVE_ZOOM,
} from './ui/store.js';
import { MapView, preloadMapLibrary } from './ui/mapview.js';
import { Sheet } from './ui/sheet.js';
import { initSearch } from './ui/search.js';
import { listItemHtml, detailHtml, noticeHtml, skeletonHtml, displayName, nearText } from './ui/render.js';
import { initDialogs, renderMenu, renderAbout, openGuide, initGuide, openDialog, initBig, hideBig } from './ui/dialogs.js';
import { AREAS, areaName, SEOUL_DEFAULT, TZ_START } from './ui/content.js';
import { distance, padBbox, isInKorea, inBbox } from './core/geo.js';
import { isOpenNow } from './core/hours.js';
import { cuisineGroupOf, CUISINE_GROUP_KEYS, MEAT_FREE, ALTERNATIVES } from './core/normalize.js';
import { esc, matchesQuery } from './core/text.js';
import { icon } from './ui/icons.js';
import { track, trackPageview, initTracking } from './ui/analytics.js';
import { renderOwnerForm, voteHtml, handleVoteAction, refreshVoteCounts } from './ui/feedback.js';

const PAGE = 40;
// "Show" choices: halal and vegetarian places, halal only, or vegetarian only.
// "Show" choices: halal places with meat-free alternatives (default), halal
// only, meat-free only, halal with seafood restaurants, and everything.
const SHOW = ['all', 'halal', 'veg', 'sea', 'every'];
const SHOW_ICON = { all: 'leaf', halal: 'restaurant', veg: 'leaf', sea: 'fish', every: 'menu' };
/** Does the current choice include seafood restaurants (loaded separately)? */
const showsSea = () => state.filters.show === 'sea' || state.filters.show === 'every';
const savedShow = () => {
  const v = storage.get('show');
  return SHOW.includes(v) ? v : 'all';
};
const app = $('#app');
const panel = $('#panel');

// Start the two big downloads right away, before anything else is awaited.
const indexReady = loadIndex();
preloadMapLibrary(); // MapView.init() awaits the same download

const state = {
  theme: storage.get('theme', 'auto'),
  filters: { show: savedShow(), confirmed: false, open: false, cuisine: '', cats: new Set(), prayer: false },
  user: null,
  selected: null,
  limit: PAGE,
  view: null, // used when the map is unavailable
  loading: false,
  loadError: null,
  fitNearest: false,
  pushedDetail: false,
  discovering: false,
  searchPin: null,
  query: null, // keyword search: { text, typed, rows, ids } — only matching places are shown
};

let map = null;
let sheet = null;
let deferredInstall = null;
let swReg = null;
let search = null;

// ------------------------------------------------------------------ URL state

function parseHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const out = {};
  const m = (h.get('map') || '').split('/').map(Number);
  if (m.length === 3 && m.every(Number.isFinite) && Math.abs(m[1]) <= 90) {
    out.zoom = Math.min(19, Math.max(1, m[0]));
    out.lat = m[1];
    out.lon = m[2];
  }
  if (h.get('place')) out.place = h.get('place');
  return out;
}

function hashFor(v, placeId) {
  const p = new URLSearchParams();
  p.set('map', `${v.zoom.toFixed(2)}/${v.lat.toFixed(5)}/${v.lon.toFixed(5)}`);
  if (placeId) p.set('place', placeId);
  return `#${p.toString().replace(/%2F/g, '/')}`;
}

const writeHash = debounce(() => {
  const v = getView();
  history.replaceState(history.state, '', `${location.pathname}${location.search}${hashFor(v, state.selected)}`);
}, 300);

function startView() {
  const h = parseHash();
  if (h.lat !== undefined) return { lat: h.lat, lon: h.lon, zoom: h.zoom, place: h.place, fromHash: true };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const c = TZ_START[tz];
  if (c && lang() !== 'ko') return { lat: c[0], lon: c[1], zoom: 12 };
  return { lat: SEOUL_DEFAULT.y, lon: SEOUL_DEFAULT.x, zoom: SEOUL_DEFAULT.z, place: h.place };
}

// ------------------------------------------------------------------ view helpers

function getView() {
  if (map) {
    const c = map.center();
    return { lat: c.lat, lon: c.lon, zoom: map.zoom(), bbox: map.bounds() };
  }
  const v = state.view;
  const d = 0.012 * 2 ** (15 - v.zoom);
  return { ...v, bbox: [v.lon - d * 1.25, v.lat - d, v.lon + d * 1.25, v.lat + d] };
}

/** Move the map. `marker` (a searched spot) replaces the search pin; leave it out to keep the pin. */
function moveTo({ lat, lon, zoom = 15, bbox = null, marker }) {
  if (marker !== undefined) setSearchPin(marker);
  if (map) {
    if (bbox && Math.abs(bbox[2] - bbox[0]) < 30) {
      map.map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { maxZoom: 16, padding: 30, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900 },
      );
    } else map.flyTo({ lat, lon, zoom });
  } else {
    state.view = { lat, lon, zoom };
    refresh();
  }
}

function setSearchPin(marker) {
  state.searchPin = marker || null;
  map?.setSearchPin(state.searchPin);
}

/** Where distances are measured from: a searched spot in view, else the visitor nearby, else the map centre. */
function refPoint(v) {
  const pin = state.searchPin;
  if (pin && inBbox(pin.lat, pin.lon, padBbox(v.bbox, 0.01))) return { lat: pin.lat, lon: pin.lon, pin };
  if (state.user && distance(state.user.lat, state.user.lon, v.lat, v.lon) < 30000) return { lat: state.user.lat, lon: state.user.lon, isUser: true };
  return { lat: v.lat, lon: v.lon, isUser: false };
}

// ------------------------------------------------------------------ filters

function inCuisine(p, g) {
  return (p.cu || []).some((tok) => cuisineGroupOf(tok) === g);
}

/** During a keyword search, is this one of the matches? */
function inQuery(p) {
  const q = state.query;
  return !q || q.ids.has(p.id) || (p.src === 'live' && matchesQuery(p, q.text));
}

function passes(p, now, { ignoreConfirmed = false } = {}) {
  const f = state.filters;
  if (!inQuery(p)) return false;
  if (!showPasses(p, f.show)) return false;
  if (!ignoreConfirmed && f.confirmed && p.s === 'U') return false;
  if (f.cats.size && !f.cats.has(p.k)) return false;
  if (f.cuisine && !inCuisine(p, f.cuisine)) return false;
  if (f.open && isOpenNow(p.oh, now, tzFor(p)) !== true) return false;
  return true;
}

/** The "Show" choice for one place. */
function showPasses(p, show) {
  switch (show) {
    case 'halal':
      return !ALTERNATIVES.has(p.s);
    // meat-free kitchens, places with vegetarian dishes, and halal places that have some
    case 'veg':
      return MEAT_FREE.has(p.s) || Boolean(p.v);
    case 'sea':
      return p.s === 'S' || !ALTERNATIVES.has(p.s);
    case 'every':
      return true;
    default:
      return p.s !== 'S';
  }
}

/** The same filters for rows of the search catalog (no opening hours there). */
function rowPasses(r) {
  const f = state.filters;
  if (r.k === 'p') return f.prayer;
  if (!showPasses(r, f.show)) return false;
  if (f.confirmed && r.s === 'U') return false;
  if (f.cats.size && !f.cats.has(r.k)) return false;
  if (f.cuisine && !inCuisine(r, f.cuisine)) return false;
  return true;
}

function filtersActive() {
  const f = state.filters;
  return f.show !== 'all' || f.confirmed || f.open || f.cuisine || f.cats.size > 0;
}

function renderChips() {
  const f = state.filters;
  const chip = (key, label, pressed, extra = '') =>
    `<button type="button" class="chip ${extra}" data-filter="${key}" aria-pressed="${pressed}">${label}</button>`;
  const showKey = { all: 'filter.showAll', halal: 'filter.showHalal', veg: 'filter.showVeg', sea: 'filter.showSea', every: 'filter.showEvery' };
  $('#chips').innerHTML = [
    `<label class="chip has-select" data-active="${f.show !== 'all'}">${icon(SHOW_ICON[f.show])}<span class="visually-hidden">${esc(t('filter.show'))}</span><select id="show-select">${SHOW.map(
      (v) => `<option value="${v}"${v === f.show ? ' selected' : ''}>${esc(t(showKey[v]))}</option>`,
    ).join('')}</select></label>`,
    chip('confirmed', `${icon('check')}${esc(t('filter.confirmed'))}`, f.confirmed),
    chip('open', `${icon('clock')}${esc(t('filter.openNow'))}`, f.open),
    `<label class="chip has-select" data-active="${Boolean(f.cuisine)}">${icon('sliders')}<span class="visually-hidden">${esc(t('filter.cuisine'))}</span><select id="cuisine-select"><option value="">${esc(
      t('filter.cuisineAny'),
    )}</option></select></label>`,
    ...['r', 'f', 'c', 'm'].map((k) => chip(`cat-${k}`, esc(t(`filter.cat.${k}`)), f.cats.has(k))),
    chip('prayer', `${icon('prayer')}${esc(t('filter.prayer'))}`, f.prayer, 'chip-prayer'),
  ].join('');
}

function updateCuisineOptions(food) {
  const sel = $('#cuisine-select');
  if (!sel) return;
  const counts = {};
  for (const p of food) {
    const seen = new Set();
    for (const tok of p.cu || []) {
      const g = cuisineGroupOf(tok);
      if (g && !seen.has(g)) {
        seen.add(g);
        counts[g] = (counts[g] || 0) + 1;
      }
    }
  }
  const groups = CUISINE_GROUP_KEYS.filter((g) => counts[g] || g === state.filters.cuisine).sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  const html =
    `<option value="">${esc(t('filter.cuisineAny'))}</option>` +
    groups.map((g) => `<option value="${g}"${g === state.filters.cuisine ? ' selected' : ''}>${esc(t(`cuisine.group.${g}`))} (${counts[g] || 0})</option>`).join('');
  if (sel.innerHTML !== html) sel.innerHTML = html;
  sel.closest('.chip').dataset.active = String(Boolean(state.filters.cuisine));
}

// ------------------------------------------------------------------ rendering

/** The station within walking distance of a place in Korea, once the station list is loaded. */
function stationOf(p) {
  return store.nearStation && isInKorea(p.y, p.x) ? store.nearStation(p.y, p.x) : null;
}

function setHeader(title, count) {
  $('#list-title').textContent = title;
  $('#list-count').textContent = count;
}

/** First-visit key to the markers; hidden for good once dismissed or the level guide is opened. */
function legendHtml() {
  const row = (cls, glyph, key) => `<li><span class="mark ${cls}" aria-hidden="true">${icon(glyph)}</span><span>${esc(t(key))}</span></li>`;
  return `<section class="legend-card" aria-labelledby="legend-title">
    <div class="legend-head">
      <h2 id="legend-title">${esc(t('legend.title'))}</h2>
      <button type="button" class="legend-close" data-action="legend-ok" data-track="legend/ok" aria-label="${esc(t('legend.ok'))}">${icon('close')}</button>
    </div>
    <ul>${[row('s-C', 'restaurant', 'status.C'), row('s-Y', 'restaurant', 'status.Y'), row('s-U', 'restaurant', 'status.U'), row('s-M', 'leaf', 'status.M')].join('')}</ul>
    <button type="button" class="link-btn" data-action="legend-more" data-track="legend/more">${esc(t('legend.more'))}${icon('back', 'chev')}</button>
  </section>`;
}

function dismissLegend() {
  if (storage.get('legendSeen')) return;
  storage.set('legendSeen', true);
  $('.legend-card')?.remove();
  const tipsLi = $('.list-tips');
  if (tipsLi && !tipsLi.children.length) tipsLi.remove();
}

function areaButtons() {
  const l = lang();
  const btn = (a) => `<button type="button" class="chip" data-area="${a.id}">${esc(areaName(a, l))}</button>`;
  return `<div class="areas"><h2 class="areas-title">${esc(t('areas.korea'))}</h2><div class="area-chips">${AREAS.korea.map(btn).join('')}</div><h2 class="areas-title">${esc(
    t('areas.world'),
  )}</h2><div class="area-chips">${AREAS.world.map(btn).join('')}</div></div>`;
}

function render(v) {
  const results = $('#results');
  const notices = [];
  const now = new Date();

  // Restaurants come first: what must be read sits above them, tips follow the
  // first few results, and "find more" closes the list.
  const tips = [];
  const foot = [];
  if (!navigator.onLine) notices.push(noticeHtml({ iconName: 'alert', text: t('list.offline') }));

  // Zoomed out: summary only. Areas served by live Overpass queries (no
  // prebuilt data) need a closer zoom before anything can be listed.
  const live = store.mode === 'live' || (store.hybrid && !isInKorea(v.lat, v.lon));
  const tooFar = v.zoom < DETAIL_ZOOM || (live && v.zoom < LIVE_ZOOM);
  if (tooFar) {
    const n = store.mode === 'static' ? countInView(v.bbox, { sea: showsSea() }) : 0;
    setHeader(t('list.titleArea'), '');
    results.innerHTML = '';
    $('#more').hidden = true;
    $('#list-after').innerHTML = '';
    $('#list-notices').innerHTML =
      notices.join('') +
      `<div class="empty"><strong>${esc(t('list.zoomIn'))}</strong>${n ? `<p>${esc(t('list.zoomInCount', { n }))}</p>` : ''}<button type="button" class="text-btn primary" data-action="zoom-in">${icon(
        'plus',
      )}${esc(t('list.zoomInButton'))}</button></div>` +
      areaButtons();
    return;
  }

  const ref = refPoint(v);
  if (!store.nearStation && isInKorea(v.lat, v.lon)) {
    loadStations().then((ok) => ok && $('#view-detail').hidden && render(getView()));
  }
  const inView = placesIn(padBbox(v.bbox, 0.02));
  const food = inView.filter((p) => p.k !== 'p');
  updateCuisineOptions(food);
  let list = food.filter((p) => passes(p, now));
  if (state.filters.prayer) list = list.concat(inView.filter((p) => p.k === 'p' && inQuery(p)));
  for (const p of list) p._d = distance(ref.lat, ref.lon, p.y, p.x);
  // Halal places first, then vegetarian ones (the fallback), each by distance,
  // so chain branches nearby never push a halal restaurant out of view.
  // Halal places first, then meat-free ones, then seafood restaurants.
  const group = (p) => (p.s === 'S' ? 2 : MEAT_FREE.has(p.s) ? 1 : 0);
  list.sort((a, b) => group(a) - group(b) || a._d - b._d);
  const hiddenU = state.filters.confirmed ? food.filter((p) => p.s === 'U' && passes(p, now, { ignoreConfirmed: true })).length : 0;

  const title = state.query
    ? t('list.titleQuery', { q: state.query.typed })
    : ref.pin
      ? t('list.titleAround', { name: ref.pin.name })
      : t(ref.isUser ? 'list.titleNear' : 'list.titleArea');
  setHeader(title, list.length || !state.loading ? t('list.count', { n: list.length }) : '');

  if (state.query) {
    notices.push(`<div class="notice query">${icon('search')}<div class="notice-body"><p>${esc(t('list.queryNotice'))}</p>
      <button type="button" class="text-btn" data-action="query-clear">${icon('close')}${esc(t('list.queryClear'))}</button>
      <button type="button" class="text-btn" data-action="query-geocode">${icon('pin')}${esc(t('list.queryGeocode'))}</button></div></div>`);
  }
  if (store.mode === 'live' || (store.hybrid && !isInKorea(v.lat, v.lon))) notices.push(noticeHtml({ iconName: 'globe', text: t('list.live') }));
  if (!storage.get('legendSeen')) tips.push(legendHtml());
  if (!state.query && isInKorea(v.lat, v.lon) && !storage.get('guideSeen')) {
    tips.push(
      `<button type="button" class="tip-row" data-action="open-guide">${icon('book')}<span><strong>${esc(t('menu.guide'))}</strong>${esc(t('list.koreaPromo'))}</span>${icon('back', 'chev')}</button>`,
    );
  }
  if (hiddenU) notices.push(noticeHtml({ iconName: 'info', text: t('list.hiddenUnconfirmed', { n: hiddenU }), button: t('list.showUnconfirmed'), buttonAction: 'show-unconfirmed' }));
  if (!state.query && navigator.onLine && v.zoom >= 12) {
    const box = discoveryBox(v);
    if (state.discovering) foot.push(noticeHtml({ iconName: 'search', text: t('search.searching') }));
    else if (hasMoreToDiscover(box)) foot.push(noticeHtml({ iconName: 'globe', text: t('list.discoverHint'), button: t('list.discover'), buttonAction: 'discover' }));
  }

  if (!list.length) {
    if (state.loading) {
      $('#list-notices').innerHTML = notices.join('');
      results.innerHTML = `<li>${skeletonHtml()}</li>`;
      $('#more').hidden = true;
      $('#list-after').innerHTML = '';
      return;
    }
    const nearestBtn = `<button type="button" class="text-btn primary" data-action="nearest">${icon('locate')}${esc(t(state.query ? 'list.queryNearest' : 'list.showNearest'))}</button>`;
    if (state.query && !state.loadError) {
      notices.push(
        `<div class="empty"><strong>${esc(t('list.queryEmpty', { q: state.query.typed }))}</strong>${nearestBtn}${
          filtersActive() ? `<button type="button" class="text-btn" data-action="reset-filters">${esc(t('filter.reset'))}</button>` : ''
        }</div>`,
      );
    } else if (state.loadError) {
      notices.push(`<div class="empty"><strong>${esc(t('list.loadError'))}</strong><button type="button" class="text-btn primary" data-action="retry">${esc(t('list.retry'))}</button></div>`);
    } else if (filtersActive()) {
      notices.push(`<div class="empty"><strong>${esc(t('list.empty'))}</strong><button type="button" class="text-btn primary" data-action="reset-filters">${esc(t('filter.reset'))}</button></div>`);
    } else {
      notices.push(
        `<div class="empty"><strong>${esc(t('list.empty'))}</strong><p>${esc(t('list.emptyHint'))}</p><p>${esc(t('list.emptyMuslimCountries'))}</p>${store.mode === 'static' ? nearestBtn : ''}<button type="button" class="text-btn" data-action="add-place">${icon(
          'plus',
        )}${esc(t('menu.add'))}</button></div>`,
      );
    }
  }
  const shown = list.slice(0, state.limit);
  // Tips go after the third result (after the list when it is shorter, above it when it is empty).
  const tipsAt = Math.min(3, shown.length) - 1;
  const tipsHtml = tips.length ? `<li class="list-tips">${tips.join('')}</li>` : '';
  $('#list-notices').innerHTML = notices.join('');
  results.innerHTML =
    (shown.length ? '' : tipsHtml) +
    shown
      .map((p, i) => {
        const item = listItemHtml(p, { dist: p._d, tz: tzFor(p), selected: p.id === state.selected, station: stationOf(p) });
        const g = group(p);
        const divider = i > 0 && g && g !== group(shown[i - 1]);
        const label = g === 2 ? t('list.seaSection') : t('list.vegSection');
        return `${divider ? `<li class="list-divider${g === 2 ? ' sea' : ''}" aria-hidden="true">${esc(label)}</li>` : ''}${item}${i === tipsAt ? tipsHtml : ''}`;
      })
      .join('');
  $('#more').hidden = list.length <= state.limit;
  $('#list-after').innerHTML = foot.join('');
}

function renderCredits() {
  const parts = ['© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'];
  if (store.index?.sources?.length) parts.push('<a href="https://www.data.go.kr" target="_blank" rel="noopener">data.go.kr</a>');
  $('#credits').innerHTML = `<span>${parts.join(', ')}</span><button type="button" class="text-btn" data-action="about">${icon('info')}${esc(t('menu.about'))}</button>`;
}

function updateMapPlaces() {
  if (!map) return;
  const now = new Date();
  const food = [];
  const prayer = [];
  for (const p of store.places.values()) {
    if (p.k === 'p') {
      if (state.filters.prayer && inQuery(p)) prayer.push(p);
    } else if (passes(p, now)) food.push(p);
  }
  map.setPlaces(food, displayName);
  map.setPrayer(prayer, displayName);
}

let token = 0;
async function refresh({ keepLimit = false } = {}) {
  if (!keepLimit) state.limit = PAGE;
  const my = ++token;
  const v = getView();
  if (store.mode === 'loading') {
    $('#results').innerHTML = `<li>${skeletonHtml()}</li>`;
    return;
  }
  state.loading = true;
  render(v);
  let error = null;
  try {
    await ensureArea(v.bbox, v.zoom, { sea: showsSea() });
    if (state.filters.prayer && v.zoom >= 11 && !isInKorea(v.lat, v.lon)) await ensureLive(v.bbox, 'prayer');
  } catch (err) {
    error = err;
  }
  if (my !== token) return;
  state.loading = false;
  state.loadError = error;
  render(v);
  updateMapPlaces();
  if (state.fitNearest) fitNearest();
}

function discoveryBox({ lat, lon, bbox: [w, s, e, n] }) {
  return [Math.max(w, lon - 0.24, -180), Math.max(s, lat - 0.24, -90), Math.min(e, lon + 0.24, 180), Math.min(n, lat + 0.24, 90)];
}

async function discoverFood(v) {
  if (state.discovering) return;
  state.discovering = true;
  render(v);
  try {
    await ensureLive(discoveryBox(v), 'food', { includeKorea: true });
  } catch {
    toast(t('list.loadError'));
  } finally {
    state.discovering = false;
    await refresh({ keepLimit: true });
  }
}

/** After "Near me": if few places are in view, zoom out to show the closest ones. */
function fitNearest() {
  state.fitNearest = false;
  if (!map || !state.user) return;
  const now = new Date();
  const u = state.user;
  const near = [...store.places.values()]
    .filter((p) => p.k !== 'p' && passes(p, now))
    .map((p) => ({ p, d: distance(u.lat, u.lon, p.y, p.x) }))
    .filter((x) => x.d < 30000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  if (!near.length) return;
  const bbox = map.bounds();
  const visible = near.filter((x) => inBbox(x.p.y, x.p.x, bbox)).length;
  if (visible >= Math.min(3, near.length)) return;
  const lats = [u.lat, ...near.map((x) => x.p.y)];
  const lons = [u.lon, ...near.map((x) => x.p.x)];
  map.map.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: 60, maxZoom: 16, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900 },
  );
}

// ------------------------------------------------------------------ keyword search

/**
 * Show the rows nearest to `ref` on the map: the closest one and whatever lies
 * within 2.5 times its distance (at least 1.2 km), six at most.
 */
function fitRows(rows, ref, { includeRef = false, maxDistance = Infinity } = {}) {
  const near = rows.map((r) => ({ r, d: distance(ref.lat, ref.lon, r.y, r.x) })).sort((a, b) => a.d - b.d);
  if (!near.length) return false;
  if (near[0].d > maxDistance) return true; // too far to jump unasked; the list offers a button
  const limit = Math.max(near[0].d * 2.5, 1200);
  const pick = near.filter((x) => x.d <= limit).slice(0, 6);
  const pts = pick.map((x) => [x.r.x, x.r.y]);
  if (near[0].d < (includeRef ? 30000 : 3000)) pts.push([ref.lon, ref.lat]);
  if (!map) {
    state.view = { lat: pick[0].r.y, lon: pick[0].r.x, zoom: 15 };
    refresh();
  } else if (pts.length === 1) {
    map.flyTo({ lat: pts[0][1], lon: pts[0][0], zoom: 16 });
  } else {
    const lons = pts.map((c) => c[0]);
    const lats = pts.map((c) => c[1]);
    map.map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 70, maxZoom: 16, duration: matchMedia('(prefers-reduced-motion: reduce)').matches || near[0].d > 80000 ? 0 : 900 },
    );
  }
  return true;
}

/**
 * Move the map to the nearest matches of the keyword search (or, without one,
 * the nearest places). Right after a search (`auto`) the map stays put when
 * the nearest match is more than 150 km away.
 */
async function showNearest({ auto = false } = {}) {
  const v = getView();
  const ref = state.searchPin || refPoint(v);
  const all = state.query ? state.query.rows : (await loadSearchCatalog()).filter((r) => r.k !== 'p');
  const rows = all.filter(rowPasses);
  if (!fitRows(rows.length ? rows : all, ref, { includeRef: Boolean(state.searchPin), maxDistance: auto ? 150000 : Infinity })) toast(t('search.noResults'));
}

/** Enter on a keyword ("케밥", "starbucks", "halal" near a station): only the matches stay on the map and in the list. */
function applyQuery({ text, query, matches, loc }) {
  if (!$('#view-detail').hidden) closeDetail();
  state.query = { text, typed: query, rows: matches, ids: new Set(matches.map((m) => m.id)) };
  // Mosques and prayer rooms only show with their own filter.
  if (matches.every((m) => m.k === 'p') && !state.filters.prayer) {
    state.filters.prayer = true;
    renderChips();
  }
  setSearchPin(loc);
  track('search/keyword', { title: text });
  sheet.ensure('half');
  $('#list-scroll').scrollTop = 0;
  showNearest({ auto: true });
  refresh();
}

/** Switch the "Show" choice (from the filter, a search or the guide). */
function setShow(value) {
  state.filters.show = SHOW.includes(value) ? value : 'all';
  storage.set('show', state.filters.show);
  renderChips();
  map?.setSummary(summaryGeoJSON({ sea: showsSea() }));
}

/** "회", "seafood", "명동 초밥": seafood restaurants around that place (or here). */
function applySeafood({ target }) {
  if (!$('#view-detail').hidden) closeDetail();
  clearQuery();
  if (!showsSea()) setShow('sea');
  track('search/seafood');
  sheet.ensure('half');
  $('#list-scroll').scrollTop = 0;
  if (target) moveTo(target);
  else setSearchPin(null);
  refresh();
}

function clearQuery() {
  if (!state.query) return false;
  state.query = null;
  return true;
}

// ------------------------------------------------------------------ detail

function showDetail(p, { push = true, reveal = true } = {}) {
  state.selected = p.id;
  const dist = state.user ? distance(state.user.lat, state.user.lon, p.y, p.x) : NaN;
  const view = $('#view-detail');
  view.innerHTML = `<div class="detail-bar">
      <button type="button" class="icon-btn" data-action="back" aria-label="${esc(t('detail.back'))}">${icon('back', 'ic-flip')}</button>
      <button type="button" class="icon-btn" data-action="share" aria-label="${esc(t('detail.share'))}">${icon('share')}</button>
    </div>
    <div class="panel-scroll">${detailHtml(p, { dist, tz: tzFor(p), near: nearText(stationOf(p)), vote: p.k === 'p' ? '' : voteHtml(p) })}</div>`;
  $('#view-list').hidden = true;
  view.hidden = false;
  view.dataset.id = p.id;
  map?.setSelected(p, displayName(p));
  sheet.ensure('half');
  if (reveal && map) map.reveal({ lat: p.y, lon: p.x }, Math.max(15, map.zoom()));
  else if (reveal) {
    state.view = { lat: p.y, lon: p.x, zoom: 15 };
    refresh();
  }
  if (!reveal || !map) writeHash();
  if (p.k !== 'p') refreshVoteCounts(p);
  if (push) {
    track(p.b ? `view/chain-${p.b}` : `view/${p.k === 'p' ? 'P' : p.s}`);
    history.pushState({ place: p.id }, '', `${location.pathname}${location.search}${hashFor(getView(), p.id)}`);
    state.pushedDetail = true;
  }
  document.title = `${displayName(p)} — Muslimfood`;
  $('#detail-title')?.focus({ preventScroll: true });
}

function closeDetail({ fromPop = false } = {}) {
  if ($('#view-detail').hidden) return;
  const id = state.selected;
  state.selected = null;
  map?.setSelected(null);
  $('#view-detail').hidden = true;
  $('#view-list').hidden = false;
  document.title = t('meta.title');
  if (!fromPop && state.pushedDetail && history.state?.place) {
    state.pushedDetail = false;
    history.back();
  } else writeHash();
  render(getView());
  const item = id && $(`#results [data-id="${CSS.escape(id)}"]`);
  item?.focus({ preventScroll: false });
}

async function openPlaceById(id, hint) {
  const p = getPlace(id) || (await findPlace(id, hint));
  if (!p) {
    toast(t('detail.notFound'));
    return;
  }
  showDetail(p);
}

async function sharePlace(p) {
  const url = `${location.origin}${location.pathname}${hashFor({ zoom: 17, lat: p.y, lon: p.x }, p.id)}`;
  const title = displayName(p);
  if (navigator.share) {
    try {
      await navigator.share({ title, text: `${title} — Muslimfood`, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  if (await copyText(url)) toast(t('detail.linkCopied'));
}

// ------------------------------------------------------------------ location

function locate({ auto = false } = {}) {
  if (!('geolocation' in navigator)) {
    if (!auto) toast(t('locate.unavailable'));
    return;
  }
  const btn = $('#locate');
  if (!auto) track('locate');
  btn.setAttribute('aria-busy', 'true');
  if (!auto) toast(t('locate.locating'), { duration: 0 });
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.removeAttribute('aria-busy');
      $('#toast').hidden = true;
      state.user = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      map?.setUser(state.user);
      watchUser();
      state.fitNearest = true;
      if ($('#view-detail').hidden === false) closeDetail();
      moveTo({ lat: state.user.lat, lon: state.user.lon, zoom: 15, marker: null });
      if (!map) refresh();
    },
    (err) => {
      btn.removeAttribute('aria-busy');
      if (auto) return;
      toast(err.code === 1 ? t('locate.denied') : t('locate.unavailable'), { duration: 6000 });
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

// After the first fix the blue dot follows the visitor (while the page is
// visible); the map itself only moves when "Near me" is pressed.
let watchId = null;
function watchUser() {
  if (watchId !== null || !navigator.geolocation?.watchPosition || document.visibilityState !== 'visible') return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const prev = state.user;
      state.user = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      map?.setUser(state.user);
      // Re-sort the list once the visitor has walked a little.
      if (prev && distance(prev.lat, prev.lon, state.user.lat, state.user.lon) > 25 && $('#view-detail').hidden) render(getView());
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  );
}

function pauseWatch() {
  if (watchId === null) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

async function maybeAutoLocate() {
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') locate({ auto: true });
  } catch {
    /* Permissions API unsupported */
  }
}

// ------------------------------------------------------------------ theme & language

function effectiveTheme() {
  if (state.theme === 'light' || state.theme === 'dark') return state.theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(choice) {
  state.theme = choice;
  storage.set('theme', choice);
  if (choice === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  map?.setTheme(effectiveTheme());
}

function applyMeta() {
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
}

async function switchLang(l) {
  storage.set('lang', l);
  track(`lang/${l}`);
  await setLang(l);
  applyDom();
  applyMeta();
  renderChips();
  renderCredits();
  map?.setLang(l);
  updateMapPlaces();
  if (new URLSearchParams(location.search).has('lang')) {
    const u = new URL(location.href);
    u.searchParams.delete('lang');
    history.replaceState(history.state, '', u);
  }
  if (state.selected && getPlace(state.selected)) showDetail(getPlace(state.selected), { push: false, reveal: false });
  render(getView());
  openMenu();
}

function openOwnerForm() {
  renderOwnerForm(getView());
  document.querySelector('dialog[open]')?.close();
  openDialog($('#owner'));
  track('owner-form/open', { once: true });
}

function openMenu() {
  renderMenu({
    theme: state.theme,
    onLang: switchLang,
    onTheme: applyTheme,
    onGuide: (tab) => openGuide(tab, getView()),
    onAbout: (section) => {
      renderAbout(getView());
      openDialog($('#about'));
      if (section === 'add') $('#about-add')?.scrollIntoView();
    },
    onAdd: openOwnerForm,
    installAvailable: Boolean(deferredInstall),
    onInstall: async () => {
      track('install');
      deferredInstall?.prompt();
      deferredInstall = null;
    },
  });
  const menu = $('#menu');
  if (!menu.open) openDialog(menu);
}

// ------------------------------------------------------------------ map

async function initMap(start) {
  const mv = new MapView($('#map'), {
    center: { lat: start.lat, lon: start.lon },
    zoom: start.zoom,
    theme: effectiveTheme(),
    lang: lang(),
    labels: { zoomIn: t('map.zoomIn'), zoomOut: t('map.zoomOut') },
  });
  mv.on('move', () => {
    if (!map) return;
    writeHash();
    refresh();
  });
  mv.on('select', (id) => openPlaceById(id));
  mv.on('hover', (id) => {
    for (const el of document.querySelectorAll('#results .place.is-hover')) el.classList.remove('is-hover');
    if (id) $(`#results .place[data-id="${CSS.escape(id)}"]`)?.classList.add('is-hover');
  });
  try {
    await mv.init();
    map = mv;
    $('#map-status')?.remove();
    map.setSummary(summaryGeoJSON({ sea: showsSea() }));
    applySheetToMap(lastSheet);
    if (state.user) map.setUser(state.user);
    if (state.selected) {
      const p = getPlace(state.selected);
      if (p) {
        map.setSelected(p, displayName(p));
        map.reveal({ lat: p.y, lon: p.x }, Math.max(15, map.zoom()));
      }
    } else if (state.view.lat !== start.lat || state.view.lon !== start.lon || state.view.zoom !== start.zoom) {
      moveTo({ ...state.view, marker: state.searchPin });
    } else if (state.searchPin) {
      map.setSearchPin(state.searchPin);
    }
    updateMapPlaces();
    refresh({ keepLimit: true });
  } catch (err) {
    console.error('Map unavailable:', err);
    const s = $('#map-status');
    if (s) s.textContent = t('map.error');
  }
}

let lastSheet = { visible: 0, wide: true };
function applySheetToMap(info) {
  lastSheet = info;
  if (!map) return;
  map.setPadding(info.wide ? { top: 0, bottom: 0, left: 0, right: 0 } : { top: 64, bottom: Math.min(info.visible, innerHeight * 0.6), left: 0, right: 0 });
}

// ------------------------------------------------------------------ events

function bindEvents() {
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    const key = b.dataset.filter;
    const f = state.filters;
    if (key === 'confirmed') f.confirmed = !f.confirmed;
    else if (key === 'open') f.open = !f.open;
    else if (key === 'prayer') f.prayer = !f.prayer;
    else if (key.startsWith('cat-')) {
      const k = key.slice(4);
      f.cats.has(k) ? f.cats.delete(k) : f.cats.add(k);
    }
    track(`filter/${key}`);
    b.setAttribute('aria-pressed', String(key === 'confirmed' ? f.confirmed : key === 'open' ? f.open : key === 'prayer' ? f.prayer : f.cats.has(key.slice(4))));
    refresh();
  });
  $('#chips').addEventListener('change', (e) => {
    if (e.target.id === 'cuisine-select') {
      state.filters.cuisine = e.target.value;
      track('filter/cuisine', { title: e.target.value });
      refresh();
    } else if (e.target.id === 'show-select') {
      state.filters.show = SHOW.includes(e.target.value) ? e.target.value : 'all';
      storage.set('show', state.filters.show);
      track(`filter/show-${state.filters.show}`);
      const chipEl = e.target.closest('.chip');
      chipEl.dataset.active = String(state.filters.show !== 'all');
      chipEl.querySelector('.ic').outerHTML = icon(SHOW_ICON[state.filters.show]);
      map?.setSummary(summaryGeoJSON({ sea: showsSea() }));
      refresh();
    }
  });

  $('#results').addEventListener('click', (e) => {
    const b = e.target.closest('.place');
    if (b) {
      const p = getPlace(b.dataset.id);
      if (p) showDetail(p);
    }
  });

  const onAction = (e) => {
    const b = e.target.closest('[data-action], [data-area]');
    if (!b) return;
    if (b.dataset.area) {
      const a = [...AREAS.korea, ...AREAS.world].find((x) => x.id === b.dataset.area);
      if (a) moveTo({ lat: a.y, lon: a.x, zoom: a.z });
      return;
    }
    const v = getView();
    switch (b.dataset.action) {
      case 'nearest':
        showNearest();
        break;
      case 'query-clear':
        clearQuery();
        setSearchPin(null);
        search.setText('');
        refresh();
        break;
      case 'query-geocode': {
        const typed = state.query.typed;
        clearQuery();
        refresh();
        search.geocode(typed);
        break;
      }
      case 'legend-ok':
        dismissLegend();
        break;
      case 'legend-more':
        dismissLegend();
        openGuide('levels', v);
        break;
      case 'open-guide':
        openGuide('food', v);
        render(v);
        break;
      case 'show-unconfirmed':
        state.filters.confirmed = false;
        renderChips();
        refresh();
        break;
      case 'reset-filters':
        state.filters = { ...state.filters, show: 'all', confirmed: false, open: false, cuisine: '', cats: new Set() };
        storage.set('show', 'all');
        renderChips();
        refresh();
        break;
      case 'zoom-in':
        moveTo({ lat: v.lat, lon: v.lon, zoom: Math.max(v.zoom + 3, DETAIL_ZOOM + 2) });
        break;
      case 'retry':
        refresh();
        break;
      case 'discover':
        discoverFood(v);
        break;
      case 'add-place':
        openOwnerForm();
        break;
      case 'about':
        renderAbout(v);
        openDialog($('#about'));
        break;
      default:
        break;
    }
  };
  $('#list-notices').addEventListener('click', onAction);
  $('#results').addEventListener('click', onAction);
  $('#list-after').addEventListener('click', onAction);
  $('#credits').addEventListener('click', onAction);
  $('#about-body').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="owner-form"]')) openOwnerForm();
  });

  $('#more').addEventListener('click', () => {
    state.limit += PAGE;
    render(getView());
  });

  $('#view-detail').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const p = getPlace($('#view-detail').dataset.id);
    if (!p) return;
    if (handleVoteAction(b.dataset.action, p)) return;
    if (b.dataset.action === 'back') closeDetail();
    else if (b.dataset.action === 'share') sharePlace(p);
    else if (b.dataset.action === 'copy-address') {
      if (await copyText(p.a)) toast(t('detail.addressCopied'));
    } else if (b.dataset.action === 'staff-card') openGuide('card', { lat: p.y, lon: p.x });
  });

  // Desktop: pointing at a row shows where it is on the map, and the other way round.
  if (matchMedia('(hover: hover)').matches) {
    const hoverRow = (e) => {
      const row = e.target.closest?.('.place');
      const p = row && getPlace(row.dataset.id);
      map?.setHover(p && p.id !== state.selected ? p : null, p ? displayName(p) : '');
    };
    $('#results').addEventListener('mouseover', hoverRow);
    $('#results').addEventListener('focusin', hoverRow);
    $('#results').addEventListener('mouseleave', () => map?.setHover(null));
    $('#results').addEventListener('focusout', () => map?.setHover(null));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') pauseWatch();
    else if (state.user) watchUser();
  });

  $('#locate').addEventListener('click', () => locate());
  $('#menu-btn').addEventListener('click', openMenu);
  $('#legend-btn').addEventListener('click', () => {
    dismissLegend();
    openGuide('levels', getView());
  });

  addEventListener('keydown', (e) => {
    // "/" jumps to the search box, as on most map sites.
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      $('#q').focus();
      $('#q').select();
      return;
    }
    if (e.key === 'Escape' && !$('#view-detail').hidden && !document.querySelector('dialog[open]') && $('#bigtext').hidden) closeDetail();
  });

  addEventListener('popstate', (e) => {
    if (hideBig()) return;
    const id = e.state?.place;
    if (id && getPlace(id)) showDetail(getPlace(id), { push: false });
    else {
      state.pushedDetail = false;
      closeDetail({ fromPop: true });
    }
  });

  addEventListener('online', () => {
    toast(t('toast.online'));
    refresh();
  });
  addEventListener('offline', () => toast(t('toast.offline')));

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (state.theme === 'auto') map?.setTheme(effectiveTheme());
  });

  // Refresh "open now" labels every minute.
  setInterval(() => {
    if (document.visibilityState === 'visible' && $('#view-detail').hidden) render(getView());
  }, 60000);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) return;
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      swReg = reg;
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast(t('toast.update'), { action: t('toast.reload'), onAction: () => w.postMessage('skipWaiting'), duration: 0 });
          }
        });
      });
    })
    .catch((err) => console.warn('Service worker not registered', err));
  // Reload only when a new version replaces the one this page runs on (after
  // "Reload" in the update toast). On a first visit the worker takes control
  // of an uncontrolled page; reloading then would wipe what the visitor typed.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}

// ------------------------------------------------------------------ boot

async function boot() {
  await setLang(detectLang());
  applyDom();
  applyMeta();
  initTracking();
  trackPageview();
  if (state.theme !== 'auto') applyTheme(state.theme);

  const start = startView();
  state.view = { lat: start.lat, lon: start.lon, zoom: start.zoom };

  renderChips();
  sheet = new Sheet(panel, {
    app,
    grip: $('#panel-grip'),
    dragAreas: [$('.list-heading')],
    onChange: applySheetToMap,
  });
  sheet.snap('half', false);

  search = initSearch({
    form: $('#search'),
    input: $('#q'),
    clearBtn: $('#q-clear'),
    box: $('#search-results'),
    getCenter: () => getView(),
    onArea: (a) => {
      track('search/area');
      clearQuery();
      if (!$('#view-detail').hidden) closeDetail();
      $('#list-scroll').scrollTop = 0;
      moveTo(a);
      sheet.ensure('half');
      if (!map) return;
      refresh(); // the view may not change (already there), but the pin and title do
    },
    onPlace: async (p, signal) => {
      setSearchPin(null); // the place itself is highlighted
      clearQuery();
      track('search/place');
      await indexReady;
      const place = await findPlace(p.id, { lat: p.y, lon: p.x });
      if (signal.aborted) return;
      if (place) showDetail(place);
      else toast(t('detail.notFound'));
    },
    onNoResults: (q) => track('search/none', { title: q }),
    onKeyword: applyQuery,
    onSeafood: applySeafood,
    onClear: () => {
      const had = clearQuery();
      if (!had && !state.searchPin) return;
      setSearchPin(null);
      refresh();
    },
  });
  initDialogs();
  initGuide(() => getView(), {
    onShow: (value) => {
      if (!$('#view-detail').hidden) closeDetail();
      setShow(value);
      sheet.ensure('half');
      refresh();
    },
  });
  initBig();
  bindEvents();

  $('#results').innerHTML = `<li>${skeletonHtml()}</li>`;
  initMap(start);
  await indexReady;
  renderCredits();
  map?.setSummary(summaryGeoJSON({ sea: showsSea() }));
  await refresh();

  const params = new URLSearchParams(location.search);
  if (start.place) {
    await openPlaceById(start.place, start);
    history.replaceState({ place: start.place }, '', location.href);
  } else if (params.has('locate')) {
    locate();
  } else if (!start.fromHash) {
    maybeAutoLocate();
  }
  // App shortcuts: ?guide=food|card|phrases|levels
  if (params.get('guide')) openGuide(params.get('guide'), getView());
  if (params.has('locate') || params.has('guide')) {
    const u = new URL(location.href);
    u.searchParams.delete('locate');
    u.searchParams.delete('guide');
    history.replaceState(history.state, '', u);
  }
  registerServiceWorker();
}

boot().catch((err) => {
  console.error(err);
  toast('Something went wrong while starting the app. Please reload.', { duration: 0 });
});
