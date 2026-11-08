// Search box: instant local matches (area shortcuts + loaded restaurants) and,
// on explicit request only (per the Nominatim usage policy), a worldwide
// geocoder search with Photon as fallback.

import { AREAS, areaName } from './content.js';
import { t, lang } from './i18n.js';
import { normText, matchesQuery, esc } from '../core/text.js';
import { distance } from '../core/geo.js';
import { store, loadSearchCatalog } from './store.js';
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

export function initSearch({ form, input, clearBtn, box, getCenter, onArea, onPlace }) {
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

  function localMatches(q) {
    const nq = normText(q);
    const areas = [];
    for (const region of ['korea', 'world']) {
      for (const a of AREAS[region]) {
        if (Object.values(a.n).some((n) => matchesQuery({ n }, q))) areas.push({ kind: 'area', area: a });
      }
    }
    const c = getCenter();
    const places = [];
    const seen = new Set();
    for (const p of [...store.places.values(), ...catalog]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (p.k === 'p' && !p.n) continue;
      if (matchesQuery(p, q)) {
        const exact = [p.n, ...Object.values(p.nl || {})].some((n) => normText(n) === nq);
        places.push({ kind: 'place', place: p, exact, d: distance(c.lat, c.lon, p.y, p.x) });
      }
    }
    places.sort((a, b) => Number(b.exact) - Number(a.exact) || a.d - b.d);
    return { areas: areas.slice(0, 5), places: places.slice(0, 8) };
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
        if (o.kind === 'area') {
          html += push(o, `${icon('pin')}<span><span class="sr-main">${esc(areaName(o.area, lang()))}</span>${
            lang() !== 'ko' && o.area.n.ko ? `<span class="sr-sub">${esc(o.area.n.ko)}</span>` : ''
          }</span>`);
        } else {
          html += push(o, `${icon('pin')}<span><span class="sr-main">${esc(o.geo.name)}</span><span class="sr-sub">${esc(o.geo.sub)}</span></span>`);
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
      html += push({ kind: groups.geocode ? 'geoSearch' : 'go' }, `${icon('search')}<span class="sr-main">${esc(t('search.go', { q: groups.go }))}</span>`);
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

  async function runSearch() {
    const q = input.value.trim();
    if (!normText(q)) return;
    update.cancel();
    ctrl?.abort();
    const request = new AbortController();
    ctrl = request;
    render(localMatches(q), t('search.searching'));
    catalog = await loadSearchCatalog();
    if (request.signal.aborted || q !== input.value.trim()) return;
    ctrl = null;
    const local = localMatches(q);
    const exact = local.places.filter((o) => o.exact);
    if (exact.length === 1 && !local.areas.length) {
      render({ places: exact });
      return choose(0);
    }
    if (!local.areas.length && !local.places.length) return runGeocode();
    render({ ...local, go: q, geocode: true });
    // Restaurant matches are the default after submit, even when an area matches too.
    setActive(local.places.length ? local.areas.length : 0);
  }

  async function runGeocode() {
    const q = input.value.trim();
    if (!q) return;
    update.cancel();
    ctrl?.abort();
    const request = new AbortController();
    ctrl = request;
    const local = localMatches(q);
    render({ places: local.places }, t('search.searching'));
    try {
      const results = await geocode(q, request.signal);
      if (request.signal.aborted || q !== input.value.trim()) return;
      const areas = [...local.areas, ...results.filter(({ lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon)).map((geo) => ({ kind: 'geo', geo }))];
      if (!areas.length && !local.places.length) render({}, t('search.noResults'));
      else render({ areas, places: local.places });
      setActive(0);
    } catch (err) {
      if (!request.signal.aborted && q === input.value.trim()) render(local, t('search.error'));
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
    if (o.kind === 'geoSearch') return runGeocode();
    close();
    input.blur();
    if (o.kind === 'area') {
      input.value = areaName(o.area, lang());
      onArea({ lat: o.area.y, lon: o.area.x, zoom: o.area.z });
    } else if (o.kind === 'geo') {
      input.value = o.geo.name;
      const zoom = o.geo.rank >= 28 ? 17 : o.geo.rank >= 22 ? 15.5 : o.geo.rank >= 16 ? 13 : 11;
      onArea({ lat: o.geo.lat, lon: o.geo.lon, zoom, bbox: o.geo.rank < 26 ? o.geo.bbox : null, marker: o.geo.rank >= 28 ? o.geo : null });
    } else if (o.kind === 'place') {
      input.value = displayName(o.place);
      const request = new AbortController();
      ctrl = request;
      Promise.resolve(onPlace(o.place, request.signal)).finally(() => {
        if (ctrl === request) ctrl = null;
      });
    }
    clearBtn.hidden = !input.value;
  }

  input.addEventListener('input', () => {
    close();
    clearBtn.hidden = !input.value.trim();
    update();
  });
  input.addEventListener('focus', () => input.value.trim() && update());
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
    input.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!form.contains(e.target)) close();
  });
  return { close };
}
