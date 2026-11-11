// Menu, About, Korea guide (levels / dishes / phrases / staff card) and the
// full-screen "show this to the staff" view.

import { t, has, lang, LANGS, formatDate, applyDom } from './i18n.js';
import { icon } from './icons.js';
import { esc } from '../core/text.js';
import { isInKorea } from '../core/geo.js';
import { DISHES, PHRASES, STAFF_CARDS } from './content.js';
import { store } from './store.js';
import { storage } from './util.js';
import { REPO_URL, ISSUE_NEW_PLACE } from '../config.js';
import { BRANDS } from '../core/brands.js';
import { brandName } from './render.js';
import { track, analyticsEnabled } from './analytics.js';

// The Korea Tourism Organization's own list is linked, not copied (all rights reserved).
const KTO_PDF = 'https://english.visitkorea.or.kr/public/asis/upload/Muslim-friendly_restaurants.pdf';

const LANG_NAMES = { en: 'English', ko: '한국어', ar: 'العربية', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu', tr: 'Türkçe', fr: 'Français' };

let lastFocus = null;

export function openDialog(dlg) {
  lastFocus = document.activeElement;
  if (!dlg.open) dlg.showModal();
}

export function initDialogs() {
  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
    dlg.addEventListener('close', () => lastFocus?.focus?.());
  }
}

// ------------------------------------------------------------------ menu

export function renderMenu({ onLang, onTheme, theme, onGuide, onAbout, onAdd, installAvailable, onInstall }) {
  const body = document.getElementById('menu-body');
  body.innerHTML = `
    <label class="field">${esc(t('menu.language'))}
      <select id="lang-select">${LANGS.map((l) => `<option value="${l}" lang="${l}"${l === lang() ? ' selected' : ''}>${esc(LANG_NAMES[l])}</option>`).join('')}</select>
    </label>
    <div class="field" role="group" aria-label="${esc(t('menu.theme'))}">${esc(t('menu.theme'))}
      <div class="segmented">${['auto', 'light', 'dark']
        .map((v) => `<button type="button" data-theme-choice="${v}" aria-pressed="${theme === v}">${esc(t(`menu.theme${v[0].toUpperCase()}${v.slice(1)}`))}</button>`)
        .join('')}</div>
    </div>
    <ul class="menu-list">
      <li><button type="button" class="menu-item" data-menu="guide">${icon('book')}${esc(t('menu.guide'))}</button></li>
      <li><button type="button" class="menu-item" data-menu="card">${icon('card')}${esc(t('menu.card'))}</button></li>
      <li><button type="button" class="menu-item" data-menu="add">${icon('plus')}${esc(t('menu.add'))}</button></li>
      <li><button type="button" class="menu-item" data-menu="about">${icon('info')}${esc(t('menu.about'))}</button></li>
      ${installAvailable ? `<li><button type="button" class="menu-item" data-menu="install">${icon('expand')}${esc(t('menu.install'))}</button></li>` : ''}
      <li><a class="menu-item" href="${REPO_URL}" target="_blank" rel="noopener">${icon('external')}${esc(t('about.code'))}</a></li>
    </ul>`;
  body.querySelector('#lang-select').addEventListener('change', (e) => onLang(e.target.value));
  for (const b of body.querySelectorAll('[data-theme-choice]')) {
    b.addEventListener('click', () => {
      onTheme(b.dataset.themeChoice);
      for (const x of body.querySelectorAll('[data-theme-choice]')) x.setAttribute('aria-pressed', String(x === b));
    });
  }
  body.querySelector('.menu-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    const menu = document.getElementById('menu');
    menu.close();
    const what = b.dataset.menu;
    if (what === 'guide') onGuide('food');
    else if (what === 'card') onGuide('card');
    else if (what === 'about') onAbout();
    else if (what === 'add') onAdd();
    else if (what === 'install') onInstall();
  });
}

// ------------------------------------------------------------------ about

export function renderAbout(center) {
  const body = document.getElementById('about-body');
  const idx = store.index;
  const kr = (idx?.sources || []).filter((s) => s.url);
  const updated = idx?.generated ? `<p>${esc(t('about.updated', { date: formatDate(idx.generated) }))}</p>` : '';
  const osmEdit = center ? `https://www.openstreetmap.org/edit#map=18/${center.lat.toFixed(5)}/${center.lon.toFixed(5)}` : 'https://www.openstreetmap.org/edit';
  body.innerHTML = `
    <p>${esc(t('about.body'))}</p>
    <p class="note">${esc(t('about.disclaimer'))}</p>
    <h3 id="about-add">${esc(t('about.addTitle'))}</h3>
    <p>${esc(t('about.addBody'))}</p>
    <div class="help-links">
      <button type="button" class="text-btn primary" data-action="owner-form">${icon('plus')}${esc(t('about.addForm'))}</button>
      <a class="text-btn" href="${esc(osmEdit)}" target="_blank" rel="noopener">${icon('edit')}${esc(t('about.addOsm'))}</a>
      <a class="text-btn" href="${esc(ISSUE_NEW_PLACE)}" target="_blank" rel="noopener">${icon('external')}${esc(t('about.addIssue'))}</a>
    </div>
    <h3>${esc(t('about.sourcesTitle'))}</h3>
    <ul class="source-list">
      <li>${esc(t('about.osm'))} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">openstreetmap.org/copyright</a></li>
      <li>${esc(t('about.map'))} <a href="https://openfreemap.org" target="_blank" rel="noopener">openfreemap.org</a></li>
      <li>${esc(t('about.kr'))}
        <ul>${kr.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.key)}</a> — ${esc(s.publisher || '')}</li>`).join('')}</ul>
      </li>
    </ul>
    ${updated}
    <h3>${esc(t('about.privacyTitle'))}</h3>
    <p>${esc(t('about.privacy'))}</p>
    <p>${esc(t(analyticsEnabled ? 'about.privacyCounts' : 'about.privacyNoCounts'))}</p>
    <p><a href="${REPO_URL}" target="_blank" rel="noopener">${esc(t('about.code'))}</a></p>`;
}

// ------------------------------------------------------------------ guide

const TABS = ['levels', 'food', 'phrases', 'card'];
let cardLang = null;
let koVoice = null;

function findKoreanVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => /^ko(-|_|$)/i.test(v.lang)) || null;
}

if ('speechSynthesis' in window) {
  koVoice = findKoreanVoice();
  speechSynthesis.addEventListener?.('voiceschanged', () => (koVoice = findKoreanVoice()));
}

function speak(text) {
  if (!koVoice) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = koVoice;
  u.lang = koVoice.lang;
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

function levelRow(s, kind = 'r') {
  const label = s === 'P' ? t('prayer.mosque') : t(`status.${s}`);
  const desc = s === 'U' ? t('status.desc.Ucuisine') : s === 'P' ? t('cat.p') : t(`status.desc.${s}`);
  const glyph = s === 'P' ? 'prayer' : s === 'S' ? 'fish' : s === 'V' || s === 'M' ? 'leaf' : kind === 'r' ? 'restaurant' : kind;
  return `<li class="level"><span class="mark s-${s}" aria-hidden="true">${icon(glyph)}</span><div><strong>${esc(label)}</strong><p>${esc(desc)}</p></div></li>`;
}

function dishList(items) {
  return `<ul class="dish-list">${items
    .map((d) => `<li><span class="dish-ko" lang="ko">${esc(d.ko)}<span class="dish-rr" lang="en">${esc(d.rr)}</span></span><span class="dish-desc">${esc(t(`dish.${d.id}`))}</span></li>`)
    .join('')}</ul>`;
}

// Kinds of food Muslims can eat, each with the "Show" choice that puts it on the map.
const KINDS = [
  { id: 'halal', mark: 's-C', glyph: 'restaurant', show: 'halal' },
  { id: 'cuisine', mark: 's-U', glyph: 'restaurant', show: 'halal' },
  { id: 'veg', mark: 's-V', glyph: 'leaf', show: 'veg' },
  { id: 'chains', mark: 's-M', glyph: 'leaf', show: 'veg' },
  { id: 'sea', mark: 's-S', glyph: 'fish', show: 'sea' },
  { id: 'korean', mark: 's-M', glyph: 'restaurant', show: null },
  { id: 'bakery', mark: 's-U', glyph: 'cafe', show: null },
  { id: 'mart', mark: 's-Y', glyph: 'market', show: null },
];

function kindsHtml() {
  return `<h3 class="kinds-title">${esc(t('guide.kindsTitle'))}</h3>
    <p>${esc(t('guide.kindsIntro'))}</p>
    <ul class="food-kinds">${KINDS.map(
      (k) => `<li class="food-kind">
        <span class="mark ${k.mark}" aria-hidden="true">${icon(k.glyph)}</span>
        <div><strong>${esc(t(`guide.kinds.${k.id}.title`))}</strong><p>${esc(t(`guide.kinds.${k.id}.desc`, { filter: t('filter.cat.m') }))}</p>${
          k.show ? `<button type="button" class="link-btn" data-show="${k.show}">${esc(t('guide.kindsShow'))}${icon('back', 'chev')}</button>` : ''
        }</div>
      </li>`,
    ).join('')}</ul>`;
}

const DIET_KEY = { v: 'diet.v', l: 'diet.l', o: 'diet.o', lo: 'diet.lo', veg: 'diet.veg' };

/** A chain with its meat-free dishes: Korean names to point at, English below. */
function chainHtml(b) {
  const other = lang() === 'ko' ? b.name.en : b.name.ko;
  const note = `brandNote.${b.id}`;
  return `<li class="chain">
    <p class="chain-head"><strong>${esc(brandName(b))}</strong><span${lang() === 'ko' ? ' lang="en"' : ' lang="ko"'}>${esc(other)}</span></p>
    <ul class="dish-list">${b.items
      .map(
        (i) => `<li><span class="dish-ko" lang="ko">${esc(i.n)}<span class="dish-rr" lang="en">${esc(i.en)}</span></span><span class="dish-desc"><span class="diet-tag">${esc(t(DIET_KEY[i.d]))}</span></span></li>`,
      )
      .join('')}</ul>
    ${has(note) ? `<p class="note">${esc(t(note))}</p>` : ''}
    <a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(t('guide.officialMenu', { date: formatDate(b.checked) }))}</a>
  </li>`;
}

export function staffCardHtml(code) {
  const c = STAFF_CARDS[code] || STAFF_CARDS.ko;
  return `<div class="staff-card" lang="${esc(c.lang)}">
    <p>${esc(c.hello)}</p>
    <ul class="no">${c.no.map((x) => `<li><span class="sym" aria-hidden="true">✕</span><span>${esc(x)}</span></li>`).join('')}</ul>
    <p class="yes"><span class="sym" aria-hidden="true">○</span><span>${esc(c.yes)}</span></p>
    <p class="ask">${esc(c.ask)}</p>
  </div>`;
}

function defaultCardLang(center) {
  const saved = storage.get('cardLang');
  if (saved && STAFF_CARDS[saved]) return saved;
  if (!center) return 'ko';
  const { lat, lon } = center;
  if (isInKorea(lat, lon)) return 'ko';
  if (lat > 24 && lat < 46 && lon > 128.9 && lon < 146) return 'ja';
  if (lat > 21.8 && lat < 25.5 && lon > 119.5 && lon < 122.2) return 'zh-Hant'; // Taiwan
  if (lat > 22.1 && lat < 22.6 && lon > 113.8 && lon < 114.5) return 'zh-Hant'; // Hong Kong, Macau
  if (lat > 22.5 && lat < 42 && lon > 108 && lon < 123) return 'zh-Hans'; // eastern China
  return lang() === 'fr' ? 'fr' : 'en';
}

export function renderGuide(tab = 'levels', center = null) {
  const tabs = document.getElementById('guide-tabs');
  const body = document.getElementById('guide-body');
  if (!TABS.includes(tab)) tab = 'levels';
  track(`guide/${tab}`, { once: true });
  cardLang = cardLang || defaultCardLang(center);
  const tabKey = { levels: 'tabLevels', food: 'tabFood', phrases: 'tabPhrases', card: 'tabCard' };
  tabs.innerHTML = TABS.map(
    (k) =>
      `<button type="button" class="tab" role="tab" id="tab-${k}" aria-controls="guide-body" aria-selected="${k === tab}" tabindex="${k === tab ? 0 : -1}" data-tab="${k}">${esc(
        t(`guide.${tabKey[k]}`),
      )}</button>`,
  ).join('');
  body.setAttribute('role', 'tabpanel');
  body.setAttribute('aria-labelledby', `tab-${tab}`);
  let html = '';
  if (tab === 'levels') {
    html = `<p>${esc(t('guide.levelsIntro'))}</p>
      <ul class="level-list">${['C', 'O', 'Y', 'F', 'L', 'U'].map((s) => levelRow(s)).join('')}${levelRow('P')}</ul>
      <h3 class="level-sub">${esc(t('guide.vegTitle'))}</h3>
      <p>${esc(t('guide.vegIntro'))}</p>
      <ul class="level-list">${levelRow('V')}${levelRow('M')}${levelRow('S')}</ul>
      <div class="callout"><h3>${esc(t('guide.ktoTitle'))}</h3><p>${esc(t('guide.ktoBody'))}</p>
        <p><a href="${KTO_PDF}" target="_blank" rel="noopener">${esc(t('guide.ktoLink'))}</a></p></div>`;
  } else if (tab === 'food') {
    html = `${kindsHtml()}
      <h3 class="dish-group-title">${esc(t('guide.dishesTitle'))}</h3>
      <p>${esc(t('guide.foodIntro'))}</p>
      <h3 class="dish-group avoid"><span class="dot" aria-hidden="true"></span>${esc(t('guide.avoidTitle'))}</h3>${dishList(DISHES.avoid)}
      <h3 class="dish-group hidden-ing"><span class="dot" aria-hidden="true"></span>${esc(t('guide.hiddenTitle'))}</h3>${dishList(DISHES.hidden)}
      <h3 class="dish-group safer"><span class="dot" aria-hidden="true"></span>${esc(t('guide.saferTitle'))}</h3>${dishList(DISHES.safer)}
      <p class="note">${esc(t('guide.meatNote'))}</p>
      <h3 class="dish-group chains"><span class="dot" aria-hidden="true"></span>${esc(t('guide.chainsTitle'))}</h3>
      <p>${esc(t('guide.chainsIntro'))}</p>
      <ul class="chain-list">${BRANDS.filter((b) => b.countries.includes('KR')).map(chainHtml).join('')}</ul>`;
  } else if (tab === 'phrases') {
    html = `<p>${esc(t('guide.phrasesIntro'))}</p><ul>${PHRASES.map(
      (p) => `<li class="phrase"><button type="button" class="phrase-main" data-phrase="${p.id}"><span class="phrase-ko" lang="ko">${esc(p.ko)}</span><span class="phrase-rr" lang="en">${esc(
        p.rr,
      )}</span><span class="phrase-mean">${esc(t(`phrase.${p.id}`))}</span></button>${
        koVoice ? `<button type="button" class="icon-btn" data-speak="${p.id}" aria-label="${esc(t('guide.listen'))}">${icon('speaker')}</button>` : ''
      }</li>`,
    ).join('')}</ul>`;
  } else {
    html = `<p>${esc(t('guide.cardIntro'))}</p>
      <div class="card-tools">
        <label class="field">${esc(t('guide.cardLanguage'))}
          <select id="card-lang">${Object.entries(STAFF_CARDS).map(([code, c]) => `<option value="${code}"${code === cardLang ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
        </label>
        <button type="button" class="text-btn primary" data-action="card-full">${icon('expand')}${esc(t('guide.fullscreen'))}</button>
      </div>
      ${staffCardHtml(cardLang)}`;
  }
  body.innerHTML = html;
  body.scrollTop = 0;
}

export function initGuide(getCenter, { onShow = () => {} } = {}) {
  const tabs = document.getElementById('guide-tabs');
  const body = document.getElementById('guide-body');
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) {
      renderGuide(b.dataset.tab, getCenter());
      document.getElementById(`tab-${b.dataset.tab}`)?.focus();
    }
  });
  tabs.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const current = tabs.querySelector('[aria-selected="true"]')?.dataset.tab;
    const rtl = document.documentElement.dir === 'rtl';
    const step = (e.key === 'ArrowRight') !== rtl ? 1 : -1;
    const next = TABS[(TABS.indexOf(current) + step + TABS.length) % TABS.length];
    renderGuide(next, getCenter());
    document.getElementById(`tab-${next}`)?.focus();
  });
  body.addEventListener('change', (e) => {
    if (e.target.id === 'card-lang') {
      cardLang = e.target.value;
      storage.set('cardLang', cardLang);
      renderGuide('card', getCenter());
    }
  });
  body.addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) {
      track(`guide/show-${show.dataset.show}`);
      document.getElementById('guide').close();
      onShow(show.dataset.show);
      return;
    }
    const phrase = e.target.closest('[data-phrase]');
    const sp = e.target.closest('[data-speak]');
    if (sp) {
      const p = PHRASES.find((x) => x.id === sp.dataset.speak);
      if (p) speak(p.ko);
    } else if (phrase) {
      const p = PHRASES.find((x) => x.id === phrase.dataset.phrase);
      if (p) showBig(`<p class="bigtext-ko" lang="ko">${esc(p.ko)}</p><p class="bigtext-sub">${esc(p.rr)}<br>${esc(t(`phrase.${p.id}`))}</p>`);
    } else if (e.target.closest('[data-action="card-full"]')) {
      track('staff-card/full', { title: cardLang });
      showBig(staffCardHtml(cardLang));
    }
  });
}

export function openGuide(tab, center) {
  storage.set('guideSeen', true);
  if (tab === 'card') cardLang = cardLang || defaultCardLang(center);
  renderGuide(tab, center);
  applyDom(document.getElementById('guide'));
  openDialog(document.getElementById('guide'));
}

// ------------------------------------------------------------------ full-screen text

let bigPrevFocus = null;

export function showBig(innerHtml) {
  const el = document.getElementById('bigtext');
  bigPrevFocus = document.activeElement;
  el.innerHTML = `<button type="button" class="bigtext-close" data-big-close>${esc(t('guide.exitFullscreen'))}</button><div class="bigtext-body">${innerHtml}</div>`;
  el.hidden = false;
  el.querySelector('[data-big-close]').focus();
  // Keep the screen awake while the staff reads it, where supported.
  navigator.wakeLock?.request?.('screen').then((lock) => (el._lock = lock)).catch(() => {});
}

export function hideBig() {
  const el = document.getElementById('bigtext');
  if (el.hidden) return false;
  el.hidden = true;
  el._lock?.release?.();
  bigPrevFocus?.focus?.();
  return true;
}

export function initBig() {
  const el = document.getElementById('bigtext');
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-big-close]')) hideBig();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideBig();
  });
}
