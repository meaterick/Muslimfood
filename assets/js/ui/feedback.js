// Owner / visitor submissions ("add my restaurant") and "is this right?" votes.
// Both go to a Google Apps Script web app (config FEEDBACK_URL, see
// docs/feedback/) that writes them to a Google Sheet. Without it the form
// opens a prefilled GitHub issue, and votes are only remembered on this device.

import { FEEDBACK_URL, ISSUE_NEW_PLACE } from '../config.js';
import { t } from './i18n.js';
import { esc } from '../core/text.js';
import { storage } from './util.js';
import { icon } from './icons.js';
import { track } from './analytics.js';

export const feedbackEnabled = /^https:\/\/script\.google(usercontent)?\.com\//.test(FEEDBACK_URL || '');

const LEVELS = ['C', 'O', 'Y', 'P', 'V', 'X'];
const ALCOHOL = ['no', 'yes', 'unknown'];
const RELATION = ['owner', 'staff', 'visitor'];
const REASONS = ['closed', 'notHalal', 'alcohol', 'location', 'other'];
const MAX = { name: 120, address: 300, phone: 40, cert: 120, contact: 120, notes: 1000, note: 300 };

const cut = (v, n) => String(v ?? '').trim().slice(0, n);

/** POST as text/plain so the browser sends it without a CORS preflight (Apps Script cannot answer one). */
async function post(payload) {
  await fetch(FEEDBACK_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, v: 1 }),
    keepalive: true,
  });
}

// ------------------------------------------------------------------ owner form

export function renderOwnerForm(center) {
  const body = document.getElementById('owner-body');
  const opt = (prefix, v) => `<option value="${v}">${esc(t(`${prefix}.${v}`))}</option>`;
  body.innerHTML = `
    <p>${esc(t('owner.intro'))}</p>
    <form id="owner-form" class="form" novalidate>
      <label class="field"><span>${esc(t('owner.name'))} <span class="req" aria-hidden="true">*</span></span>
        <input name="name" required maxlength="${MAX.name}" autocomplete="organization">
      </label>
      <label class="field"><span>${esc(t('owner.address'))} <span class="req" aria-hidden="true">*</span></span>
        <input name="address" required maxlength="${MAX.address}" placeholder="${esc(t('owner.addressHint'))}">
      </label>
      <label class="field">${esc(t('owner.phone'))}
        <input name="phone" type="tel" maxlength="${MAX.phone}" autocomplete="tel">
      </label>
      <label class="field"><span>${esc(t('owner.level'))} <span class="req" aria-hidden="true">*</span></span>
        <select name="level" required><option value="">${esc(t('owner.choose'))}</option>${LEVELS.map((v) => opt('owner.levels', v)).join('')}</select>
      </label>
      <label class="field">${esc(t('owner.cert'))}
        <input name="cert" maxlength="${MAX.cert}" placeholder="KMF, JAKIM, MUI…">
      </label>
      <label class="field">${esc(t('owner.alcohol'))}
        <select name="alcohol">${ALCOHOL.map((v) => opt('owner.alcohols', v)).join('')}</select>
      </label>
      <label class="field">${esc(t('owner.relation'))}
        <select name="relation">${RELATION.map((v) => opt('owner.relations', v)).join('')}</select>
      </label>
      <label class="field">${esc(t('owner.contact'))}
        <input name="contact" maxlength="${MAX.contact}" autocomplete="email">
        <span class="field-hint">${esc(t('owner.contactHint'))}</span>
      </label>
      <label class="field">${esc(t('owner.notes'))}
        <textarea name="notes" rows="3" maxlength="${MAX.notes}" placeholder="${esc(t('owner.notesHint'))}"></textarea>
      </label>
      <label class="hp" aria-hidden="true">Company<input name="company" tabindex="-1" autocomplete="off"></label>
      <label class="check"><input type="checkbox" name="consent" required> <span>${esc(t('owner.consent'))}</span></label>
      <p class="form-error" id="owner-error" role="alert" hidden></p>
      <button type="submit" class="text-btn primary wide">${icon('check')}${esc(t(feedbackEnabled ? 'owner.send' : 'owner.sendGithub'))}</button>
    </form>`;
  const form = body.querySelector('#owner-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitOwner(form, center);
  });
}

function ownerIssueUrl(d) {
  const lines = [
    `${t('owner.level')}: ${t(`owner.levels.${d.level}`)}`,
    `${t('owner.alcohol')}: ${t(`owner.alcohols.${d.alcohol}`)}`,
    `${t('owner.relation')}: ${t(`owner.relations.${d.relation}`)}`,
    d.phone && `${t('owner.phone')}: ${d.phone}`,
    d.notes,
  ].filter(Boolean);
  const q = new URLSearchParams({ title: `[New place] ${d.name}`, name: d.name, address: d.address, certificate: d.cert, notes: lines.join('\n') });
  return `${ISSUE_NEW_PLACE}&${q}`;
}

async function submitOwner(form, center) {
  const err = form.querySelector('#owner-error');
  const fd = new FormData(form);
  const d = {
    name: cut(fd.get('name'), MAX.name),
    address: cut(fd.get('address'), MAX.address),
    phone: cut(fd.get('phone'), MAX.phone),
    level: LEVELS.includes(fd.get('level')) ? fd.get('level') : '',
    cert: cut(fd.get('cert'), MAX.cert),
    alcohol: ALCOHOL.includes(fd.get('alcohol')) ? fd.get('alcohol') : 'unknown',
    relation: RELATION.includes(fd.get('relation')) ? fd.get('relation') : 'visitor',
    contact: cut(fd.get('contact'), MAX.contact),
    notes: cut(fd.get('notes'), MAX.notes),
  };
  const missing = !d.name ? 'name' : !d.address ? 'address' : !d.level ? 'level' : !fd.get('consent') ? 'consent' : '';
  if (missing) {
    err.textContent = t('owner.missing');
    err.hidden = false;
    form.querySelector(`[name="${missing}"]`)?.focus();
    return;
  }
  err.hidden = true;
  // Bots fill every field, including the hidden one.
  if (cut(fd.get('company'), 10)) return showOwnerDone(form, true);
  if (!feedbackEnabled) {
    window.open(ownerIssueUrl(d), '_blank', 'noopener');
    track('owner-form/github');
    return showOwnerDone(form, false);
  }
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await post({ type: 'place', ...d, lang: document.documentElement.lang, near: center ? `${center.lat.toFixed(4)},${center.lon.toFixed(4)}` : '' });
    track('owner-form/sent', { title: d.level });
    showOwnerDone(form, true);
  } catch {
    button.disabled = false;
    err.innerHTML = `${esc(t('owner.error'))} <a href="${esc(ownerIssueUrl(d))}" target="_blank" rel="noopener">${esc(t('owner.sendGithub'))}</a>`;
    err.hidden = false;
  }
}

function showOwnerDone(form, sent) {
  form.outerHTML = `<div class="form-done" role="status">${icon('check')}<p><strong>${esc(t('owner.thanks'))}</strong></p><p>${esc(t(sent ? 'owner.thanksBody' : 'owner.thanksGithub'))}</p></div>`;
}

// ------------------------------------------------------------------ votes

let counts = null;
let countsLoad = null;
const COUNTS_TTL = 10 * 60 * 1000;

/** Vote totals per place id, { id: [yes, no] }, from the web app (cached for ten minutes). */
export function loadVoteCounts() {
  if (!feedbackEnabled) return Promise.resolve(null);
  const cached = storage.get('voteCounts');
  if (!counts && cached && Date.now() - cached.at < COUNTS_TTL) counts = cached.c;
  if (counts) return Promise.resolve(counts);
  countsLoad ??= fetch(`${FEEDBACK_URL}?counts=1`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      counts = j && typeof j.c === 'object' ? j.c : {};
      storage.set('voteCounts', { at: Date.now(), c: counts });
      return counts;
    })
    .catch(() => null)
    .finally(() => (countsLoad = null));
  return countsLoad;
}

const myVotes = () => storage.get('votes', {}) || {};

function countsLine(p) {
  const [yes = 0, no = 0] = counts?.[p.id] || [];
  if (!yes && !no) return '';
  return `<p class="vote-counts">${esc(t('vote.counts', { yes, no }))}</p>`;
}

/** The "Is this information right?" box in the place details. */
export function voteHtml(p, { asking = false } = {}) {
  const mine = myVotes()[p.id];
  let inner;
  if (mine) {
    inner = `<p class="vote-done">${icon('check')}${esc(t(mine === 'yes' ? 'vote.thanksYes' : 'vote.thanksNo'))}</p>`;
  } else if (asking) {
    inner = `<fieldset class="vote-reasons"><legend>${esc(t('vote.why'))}</legend>${REASONS.map(
      (r, i) => `<label class="check"><input type="radio" name="vote-reason" value="${r}"${i === 0 ? ' checked' : ''}> <span>${esc(t(`vote.reasons.${r}`))}</span></label>`,
    ).join('')}</fieldset>
      <label class="field">${esc(t('vote.note'))}<textarea id="vote-note" rows="2" maxlength="${MAX.note}"></textarea></label>
      <div class="vote-actions"><button type="button" class="text-btn primary" data-action="vote-send">${esc(t('vote.send'))}</button>
      <button type="button" class="text-btn" data-action="vote-cancel">${esc(t('vote.cancel'))}</button></div>`;
  } else {
    inner = `<div class="vote-actions">
      <button type="button" class="text-btn" data-action="vote-yes">${icon('check')}${esc(t('vote.yes'))}</button>
      <button type="button" class="text-btn" data-action="vote-no">${icon('alert')}${esc(t('vote.no'))}</button></div>`;
  }
  return `<section class="vote" id="vote" aria-labelledby="vote-title"><h3 id="vote-title">${esc(t('vote.title'))}</h3>${inner}${countsLine(p)}</section>`;
}

function rerender(p, opts) {
  const el = document.getElementById('vote');
  if (el) el.outerHTML = voteHtml(p, opts);
}

function record(p, vote, reason = '', note = '') {
  const all = myVotes();
  all[p.id] = vote;
  storage.set('votes', all);
  if (counts) {
    const c = counts[p.id] || [0, 0];
    counts[p.id] = vote === 'yes' ? [c[0] + 1, c[1]] : [c[0], c[1] + 1];
  }
  track(`vote/${vote}`, { title: vote === 'no' ? reason : p.s || '' });
  if (feedbackEnabled) {
    post({ type: 'vote', id: p.id, name: p.n || '', status: p.s || '', vote, reason, note: cut(note, MAX.note), lat: p.y, lon: p.x }).catch(() => {});
  }
}

/** Handle a click on a vote button; returns true when it was one. */
export function handleVoteAction(action, p) {
  if (!action.startsWith('vote-')) return false;
  if (myVotes()[p.id]) return true;
  if (action === 'vote-yes') {
    record(p, 'yes');
    rerender(p);
  } else if (action === 'vote-no') {
    rerender(p, { asking: true });
    document.querySelector('#vote input[name="vote-reason"]')?.focus();
  } else if (action === 'vote-cancel') {
    rerender(p);
  } else if (action === 'vote-send') {
    const reason = document.querySelector('#vote input[name="vote-reason"]:checked')?.value || 'other';
    record(p, 'no', REASONS.includes(reason) ? reason : 'other', document.getElementById('vote-note')?.value || '');
    rerender(p);
  }
  return true;
}

/** Fill in the totals once they arrive, if that place is still open. */
export function refreshVoteCounts(p) {
  if (!feedbackEnabled) return;
  loadVoteCounts().then((c) => {
    const view = document.getElementById('view-detail');
    if (c && view && !view.hidden && view.dataset.id === p.id && !document.querySelector('#vote .vote-reasons')) rerender(p);
  });
}
