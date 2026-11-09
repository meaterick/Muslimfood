// Cookie-free, anonymous usage counts with GoatCounter (https://www.goatcounter.com).
// Nothing is sent until ANALYTICS.goatcounter is set in config.js, on
// localhost, or when the browser asks not to be tracked (Do Not Track / GPC).
// Only the page, the event name, the referrer and the screen width are sent:
// no cookies, no identifiers, no place the visitor is at.
//
// Events (see README "Measuring"): directions/<app>, call, website, share,
// staff-card, view/<status>, view/chain-<id>, search/none, locate, filter/...,
// guide/<tab>, owner-form/sent, vote/<yes|no>, lang/<code>, install, legend/...

import { ANALYTICS } from '../config.js';

function endpoint() {
  const v = String(ANALYTICS?.goatcounter || '').trim();
  if (!v) return '';
  if (/^https:\/\//.test(v)) return v.replace(/\/+$/, '').replace(/(\/count)?$/, '/count');
  return /^[a-z0-9-]+$/i.test(v) ? `https://${v}.goatcounter.com/count` : '';
}

function allowed() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (['localhost', '127.0.0.1', ''].includes(location.hostname) || location.protocol === 'file:') return false;
  if (navigator.webdriver) return false;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true) return false;
  return true;
}

const URL_BASE = endpoint();
const ON = Boolean(URL_BASE) && allowed();
const seen = new Set();

function send(params) {
  if (!ON) return;
  const q = new URLSearchParams({ ...params, s: String(screen?.width || ''), rnd: Math.random().toString(36).slice(2, 8) });
  // A plain image request (GoatCounter's no-JavaScript counter), so no third-party script runs here.
  const img = new Image();
  img.src = `${URL_BASE}?${q}`;
}

/** Whether counting is switched on (for the privacy note). */
export const analyticsEnabled = ON;

/** One page view per visit, without the #map/place part of the address. */
export function trackPageview() {
  let ref = '';
  try {
    if (document.referrer && new URL(document.referrer).host !== location.host) ref = document.referrer;
  } catch {
    /* bad referrer */
  }
  send({ p: location.pathname || '/', t: document.title, r: ref });
}

/**
 * Count an event, e.g. track('directions/naver'). `title` adds detail (a
 * chain id, a failed search); it is cut to 60 characters.
 * With `once`, the same event is counted only once per page load.
 */
export function track(name, { title = '', once = false } = {}) {
  if (!ON || !name) return;
  const key = `${name}|${title}`;
  if (once && seen.has(key)) return;
  seen.add(key);
  send({ p: String(name).slice(0, 80), t: String(title).slice(0, 60), e: 'true' });
}

/** Count clicks on any element with data-track="event/name". */
export function initTracking() {
  if (!ON) return;
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest?.('[data-track]');
      if (el) track(el.dataset.track, { title: el.dataset.trackTitle || '' });
    },
    true,
  );
}
