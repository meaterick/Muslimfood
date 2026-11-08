// Tiny i18n: loads assets/i18n/<lang>.json, falls back to English per key,
// handles plurals (Intl.PluralRules) and {placeholders}.

import { UI_LANGS } from '../core/normalize.js';
import { storage } from './util.js';

let dict = {};
let fallback = {};
let current = 'en';
let plural = new Intl.PluralRules('en');

export const LANGS = UI_LANGS;

/** Pick the UI language: ?lang= → saved choice → browser languages → English. */
export function detectLang() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl && LANGS.includes(fromUrl)) return fromUrl;
  const saved = storage.get('lang');
  if (saved && LANGS.includes(saved)) return saved;
  for (const l of navigator.languages || [navigator.language || 'en']) {
    const base = String(l).toLowerCase().split('-')[0];
    if (base === 'in') return 'id'; // legacy code for Indonesian
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

async function fetchDict(lang) {
  const res = await fetch(`assets/i18n/${lang}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`i18n ${lang}: HTTP ${res.status}`);
  return res.json();
}

export async function setLang(lang) {
  if (!LANGS.includes(lang)) lang = 'en';
  const [d, en] = await Promise.all([fetchDict(lang), lang === 'en' ? null : Object.keys(fallback).length ? fallback : fetchDict('en')]);
  dict = d;
  fallback = lang === 'en' ? d : en;
  current = lang;
  plural = new Intl.PluralRules(lang);
  const root = document.documentElement;
  root.lang = lang;
  root.dir = d.meta?.dir || 'ltr';
  return lang;
}

export function lang() {
  return current;
}

/** Locale used for number/date formatting (Latin digits everywhere for consistency). */
export function locale() {
  return current === 'ar' ? 'ar-u-nu-latn' : current;
}

function lookup(obj, key) {
  let v = obj;
  for (const part of key.split('.')) {
    if (v == null) return undefined;
    v = v[part];
  }
  return v;
}

function fill(str, vars) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
}

/** Translate a key. vars.n selects a plural form when the entry is an object. */
export function t(key, vars) {
  let v = lookup(dict, key);
  if (v === undefined) v = lookup(fallback, key);
  if (v === undefined) return key;
  if (typeof v === 'object') {
    const n = vars?.n ?? 0;
    const num = typeof n === 'number' ? n : Number(String(n).replace(/[^\d.]/g, ''));
    const form = num === 0 && v.zero ? 'zero' : plural.select(num);
    v = v[form] ?? v.other ?? '';
  }
  return vars ? fill(v, { ...vars, n: typeof vars.n === 'number' ? formatNumber(vars.n) : vars.n }) : v;
}

/** Does the dictionary (or English) contain the key? */
export function has(key) {
  return lookup(dict, key) !== undefined || lookup(fallback, key) !== undefined;
}

export function formatNumber(n) {
  return new Intl.NumberFormat(locale()).format(n);
}

/** Apply translations to [data-i18n], [data-i18n-attr="attr:key;attr:key"]. */
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}

/** Localized weekday name, 0 = Monday. */
export function weekdayName(i, style = 'short') {
  // 2024-01-01 was a Monday
  const d = new Date(Date.UTC(2024, 0, 1 + i, 12));
  return new Intl.DateTimeFormat(locale(), { weekday: style, timeZone: 'UTC' }).format(d);
}

/** Localized time "HH:MM" from minutes since midnight. */
export function formatTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const d = new Date(Date.UTC(2024, 0, 1, Math.floor(m / 60), m % 60));
  if (min === 1440) return current === 'ko' ? '자정' : '24:00';
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC', hourCycle: 'h23' }).format(d);
}

/** Localized date from "YYYY-MM-DD" or ISO string. */
export function formatDate(s) {
  if (!s) return '';
  const d = new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}
