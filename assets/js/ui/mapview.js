// MapLibre GL wrapper: vector map (OpenFreeMap), canvas-drawn markers whose
// colour/outline encodes the halal level and whose glyph encodes the place type.

import { loadScript, loadStyle } from './util.js';
import { ICON_PATHS, CATEGORY_ICON } from './icons.js';
import { STATUS_ORDER } from '../core/normalize.js';
import { DETAIL_ZOOM } from './store.js';

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const FALLBACK_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

// Marker palette (kept in sync with CSS tokens).
const PIN = {
  C: { fill: '#1E7B4F', glyph: '#FFFFFF', seal: true },
  O: { fill: '#1E7B4F', glyph: '#FFFFFF' },
  Y: { fill: '#1E7B4F', glyph: '#FFFFFF' },
  F: { fill: '#138D90', glyph: '#FFFFFF' },
  L: { fill: '#D99A1C', glyph: '#14233F' },
  U: { fill: '#FFFFFF', glyph: '#5E6573', ring: '#7A808C', dashed: true },
  // Meat-free alternatives: a rounded square with a leaf, so they never read as halal.
  V: { fill: '#4B8A2B', glyph: '#FFFFFF', square: true, icon: 'leaf' },
  M: { fill: '#FFFFFF', glyph: '#3F7A22', ring: '#4B8A2B', square: true, icon: 'leaf' },
  P: { fill: '#2346A0', glyph: '#FFFFFF' },
};

/** Circle, or rounded square for meat-free places. */
function shapePath(ctx, cx, cy, r, square) {
  ctx.beginPath();
  if (!square) {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    return;
  }
  const s = r * 0.9;
  const rad = r * 0.38;
  ctx.moveTo(cx - s + rad, cy - s);
  ctx.arcTo(cx + s, cy - s, cx + s, cy + s, rad);
  ctx.arcTo(cx + s, cy + s, cx - s, cy + s, rad);
  ctx.arcTo(cx - s, cy + s, cx - s, cy - s, rad);
  ctx.arcTo(cx - s, cy - s, cx + s, cy - s, rad);
  ctx.closePath();
}

const EMPTY = { type: 'FeatureCollection', features: [] };

const IS_VEG = ['in', ['get', 's'], ['literal', ['V', 'M']]];
// Names of halal places from zoom 13.5, every name from zoom 15.
const LABEL_FILTER = ['all', ['!', ['has', 'point_count']], ['any', ['>=', ['zoom'], 15], ['!', IS_VEG]]];

/** Radius of the accuracy circle at zoom 0, in pixels (shown when the fix is vaguer than 30 m). */
function accuracyProps(pos) {
  const acc = Number(pos.acc);
  if (!(acc > 30)) return {};
  const metresPerPixel = 78271.517 * Math.cos((pos.lat * Math.PI) / 180);
  return { r0: Math.min(acc, 3000) / metresPerPixel };
}

const LIB_JS = 'assets/vendor/maplibre-gl/maplibre-gl.js';
const LIB_CSS = 'assets/vendor/maplibre-gl/maplibre-gl.css';

/** Start downloading MapLibre early; init() reuses the same promise. */
export function preloadMapLibrary() {
  if (!webglSupported()) return Promise.resolve(false);
  loadStyle(LIB_CSS);
  return loadScript(LIB_JS).then(
    () => true,
    () => false,
  );
}

function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function drawPin(id) {
  // id = pin-<status>-<category>[-sel]
  const [, s, k, sel] = id.split('-');
  const st = PIN[s] || PIN.U;
  const ratio = 2;
  const size = sel ? 46 : 32;
  const c = document.createElement('canvas');
  c.width = c.height = size * ratio;
  const ctx = c.getContext('2d');
  ctx.scale(ratio, ratio);
  const cx = size / 2;
  const r = sel ? 15 : 12;
  const sq = Boolean(st.square);
  if (sel) {
    shapePath(ctx, cx, cx, r + 6, sq);
    ctx.fillStyle = 'rgba(35, 70, 160, 0.22)';
    ctx.fill();
  }
  // soft shadow
  shapePath(ctx, cx, cx + 1.2, r + 1, sq);
  ctx.fillStyle = 'rgba(20, 35, 63, 0.28)';
  ctx.fill();
  // white rim
  shapePath(ctx, cx, cx, r + 1.5, sq);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  // body
  shapePath(ctx, cx, cx, r, sq);
  ctx.fillStyle = st.fill;
  ctx.fill();
  if (st.ring) {
    ctx.setLineDash(st.dashed ? [3.2, 2.4] : []);
    ctx.lineWidth = sq ? 2.4 : 2;
    ctx.strokeStyle = st.ring;
    shapePath(ctx, cx, cx, r - 1, sq);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // glyph
  const path = new Path2D(ICON_PATHS[st.icon || CATEGORY_ICON[k]] || ICON_PATHS.other);
  const g = r * 1.18;
  ctx.save();
  ctx.translate(cx - g / 2, cx - g / 2);
  ctx.scale(g / 24, g / 24);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = st.glyph;
  ctx.stroke(path);
  ctx.restore();
  // certificate seal
  if (st.seal) {
    const sx = cx + r * 0.72;
    const sy = cx - r * 0.72;
    ctx.beginPath();
    ctx.arc(sx, sy, 5.2, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#D99A1C';
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(sx - 1.8, sy + 0.1);
    ctx.lineTo(sx - 0.4, sy + 1.4);
    ctx.lineTo(sx + 1.9, sy - 1.3);
    ctx.stroke();
  }
  return { img: ctx.getImageData(0, 0, c.width, c.height), ratio };
}

function drawCluster(id) {
  // id = cl-<label>-<g|v|u|s>: halal / vegetarian only (square, like its markers) / unconfirmed / summary
  const parts = id.split('-');
  const kind = parts.pop();
  const label = parts.slice(1).join('-');
  const ratio = 2;
  const n = label.length;
  const r = n <= 1 ? 15 : n === 2 ? 17 : n === 3 ? 20 : 23;
  const size = (r + 5) * 2;
  const c = document.createElement('canvas');
  c.width = c.height = size * ratio;
  const ctx = c.getContext('2d');
  ctx.scale(ratio, ratio);
  const cx = size / 2;
  const square = kind === 'v';
  shapePath(ctx, cx, cx, r + 4, square);
  ctx.fillStyle =
    kind === 'u' ? 'rgba(122, 128, 140, 0.30)' : kind === 's' ? 'rgba(35, 70, 160, 0.25)' : kind === 'v' ? 'rgba(75, 138, 43, 0.30)' : 'rgba(30, 123, 79, 0.30)';
  ctx.fill();
  shapePath(ctx, cx, cx, r, square);
  ctx.fillStyle = kind === 'u' ? '#5E6573' : kind === 's' ? '#14233F' : kind === 'v' ? '#4B8A2B' : '#1E7B4F';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${n >= 4 ? 11.5 : 13}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cx + 0.5);
  return { img: ctx.getImageData(0, 0, c.width, c.height), ratio };
}

export class MapView {
  constructor(container, { center, zoom, theme = 'light', lang = 'en', labels = {} }) {
    this.container = container;
    this.start = { center, zoom };
    this.theme = theme;
    this.lang = lang;
    this.labels = labels;
    this.handlers = { move: [], select: [], hover: [], ready: [] };
    this.data = { places: EMPTY, prayer: EMPTY, summary: EMPTY, selected: EMPTY, hover: EMPTY, user: EMPTY };
    this.map = null;
    this.usingFallback = false;
  }

  on(evt, fn) {
    this.handlers[evt].push(fn);
  }

  emit(evt, ...args) {
    for (const fn of this.handlers[evt]) fn(...args);
  }

  async init() {
    if (!webglSupported()) throw new Error('WebGL is not available');
    loadStyle(LIB_CSS);
    await loadScript(LIB_JS);
    const ml = window.maplibregl;
    this.ml = ml;
    try {
      ml.setRTLTextPlugin('assets/vendor/mapbox-gl-rtl-text/mapbox-gl-rtl-text.js', true)?.catch?.(() => {});
    } catch {
      /* plugin already set */
    }
    const map = new ml.Map({
      container: this.container,
      style: STYLES[this.theme] || STYLES.light,
      center: [this.start.center.lon, this.start.center.lat],
      zoom: this.start.zoom,
      minZoom: 1.2,
      maxZoom: 19,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      fadeDuration: 150,
      locale: {
        'NavigationControl.ZoomIn': this.labels.zoomIn || 'Zoom in',
        'NavigationControl.ZoomOut': this.labels.zoomOut || 'Zoom out',
      },
    });
    this.map = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation?.();
    map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new ml.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');

    map.on('styleimagemissing', (e) => {
      if (map.hasImage(e.id)) return;
      let out = null;
      if (e.id.startsWith('pin-')) out = drawPin(e.id);
      else if (e.id.startsWith('cl-')) out = drawCluster(e.id);
      if (out) map.addImage(e.id, out.img, { pixelRatio: out.ratio });
    });
    map.on('style.load', () => this.installLayers());
    map.on('error', (e) => {
      // Style or tiles from OpenFreeMap unavailable -> raster OpenStreetMap tiles.
      const msg = String(e?.error?.message || '');
      if (!this.usingFallback && !map.isStyleLoaded() && /style|Failed to fetch|NetworkError|load/i.test(msg)) {
        this.usingFallback = true;
        map.setStyle(FALLBACK_STYLE, { diff: false });
      }
    });
    map.on('moveend', () => this.emit('move'));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!map.isStyleLoaded()) {
          this.usingFallback = true;
          map.setStyle(FALLBACK_STYLE, { diff: false });
        }
      }, 8000);
      map.once('load', () => {
        clearTimeout(timer);
        resolve();
      });
      setTimeout(() => reject(new Error('map load timeout')), 20000);
    });
    // Phones: start with the attribution folded to its "i" button, next to "Near me".
    if (matchMedia('(max-width: 719px)').matches) {
      const attrib = this.container.querySelector('.maplibregl-ctrl-attrib');
      attrib?.classList.remove('maplibregl-compact-show');
      attrib?.removeAttribute('open');
    }
    this.bindEvents();
    this.emit('ready');
  }

  hasGlyphs() {
    return Boolean(this.map.getStyle()?.glyphs);
  }

  localizeLabels() {
    const map = this.map;
    if (this.usingFallback) return;
    const style = map.getStyle();
    if (!this.originalText) this.originalText = {};
    for (const layer of style.layers) {
      if (layer.type !== 'symbol' || !layer.layout?.['text-field'] || layer.id.startsWith('mf-')) continue;
      const original = this.originalText[layer.id] ?? layer.layout['text-field'];
      this.originalText[layer.id] = original;
      // Latin-script UI languages keep the default "Latin + local script" labels,
      // which help visitors match signs. Prefer localized Korean, Arabic and French where present.
      const value = ['ko', 'ar', 'fr'].includes(this.lang) ? ['coalesce', ['get', `name:${this.lang}`], original] : original;
      try {
        map.setLayoutProperty(layer.id, 'text-field', value);
      } catch {
        /* layer without name fields */
      }
    }
  }

  installLayers() {
    const map = this.map;
    this.originalText = null;
    this.localizeLabels();
    const add = (id, src) => {
      if (!map.getSource(id)) map.addSource(id, src);
    };
    add('mf-summary', {
      type: 'geojson',
      data: this.data.summary,
      cluster: true,
      clusterRadius: 60,
      clusterMaxZoom: DETAIL_ZOOM,
      clusterProperties: { total: ['+', ['get', 'count']] },
    });
    add('mf-places', {
      type: 'geojson',
      data: this.data.places,
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 44,
      // Cluster colour: jade when it holds halal places, leaf when only meat-free ones, stone otherwise.
      clusterProperties: {
        halal: ['+', ['case', ['in', ['get', 's'], ['literal', ['C', 'O', 'Y', 'F', 'L']]], 1, 0]],
        veg: ['+', ['case', ['in', ['get', 's'], ['literal', ['V', 'M']]], 1, 0]],
      },
    });
    add('mf-prayer', { type: 'geojson', data: this.data.prayer });
    add('mf-selected', { type: 'geojson', data: this.data.selected });
    add('mf-hover', { type: 'geojson', data: this.data.hover });
    add('mf-user', { type: 'geojson', data: this.data.user });

    const abbrev = (expr) => [
      'case',
      ['>=', expr, 10000],
      ['concat', ['to-string', ['round', ['/', expr, 1000]]], 'k'],
      ['>=', expr, 1000],
      ['concat', ['to-string', ['/', ['round', ['/', expr, 100]], 10]], 'k'],
      ['to-string', expr],
    ];

    map.addLayer({
      id: 'mf-summary',
      type: 'symbol',
      source: 'mf-summary',
      maxzoom: DETAIL_ZOOM,
      layout: {
        'icon-image': ['concat', 'cl-', abbrev(['coalesce', ['get', 'total'], ['get', 'count']]), '-s'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    map.addLayer({
      id: 'mf-clusters',
      type: 'symbol',
      source: 'mf-places',
      minzoom: DETAIL_ZOOM,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': ['concat', 'cl-', abbrev(['get', 'point_count']), ['case', ['>', ['get', 'halal'], 0], '-g', ['>', ['get', 'veg'], 0], '-v', '-u']],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    map.addLayer({
      id: 'mf-pins',
      type: 'symbol',
      source: 'mf-places',
      minzoom: DETAIL_ZOOM,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['get', 'icon'],
        // Zoomed out, meat-free alternatives are drawn smaller so halal places stand out.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, ['case', IS_VEG, 0.6, 0.9], 15.5, 1],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'sort'],
      },
    });
    map.addLayer({
      id: 'mf-prayer',
      type: 'symbol',
      source: 'mf-prayer',
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    });
    if (this.hasGlyphs()) {
      const dark = this.theme === 'dark';
      for (const [id, src, filter] of [
        ['mf-labels', 'mf-places', LABEL_FILTER],
        ['mf-prayer-labels', 'mf-prayer', ['has', 'label']],
      ]) {
        map.addLayer({
          id,
          type: 'symbol',
          source: src,
          minzoom: id === 'mf-labels' ? 13.5 : 15,
          filter,
          layout: {
            // Where names collide, the more certain halal place keeps its name.
            'symbol-sort-key': ['-', 10, ['coalesce', ['get', 'sort'], 0]],
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-offset': [0, 1.35],
            'text-anchor': 'top',
            'text-max-width': 9,
            'text-optional': true,
          },
          paint: {
            'text-color': dark ? '#E7ECF5' : '#14233F',
            'text-halo-color': dark ? '#0E1726' : '#FFFFFF',
            'text-halo-width': 1.6,
          },
        });
      }
    }
    this.hideSelectedLabel();
    map.addLayer({
      id: 'mf-user-accuracy',
      type: 'circle',
      source: 'mf-user',
      filter: ['has', 'r0'],
      paint: {
        // metres -> pixels: the radius doubles with every zoom level
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', 'r0'], 22, ['*', ['get', 'r0'], 4194304]],
        'circle-color': '#2346A0',
        'circle-opacity': 0.1,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#2346A0',
        'circle-stroke-opacity': 0.25,
      },
    });
    map.addLayer({
      id: 'mf-hover',
      type: 'circle',
      source: 'mf-hover',
      paint: { 'circle-radius': 19, 'circle-color': '#2346A0', 'circle-opacity': 0.14, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#2346A0' },
    });
    if (this.hasGlyphs()) {
      const dark = this.theme === 'dark';
      map.addLayer({
        id: 'mf-hover-label',
        type: 'symbol',
        source: 'mf-hover',
        filter: ['has', 'label'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
          'text-offset': [0, 1.7],
          'text-anchor': 'top',
          'text-max-width': 11,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': dark ? '#FFFFFF' : '#14233F', 'text-halo-color': dark ? '#0E1726' : '#FFFFFF', 'text-halo-width': 2 },
      });
    }
    map.addLayer({
      id: 'mf-user-halo',
      type: 'circle',
      source: 'mf-user',
      paint: { 'circle-radius': 16, 'circle-color': '#2346A0', 'circle-opacity': 0.16 },
    });
    map.addLayer({
      id: 'mf-user',
      type: 'circle',
      source: 'mf-user',
      paint: { 'circle-radius': 7, 'circle-color': '#2346A0', 'circle-stroke-width': 3, 'circle-stroke-color': '#FFFFFF' },
    });
    map.addLayer({
      id: 'mf-selected',
      type: 'symbol',
      source: 'mf-selected',
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    });
    // The selected place always shows its name, at any zoom.
    if (this.hasGlyphs()) {
      const dark = this.theme === 'dark';
      map.addLayer({
        id: 'mf-selected-label',
        type: 'symbol',
        source: 'mf-selected',
        filter: ['has', 'label'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13.5,
          'text-offset': [0, 1.7],
          'text-anchor': 'top',
          'text-max-width': 11,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': dark ? '#FFFFFF' : '#14233F',
          'text-halo-color': dark ? '#0E1726' : '#FFFFFF',
          'text-halo-width': 2,
        },
      });
    }
  }

  bindEvents() {
    const map = this.map;
    const pick = (e) => {
      const f = e.features?.[0];
      if (f) this.emit('select', f.properties.id);
    };
    map.on('click', 'mf-pins', pick);
    map.on('click', 'mf-prayer', pick);
    map.on('click', 'mf-clusters', async (e) => {
      const f = e.features[0];
      try {
        const zoom = await map.getSource('mf-places').getClusterExpansionZoom(f.properties.cluster_id);
        map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom + 0.3, 18) });
      } catch {
        map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 });
      }
    });
    map.on('click', 'mf-summary', (e) => {
      const f = e.features[0];
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom() + 2.5, DETAIL_ZOOM + 1) });
    });
    // Pointing at a marker names it (below the zoom where names are drawn) and marks its row in the list.
    const hover = (e) => {
      const f = e.features?.[0];
      const id = f?.properties.id || null;
      if (id === this.hoverId) return;
      this.hoverId = id;
      this.emit('hover', id);
      this.set(
        'mf-hover',
        'hover',
        f && id !== this.selectedId
          ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: f.geometry, properties: map.getZoom() < 15 && f.properties.label ? { label: f.properties.label } : {} }] }
          : EMPTY,
      );
    };
    const unhover = () => {
      this.hoverId = null;
      this.emit('hover', null);
      this.set('mf-hover', 'hover', EMPTY);
    };
    for (const id of ['mf-pins', 'mf-prayer']) {
      map.on('mousemove', id, hover);
      map.on('mouseleave', id, unhover);
    }
    for (const id of ['mf-pins', 'mf-prayer', 'mf-clusters', 'mf-summary']) {
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }
  }

  set(sourceId, key, data) {
    this.data[key] = data;
    const src = this.map?.getSource(sourceId);
    if (src) src.setData(data);
  }

  setPlaces(places, labelOf) {
    this.set('mf-places', 'places', {
      type: 'FeatureCollection',
      features: places.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.x, p.y] },
        properties: { id: p.id, s: p.s, icon: `pin-${p.s}-${p.k}`, sort: 5 - (STATUS_ORDER[p.s] ?? 5), label: labelOf(p) },
      })),
    });
  }

  setPrayer(places, labelOf) {
    this.set('mf-prayer', 'prayer', {
      type: 'FeatureCollection',
      features: places.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.x, p.y] },
        properties: { id: p.id, icon: 'pin-P-p', label: labelOf(p) },
      })),
    });
  }

  setSummary(geojson) {
    this.set('mf-summary', 'summary', geojson);
  }

  setSelected(p, label = '') {
    this.selectedId = p?.id || null;
    this.hideSelectedLabel();
    this.set(
      'mf-selected',
      'selected',
      p
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.x, p.y] },
                properties: { id: p.id, icon: `pin-${p.k === 'p' ? 'P' : p.s}-${p.k}-sel`, ...(label ? { label } : {}) },
              },
            ],
          }
        : EMPTY,
    );
  }

  /** Ring (and, zoomed out, the name) for the list row under the pointer. */
  setHover(p, label = '') {
    this.set(
      'mf-hover',
      'hover',
      p
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.x, p.y] }, properties: this.map && this.map.getZoom() < 15 && label ? { label } : {} }],
          }
        : EMPTY,
    );
  }

  /** The selected place has its own bold label; drop its regular one. */
  hideSelectedLabel() {
    if (!this.map?.getLayer('mf-labels')) return;
    this.map.setFilter('mf-labels', this.selectedId ? ['all', LABEL_FILTER, ['!=', ['get', 'id'], this.selectedId]] : LABEL_FILTER);
  }

  /** A labelled pin for a searched area or address (not one of our places). */
  setSearchPin(place) {
    this.searchMarker?.remove();
    this.searchMarker = null;
    if (!place || !this.map) return;
    const el = document.createElement('div');
    el.className = 'search-pin';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', place.name || '');
    el.innerHTML =
      '<svg viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39s13-13.2 13-23.6A13 13 0 0 0 2 15.4C2 25.8 15 39 15 39z" fill="#B02E43" stroke="#fff" stroke-width="2.4"/><circle cx="15" cy="15.5" r="5" fill="#fff"/></svg>';
    if (place.name) {
      const label = document.createElement('span');
      label.className = 'search-pin-label';
      label.textContent = place.name;
      el.prepend(label);
    }
    this.searchMarker = new this.ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([place.lon, place.lat]).addTo(this.map);
  }

  setUser(pos) {
    this.set(
      'mf-user',
      'user',
      pos
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] }, properties: accuracyProps(pos) }],
          }
        : EMPTY,
    );
  }

  bounds() {
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  center() {
    const c = this.map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  zoom() {
    return this.map.getZoom();
  }

  flyTo({ lat, lon, zoom }, { instant = false } = {}) {
    const opts = { center: [lon, lat], zoom: zoom ?? Math.max(this.map.getZoom(), 15), essential: true };
    // A flight across the country takes seconds and loads tiles on the way: jump instead.
    const c = this.map.getCenter();
    const far = Math.hypot(c.lat - lat, (c.lng - lon) * Math.cos((lat * Math.PI) / 180)) > 0.7;
    if (instant || far || matchMedia('(prefers-reduced-motion: reduce)').matches) this.map.jumpTo(opts);
    else {
      // Quick for a short hop, never longer than two seconds.
      const km = Math.hypot(c.lat - lat, (c.lng - lon) * Math.cos((lat * Math.PI) / 180)) * 111;
      this.map.flyTo({ ...opts, curve: 1.3, duration: Math.min(2000, 700 + km * 90) });
    }
  }

  /** Make sure a point is visible (not hidden under the sheet). */
  reveal({ lat, lon }, minZoom = 15) {
    const z = Math.max(this.map.getZoom(), minZoom);
    this.map.easeTo({ center: [lon, lat], zoom: z, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450 });
  }

  setPadding(padding) {
    if (this.map) this.map.setPadding(padding);
  }

  setTheme(theme) {
    if (theme === this.theme || !this.map) return;
    this.theme = theme;
    if (!this.usingFallback) this.map.setStyle(STYLES[theme] || STYLES.light, { diff: false });
  }

  setLang(lang) {
    this.lang = lang;
    if (this.map?.isStyleLoaded()) this.localizeLabels();
  }

  resize() {
    this.map?.resize();
  }
}
