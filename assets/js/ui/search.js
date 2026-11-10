// Search box. While typing: instant local matches (area shortcuts, Korean
// stations, restaurants). On Enter the map moves at once (core/searchplan.js):
// to an area or station, to one restaurant, or to every match of a keyword.
// Only when nothing local matches is the worldwide geocoder asked (on explicit
// submit only, per the Nominatim usage policy), with Photon as fallback.

import { AREAS, areaName } from './content.js';
import { t, lang } from './i18n.js';
import { normText, matchesQuery, esc } from '../core/text.js';
import { findLocations, planSearch } from '../core/searchplan.js';
import { distance } from '../core/geo.js';
import { store, loadSearchCatalog, loadStations } from './store.js';
import { icon } from './icons.js';
import { displayName, altName, statusLabel } from './render.js';
import { debounce } from './util.js';

async function geocode(q, signal) {
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '6', 'accept-language': lang() });
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = await r.json();
    return list.map((x) => ({
      name: x.name || x.display_name.split(',')[0],
      sub: x.display_name,
      lat: +x.lat,
      lon: +x.lon,
      rank: x.place_rank,
      bbox: x.boundingbox ? [+x.boundingbox[2], +x.boundingbox[0], +x.boundingbox[3], +x.boundingbox[1]] : null,
    }));
  } catch (err) {
    if (signal?.aborted) throw err;
    const r = await fetch(`https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: '6' })}`, { signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return (j.features || []).map((f) => {
      const p = f.properties || {};
      const ext = p.extent;
      return {
        name: p.name || p.street || '',
        sub: [p.city, p.state, p.country].filter(Boolean).join(', '),
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        rank: p.type === 'house' ? 30 : p.type === 'street' ? 26 : p.type === 'city' ? 16 : 20,
        bbox: ext ? [ext[0], ext[3], ext[2], ext[1]] : null,
      };
    });
  }
}

const ALL_AREAS = [...AREAS.korea, ...AREAS.world];

/** "강남역" / "Gangnam Station" for a station row. */
export function stationLabel(st) {
  return lang() === 'ko' || !st.en ? `${st.ko}역` : t('search.stationName', { station: st.en });
}

export function initSearch({ form, input, clearBtn, box, getCenter, onArea, onPlace, onKeyword = () => {}, onClear = () => {}, onNoResults = () => {} }) {
  let options = [];
  let active = -1;
  let ctrl = null;
  let catalog = [];

  const close = () => {
    update.cancel();
    ctrl?.abort();
    ctrl = null;
    box.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const open = () => {
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  /** Every named place we know: loaded cells first, then the search catalog. */
  function* allPlaces() {
    const seen = new Set();
    for (const p of store.places.values()) {
      seen.add(p.id);
      if (p.n) yield p;
    }
    for (const p of catalog) if (!seen.has(p.id)) yield p;
  }

  function localMatches(q) {
    const nq = normText(q);
    const c = getCenter();
    const found = findLocations(q, ALL_AREAS, store.stations, { center: c });
    const areas = [...found.exact, ...found.partial].slice(0, 6).map((loc) => ({ kind: 'loc', loc }));
    const places = [];
    for (const p of allPlaces()) {
      if (matchesQuery(p, q)) {
        const exact = [p.n, ...Object.values(p.nl || {})].some((n) => normText(n) === nq);
        places.push({ kind: 'place', place: p, exact, d: distance(c.lat, c.lon, p.y, p.x) });
      }
    }
    places.sort((a, b) => Number(b.exact) - Number(a.exact) || a.d - b.d);
    return { areas, places: places.slice(0, 8) };
  }

  function render(groups, note) {
    active = -1;
    input.removeAttribute('aria-activedescendant');
    options = [];
    let html = '';
    const push = (opt, inner) => {
      const i = options.length;
      options.push(opt);
      return `<button type="button" class="sr-item" role="option" id="sr-${i}" data-i="${i}" aria-selected="false">${inner}</button>`;
    };
    if (groups.areas?.length) {
      html += `<div class="sr-group" role="presentation">${esc(t('search.areas'))}</div>`;
      for (const o of groups.areas) {
        if (o.kind === 'geo') {
          html += push(o, `${icon('pin')}<span><span class="sr-main">${esc(o.geo.name)}</span><span class="sr-sub">${esc(o.geo.sub)}</span></span>`);
        } else if (o.loc.kind === 'area') {
          const a = o.loc.area;
          html += push(o, `${icon('pin')}<span><span class="sr-main">${esc(areaName(a, lang()))}</span>${
            lang() !== 'ko' && a.n.ko ? `<span class="sr-sub">${esc(a.n.ko)}</span>` : ''
          }</span>`);
        } else {
          const st = o.loc;
          const other = lang() === 'ko' ? st.en : `${st.ko}역`;
          html += push(o, `${icon('train')}<span><span class="sr-main">${esc(stationLabel(st))}</span>${other ? `<span class="sr-sub">${esc(other)}</span>` : ''}</span>`);
        }
      }
    }
    if (groups.places?.length) {
      html += `<div class="sr-group" role="presentation">${esc(t('search.places'))}</div>`;
      for (const o of groups.places) {
        const alt = altName(o.place);
        html += push(o, `${icon('restaurant')}<span><span class="sr-main">${esc(displayName(o.place))}</span><span class="sr-sub">${esc(
          [statusLabel(o.place), alt || o.place.a].filter(Boolean).join(' — '),
        )}</span></span>`);
      }
    }
    if (groups.go) {
      html += push({ kind: 'go' }, `${icon('search')}<span class="sr-main">${esc(t('search.go', { q: groups.go }))}</span>`);
    }
    if (note) html += `<p class="sr-note">${esc(note)}</p>`;
    box.innerHTML = html;
    if (html) open();
    else close();
  }

  const update = debounce(() => {
    if (document.activeElement !== input || (ctrl && !ctrl.signal.aborted)) return;
    const q = input.value.trim();
    clearBtn.hidden = !q;
    if (!q || !normText(q)) return close();
    const m = localMatches(q);
    render({ ...m, go: q });
  }, 120);

  /** Marker and view for an area preset or a station. */
  function locTarget(loc) {
    if (loc.kind === 'area') {
      const name = areaName(loc.area, lang());
      return { lat: loc.area.y, lon: loc.area.x, zoom: loc.area.z, marker: { lat: loc.area.y, lon: loc.area.x, name } };
    }
    return { lat: loc.y, lon: loc.x, zoom: 16, marker: { lat: loc.y, lon: loc.x, name: stationLabel(loc) } };
  }

  function goLocation(loc) {
    const target = locTarget(loc);
    close();
    input.blur();
    input.value = target.marker.name;
    clearBtn.hidden = false;
    onArea(target);
  }

  function goGeo(geo, { keepOpen = false } = {}) {
    const zoom = geo.rank >= 28 ? 17 : geo.rank >= 22 ? 15.5 : geo.rank >= 16 ? 13 : 11;
    if (!keepOpen) {
      close();
      input.blur();
      input.value = geo.name;
    }
    clearBtn.hidden = !input.value;
    // Every searched spot gets a labelled pin, so it is clear where "here" is.
    onArea({ lat: geo.lat, lon: geo.lon, zoom, bbox: geo.rank < 26 ? geo.bbox : null, marker: { lat: geo.lat, lon: geo.lon, name: geo.name } });
  }

  function openPlace(place) {
    close();
    input.blur();
    input.value = displayName(place);
    clearBtn.hidden = false;
    const request = new AbortController();
    ctrl = request;
    Promise.resolve(onPlace(place, request.signal)).finally(() => {
      if (ctrl === request) ctrl = null;
    });
  }

  /** Enter: move the map to the best answer straight away. */
  async function runSearch() {
    const q = input.value.trim();
    if (!normText(q)) return;
    update.cancel();
    ctrl?.abort();
    const request = new AbortController();
    ctrl = request;
    render(localMatches(q), t('search.searching'));
    [catalog] = await Promise.all([loadSearchCatalog(), loadStations()]);
    if (request.signal.aborted || q !== input.value.trim()) return;
    ctrl = null;
    const plan = planSearch(q, { areas: ALL_AREAS, stations: store.stations, places: [...allPlaces()], center: getCenter() });
    if (plan.kind === 'location') return goLocation(plan.loc);
    if (plan.kind === 'place') return openPlace(plan.place);
    if (plan.kind === 'keyword') {
      close();
      input.blur();
      clearBtn.hidden = false;
      return onKeyword({ text: plan.text, query: q, matches: plan.matches, loc: plan.loc ? locTarget(plan.loc).marker : null });
    }
    return runGeocode({ fallback: plan.fallback });
  }

  /** Ask the geocoder; the map moves to the first hit and the others stay listed. */
  async function runGeocode({ fallback = null, query = null } = {}) {
    if (query !== null) input.value = query;
    const q = input.value.trim();
    if (!q) return;
    clearBtn.hidden = false;
    update.cancel();
    ctrl?.abort();
    const request = new AbortController();
    ctrl = request;
    render({}, t('search.searching'));
    try {
      const results = (await geocode(q, request.signal)).filter(({ lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon));
      if (request.signal.aborted || q !== input.value.trim()) return;
      if (!results.length) {
        if (fallback) return goLocation(fallback);
        render({}, t('search.noResults'));
        onNoResults(q);
        return;
      }
      if (results.length === 1) return goGeo(results[0]);
      render({ areas: results.map((geo) => ({ kind: 'geo', geo })) });
      setActive(0);
      goGeo(results[0], { keepOpen: true });
    } catch (err) {
      if (request.signal.aborted || q !== input.value.trim()) return;
      if (fallback) return goLocation(fallback);
      render({}, t('search.error'));
    } finally {
      if (ctrl === request) ctrl = null;
    }
  }

  function setActive(i) {
    const items = box.querySelectorAll('.sr-item');
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach((el, j) => el.setAttribute('aria-selected', String(j === active)));
    input.setAttribute('aria-activedescendant', `sr-${active}`);
    items[active].scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'go') return runSearch();
    if (o.kind === 'loc') return goLocation(o.loc);
    if (o.kind === 'geo') return goGeo(o.geo);
    if (o.kind === 'place') return openPlace(o.place);
  }

  input.addEventListener('input', () => {
    close();
    clearBtn.hidden = !input.value.trim();
    update();
  });
  input.addEventListener('focus', () => {
    loadStations(); // station names for the suggestions (small, cached)
    if (input.value.trim()) update();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (box.hidden) update();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (active >= 0 && !box.hidden) choose(active);
    else runSearch();
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.sr-item');
    if (b) choose(+b.dataset.i);
  });
  box.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    close();
    onClear();
    input.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!form.contains(e.target)) close();
  });
  return {
    close,
    /** Look a text up as an address or place name (from the keyword results notice). */
    geocode: (query) => runGeocode({ query }),
    /** Set or empty the box without searching. */
    setText: (text) => {
      input.value = text;
      clearBtn.hidden = !text;
    },
  };
}
