// HTML builders for the list and the place detail view. Everything that comes
// from data is escaped with esc().

import { t, has, lang, formatTime, weekdayName, formatDate } from './i18n.js';
import { icon, CATEGORY_ICON } from './icons.js';
import { esc } from '../core/text.js';
import { formatDistance, isInKorea } from '../core/geo.js';
import { parseOpeningHours, openState, weekRows, localTime } from '../core/hours.js';
import { mapApps, osmLink, osmNoteLink, osmEditLink } from '../core/links.js';
import { cleanUrl, placeCuisineGroup, MEAT_FREE } from '../core/normalize.js';
import { BRAND_BY_ID, placeDishes, branchOf } from '../core/brands.js';
import { telHref } from './util.js';
import { ISSUE_REPORT } from '../config.js';

const LATIN_UI = new Set(['en', 'id', 'ms', 'tr', 'fr']);

/** Name shown as the title: UI-language name, else English for Latin-script UIs, else local. */
export function displayName(p) {
  if (!p.n && p.k === 'p') return t(`prayer.${p.pt || 'mosque'}`);
  const l = lang();
  // Chain branches: the chain's English name plus the branch as written on the
  // sign ("Starbucks · 역삼역점"), so branches can be told apart.
  const brand = l !== 'ko' && BRAND_BY_ID.get(p.b);
  if (brand) {
    const branch = branchOf(p);
    return branch ? `${brand.name.en} · ${branch}` : brand.name.en;
  }
  return (p.nl && p.nl[l]) || (LATIN_UI.has(l) || l === 'ar' ? p.nl?.en : null) || p.n;
}

/** Secondary name (e.g. the Hangul name under an English title). */
export function altName(p) {
  const main = displayName(p);
  if (p.n && p.n !== main) return p.n;
  if (lang() !== 'ko' && p.nl?.ko && p.nl.ko !== main) return p.nl.ko;
  return '';
}

export function statusKey(p) {
  return p.k === 'p' ? 'P' : p.s || 'U';
}

/** Message key suffix: V/M come in a vegetarian and a vegan wording (VV, MV). */
function statusVariant(p) {
  return MEAT_FREE.has(p.s) && p.dv === 'vegan' ? `${p.s}V` : p.s;
}

export function statusLabel(p) {
  return p.k === 'p' ? t(`prayer.${p.pt || 'mosque'}`) : t(`status.${statusVariant(p)}`);
}

export function statusDesc(p) {
  if (p.s === 'U') return t(p.why === 'name' ? 'status.desc.Uname' : 'status.desc.Ucuisine');
  return t(`status.desc.${statusVariant(p)}`);
}

function prettify(token) {
  const s = token.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function cuisineLabel(p, max = 2) {
  const out = [];
  for (const tok of p.cu || []) {
    const key = `cuisine.t.${tok}`;
    const label = has(key) ? t(key) : prettify(tok);
    if (!out.includes(label)) out.push(label);
    if (out.length >= max) break;
  }
  if (!out.length) {
    const g = placeCuisineGroup(p);
    if (g) out.push(t(`cuisine.group.${g}`));
  }
  return out.join(', ');
}

export function markHtml(p, extra = '') {
  const s = statusKey(p);
  const glyph = MEAT_FREE.has(s) ? 'leaf' : CATEGORY_ICON[p.k] || 'other';
  return `<span class="mark s-${s} ${extra}" aria-hidden="true">${icon(glyph)}</span>`;
}

export function badgeHtml(p) {
  const s = statusKey(p);
  return `<span class="badge s-${s}">${esc(statusLabel(p))}</span>`;
}

/** Short open/closed text for a place, or ''. */
export function openText(p, tz, now = new Date()) {
  const parsed = parseOpeningHours(p.oh);
  const st = openState(parsed, now, tz);
  if (!st) return '';
  if (st.always) return { cls: 'is-open', text: t('detail.open24') };
  if (st.open) return { cls: 'is-open', text: t('detail.closesAt', { time: formatTime(st.closesAt) }) };
  if (st.opensAt === undefined) return { cls: 'is-closed', text: t('detail.closed') };
  if (st.opensInDays === 0) return { cls: 'is-closed', text: t('detail.opensAt', { time: formatTime(st.opensAt) }) };
  const day = st.opensInDays === 1 ? t('time.tomorrow') : weekdayName(st.opensDay, 'long');
  return { cls: 'is-closed', text: t('detail.opensDay', { day, time: formatTime(st.opensAt) }) };
}

/** "Near Yeoksam Stn." for a station from core/stations.js, or ''. */
export function nearText(station) {
  if (!station) return '';
  const name = lang() === 'ko' || !station.en ? station.ko : station.en;
  return t('place.nearStation', { station: name });
}

/** A station's name as on the signs: "역삼역" / "Yeoksam". */
export function stationName(station) {
  if (!station) return '';
  return lang() === 'ko' || !station.en ? `${station.ko}역` : station.en;
}

export function listItemHtml(p, { dist, tz, selected, station = null }) {
  const alt = altName(p);
  const stn = stationName(station);
  const cuisine = p.k === 'p' ? '' : cuisineLabel(p);
  const open = openText(p, tz);
  return `<li><button type="button" class="place" data-id="${esc(p.id)}"${selected ? ' aria-current="true"' : ''}>
  ${markHtml(p)}
  <span class="place-body">
    <span class="place-name">${esc(displayName(p))}</span>
    ${alt ? `<span class="place-alt">${esc(alt)}</span>` : ''}
    <span class="place-meta">${badgeHtml(p)}${cuisine ? `<span>${esc(cuisine)}</span>` : ''}${
      stn ? `<span class="place-stn" title="${esc(nearText(station))}">${icon('train')}${esc(stn)}</span>` : ''
    }${open ? `<span class="open-state ${open.cls}">${esc(open.text)}</span>` : ''}${p.al === 1 ? `<span class="warn-text">${esc(t('detail.alcohol'))}</span>` : ''}</span>
  </span>
  <span class="place-dist">${Number.isFinite(dist) ? esc(formatDistance(dist, lang() === 'ar' ? 'ar-u-nu-latn' : lang())) : ''}</span>
</button></li>`;
}

export function skeletonHtml(rows = 4) {
  return `<div class="skeleton" aria-hidden="true">${'<span></span>'.repeat(rows * 3)}</div>`;
}

export function noticeHtml({ kind = '', iconName = 'info', text, button, buttonAction, id = '' }) {
  return `<div class="notice ${kind}" ${id ? `id="${id}"` : ''}>${icon(iconName)}<div class="notice-body"><p>${esc(text)}</p>${
    button ? `<button type="button" class="text-btn" data-action="${esc(buttonAction)}">${esc(button)}</button>` : ''
  }</div></div>`;
}

function appLogo(id) {
  const letter = { naver: 'N', kakao: 'K', google: 'G', apple: '' }[id];
  return `<span class="app-logo ${id}" aria-hidden="true">${
    id === 'apple'
      ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="#fff"><path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8C6.9 7.4 5.4 8.3 4.6 9.7c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.7 2.4 2.9 2.4 1.2-.1 1.6-.8 3-.8s1.8.8 3 .7c1.3 0 2-1.2 2.8-2.3.9-1.3 1.2-2.6 1.3-2.7-.1 0-2.4-.9-2.4-4zM14.2 5.8c.6-.8 1.1-1.8 1-2.8-.9 0-2 .6-2.6 1.4-.6.7-1.1 1.7-1 2.7 1 .1 2-.5 2.6-1.3z"/></svg>'
      : letter
  }</span>`;
}

function sourceLines(p) {
  const lines = [];
  for (const src of p.srcs || [p.src]) {
    let text = t(`source.${src}`);
    if (src === 'osm' || src === 'live') {
      if (p.ck) text += ` — ${t('detail.checked', { date: formatDate(p.ck) })}`;
      lines.push(`<li><a href="${esc(osmLink(p))}" target="_blank" rel="noopener">${esc(text)}</a></li>`);
    } else {
      if (p.d && src !== 'kto') text += ` (${formatDate(p.d)})`;
      const source = src === 'kto' && cleanUrl(p.su);
      lines.push(source ? `<li><a href="${esc(source)}" target="_blank" rel="noopener">${esc(text)}</a></li>` : `<li>${esc(text)}</li>`);
    }
  }
  const brand = BRAND_BY_ID.get(p.b);
  if (brand) {
    const text = `${t('source.brand', { brand: brandName(brand) })} — ${t('detail.menuChecked', { date: formatDate(brand.checked) })}`;
    lines.push(`<li><a href="${esc(brand.url)}" target="_blank" rel="noopener">${esc(text)}</a></li>`);
  }
  return lines.join('');
}

/** A chain's name in the UI language (Korean or English). */
export function brandName(brand) {
  return lang() === 'ko' ? brand.name.ko : brand.name.en;
}

const DIET_LABEL = { v: 'diet.v', l: 'diet.l', o: 'diet.o', lo: 'diet.lo', veg: 'diet.veg' };

/** A dish list with diet labels (shared by place details and the guide). */
export function dishItemsHtml(names, diets = []) {
  return names
    .map((name, i) => {
      const key = DIET_LABEL[diets[i]];
      return `<li>${esc(name)}${key ? `<span class="diet-tag">${esc(t(key))}</span>` : ''}</li>`;
    })
    .join('');
}

function menuHtml(p) {
  const { names: menu, diets } = placeDishes(p, lang());
  const url = cleanUrl(p.mu);
  if (!menu.length && !url) return '';
  // Per-dish diet labels (vegan, lacto, ovo, lacto-ovo) line up with the dishes.
  // Skip them when every dish is vegan and the status already says so.
  let diet = diets;
  if (p.dv === 'vegan' && diet.every((d) => d === 'v')) diet = [];
  // A chain branch: the chain's standard dishes, with where and when they were checked.
  const brand = BRAND_BY_ID.get(p.b);
  if (brand) {
    const note = `brandNote.${brand.id}`;
    return `<section class="place-menu">
    <h3>${esc(t('detail.chainMenu', { brand: brandName(brand) }))}</h3>
    <ul>${dishItemsHtml(menu, diet)}</ul>
    ${has(note) ? `<p>${esc(t(note))}</p>` : ''}
    <p class="note">${esc(t('detail.chainNote', { brand: brandName(brand), date: formatDate(brand.checked) }))}</p>
    <a class="text-btn" href="${esc(brand.url)}" target="_blank" rel="noopener" data-track="official-menu" data-track-title="${esc(brand.id)}">${icon('external')}${esc(t('detail.officialMenu'))}</a>
  </section>`;
  }
  return `<section class="place-menu">
    <h3>${esc(t('detail.menu'))}</h3>
    ${menu.length ? `<ul>${dishItemsHtml(menu, diet)}</ul>` : ''}
    <p class="note">${esc(t('detail.menuNote'))}</p>
    ${url ? `<a class="text-btn" href="${esc(url)}" target="_blank" rel="noopener">${icon('external')}${esc(t('detail.menuLink'))}</a>` : ''}
  </section>`;
}

function hoursHtml(p, tz) {
  const parsed = parseOpeningHours(p.oh);
  if (!parsed) {
    const raw = p.oh || p.ohx;
    return `<div class="fact">${icon('clock')}<div class="fact-body">${
      raw ? `${esc(t('detail.hoursRaw'))}<span class="fact-sub">${esc(raw)}</span>` : `<span class="fact-sub">${esc(t('detail.hoursUnknown'))}</span>`
    }</div></div>`;
  }
  const open = openText(p, tz);
  const rows = weekRows(parsed);
  const today = localTime(new Date(), tz).day;
  // The same hours all week read better as one line than as seven rows.
  const sameAllWeek = rows.every((r) => r && r === rows[0]);
  const table = parsed.always
    ? ''
    : sameAllWeek
      ? `<span class="fact-sub">${esc(t('detail.everyDay'))} ${esc(rows[0])}</span>`
      : `<table class="hours"><tbody>${rows
        .map(
          (r, i) =>
            `<tr${i === today ? ' class="today"' : ''}><th scope="row">${esc(weekdayName(i, 'short'))}</th><td>${esc(r || t('detail.closedDay'))}</td></tr>`,
        )
        .join('')}</tbody></table>`;
  return `<div class="fact">${icon('clock')}<div class="fact-body"><span class="open-state ${open.cls || ''}">${esc(open.text || '')}</span>${table}</div></div>`;
}

export function detailHtml(p, { dist, tz, near = '', vote = '' }) {
  const l = lang();
  const alt = altName(p);
  const kind = [p.k === 'p' ? t('cat.p') : t(`cat.${p.k}`), p.k === 'p' ? '' : cuisineLabel(p, 3), Number.isFinite(dist) ? t('detail.away', { d: formatDistance(dist, l === 'ar' ? 'ar-u-nu-latn' : l) }) : '']
    .filter(Boolean)
    .join(' — ');
  const apps = mapApps(p, { lang: l });
  const inKr = isInKorea(p.y, p.x);
  const flags = [];
  if (p.al === 1) flags.push(['warn', 'alert', t('detail.alcohol')]);
  if (p.al === 0) flags.push(['good', 'check', t('detail.noAlcohol')]);
  if (p.nh) flags.push(['warn', 'alert', t('detail.nonHalal')]);
  if (p.pf) flags.push(['good', 'check', t('detail.porkFree')]);
  if (p.v && !MEAT_FREE.has(p.s)) flags.push(['', 'check', t('detail.vegetarian')]);
  if (p.pr) flags.push(['good', 'prayer', t('detail.prayerSpace')]);
  const isOsm = /^[nwr]\d+$/.test(p.id);
  // Open or closed belongs next to the name: it decides whether to go at all.
  const headOpen = p.k === 'p' && !p.oh ? '' : openText(p, tz);
  const reportHref = isOsm
    ? osmNoteLink(p)
    : `${ISSUE_REPORT}&title=${encodeURIComponent(`[Report] ${p.n || p.id}`)}&place=${encodeURIComponent(`${p.n || ''} (${p.id}) ${p.a || ''}`.trim())}`;
  return `<div class="detail">
  <header class="detail-head">
    <h2 id="detail-title" tabindex="-1">${esc(displayName(p))}</h2>
    ${alt ? `<p class="alt">${esc(alt)}</p>` : ''}
    <p class="kind">${badgeHtml(p)}<span>${esc(kind)}</span>${headOpen ? `<span class="open-state ${headOpen.cls}">${esc(headOpen.text)}</span>` : ''}</p>
  </header>
  <h3 class="visually-hidden">${esc(t('detail.directions'))}</h3>
  <div class="apps">${apps
    .map((a) => `<a class="app-btn" href="${esc(a.route)}" target="_blank" rel="noopener" data-track="directions/${esc(a.id)}" data-track-title="${esc(p.b ? `chain-${p.b}` : statusKey(p))}">${appLogo(a.id)}<span>${esc(a.label)}</span></a>`)
    .join('')}</div>
  <section class="status-card s-${statusKey(p)}">
    <div class="status-title">${markHtml(p)}<span>${esc(statusLabel(p))}</span></div>
    ${p.k === 'p' ? '' : `<p>${esc(statusDesc(p))}</p>`}
    ${p.ce ? `<p>${esc(t('detail.cert', { cert: p.ce }))}</p>` : ''}
    ${p.d && !isOsm ? `<p class="src">${esc(t('detail.dataDate', { date: formatDate(p.d) }))}</p>` : ''}
  </section>
  <div class="actions">
    ${p.ph ? `<a class="text-btn" href="${esc(telHref(p.ph, inKr))}" data-track="call">${icon('phone')}${esc(t('detail.call'))}</a>` : ''}
    ${p.w ? `<a class="text-btn" href="${esc(p.w)}" target="_blank" rel="noopener" data-track="website">${icon('globe')}${esc(t('detail.website'))}</a>` : ''}
    ${p.ig ? `<a class="text-btn" href="${esc(p.ig)}" target="_blank" rel="noopener" data-track="instagram">${icon('instagram')}${esc(t('detail.instagram'))}</a>` : ''}
    <button type="button" class="text-btn" data-action="share" data-track="share">${icon('share')}${esc(t('detail.share'))}</button>
  </div>
  <div class="facts">
    ${
      p.a
        ? `<div class="fact">${icon('pin')}<div class="fact-body">${esc(p.a)}${p.ph ? `<span class="fact-sub">${esc(p.ph)}</span>` : ''}</div><button type="button" class="text-btn" data-action="copy-address" aria-label="${esc(t('detail.copyAddress'))}">${icon('copy')}</button></div>`
        : ''
    }
    ${near ? `<div class="fact">${icon('train')}<div class="fact-body">${esc(near)}</div></div>` : ''}
    ${p.k === 'p' ? (p.oh ? hoursHtml(p, tz) : '') : hoursHtml(p, tz)}
  </div>
  ${menuHtml(p)}
  ${flags.length ? `<div class="flags">${flags.map(([cls, ic, text]) => `<span class="flag ${cls}">${icon(ic)}${esc(text)}</span>`).join('')}</div>` : ''}
  ${p.ap ? `<p class="note">${esc(t('detail.approx'))}</p>` : ''}
  ${vote}
  <div class="help-links">
    ${p.k === 'p' ? '' : `<button type="button" class="text-btn primary" data-action="staff-card" data-track="staff-card">${icon('card')}${esc(t('detail.staffCard'))}</button>`}
    <a class="text-btn" href="${esc(reportHref)}" target="_blank" rel="noopener" data-track="report">${icon('flag')}${esc(t('detail.report'))}</a>
    ${isOsm ? `<a class="text-btn" href="${esc(osmEditLink(p))}" target="_blank" rel="noopener">${icon('edit')}${esc(t('detail.edit'))}</a>` : ''}
  </div>
  <div class="sources"><p>${esc(t('detail.sources'))}</p><ul>${sourceLines(p)}</ul></div>
</div>`;
}
