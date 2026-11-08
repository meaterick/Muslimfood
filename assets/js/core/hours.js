// A small, dependency-free parser for the common subset of the OpenStreetMap
// `opening_hours` syntax: weekday ranges/lists, multiple time spans,
// "off"/"closed", past-midnight spans, "24/7", ";" and "," rule separators.
// Anything more exotic (months, week numbers, sunrise...) returns null so the
// UI can simply show the raw text instead of a wrong "open now".

const DAY_KEYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_IDX = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
const DAY_TOKEN = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)';
const DAY_RANGE = `${DAY_TOKEN}(?:\\s*-\\s*${DAY_TOKEN})?`;
const SELECTOR_RE = new RegExp(`^(${DAY_RANGE}(?:\\s*,\\s*${DAY_RANGE})*)(?=\\s|:|$)\\s*:?\\s*`);
const MONTH_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;
const UNSUPPORTED_RE = /\b(week|sunrise|sunset|dawn|dusk|easter)\b|\b\d{4}\b|\[|\(/i;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function toMinutes(t) {
  const m = TIME_RE.exec(t.trim());
  if (!m) return NaN;
  const h = +m[1];
  const min = +m[2];
  if (h > 48 || min > 59) return NaN;
  return h * 60 + min;
}

/** Split into rules; returns [{ text, additional }]. */
function splitRules(s) {
  const out = [];
  for (const part of s.split(/\s*(?:;|\|\|)\s*/)) {
    if (!part.trim()) continue;
    // "Mo-Fr 09:00-12:00, We 14:00-18:00" -> additional rule after a time/off.
    let start = 0;
    let additional = false;
    const re = new RegExp(`,\\s*(?=${DAY_TOKEN}\\b)`, 'g');
    let m;
    while ((m = re.exec(part))) {
      const before = part.slice(start, m.index).trimEnd();
      if (/(\d|off|closed|open)$/i.test(before)) {
        out.push({ text: before, additional });
        additional = true;
        start = m.index + m[0].length;
      }
    }
    out.push({ text: part.slice(start).trim(), additional });
  }
  return out;
}

function parseDays(sel) {
  const days = new Set();
  let holidayOnly = true;
  for (const piece of sel.split(/\s*,\s*/)) {
    const [a, b] = piece.split(/\s*-\s*/);
    if (a === 'PH' || a === 'SH') continue;
    holidayOnly = false;
    const i = DAY_IDX[a];
    if (i === undefined) return null;
    if (!b) {
      days.add(i);
      continue;
    }
    const j = DAY_IDX[b];
    if (j === undefined) return null;
    for (let d = i; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === j) break;
    }
  }
  return holidayOnly ? [] : [...days];
}

function parseRule(text) {
  let rest = text.trim();
  let days = [0, 1, 2, 3, 4, 5, 6];
  const sel = SELECTOR_RE.exec(rest);
  if (sel) {
    const parsed = parseDays(sel[1]);
    if (parsed === null) return null;
    if (parsed.length === 0) return { skip: true };
    days = parsed;
    rest = rest.slice(sel[0].length).trim();
  }
  rest = rest.replace(/\s+open$/i, '').trim();
  if (rest === '' || /^open$/i.test(rest)) return { days, intervals: [[0, 1440]] };
  if (/^(off|closed)$/i.test(rest)) return { days, intervals: [] };
  if (/^unknown$/i.test(rest)) return null;
  const intervals = [];
  for (const span of rest.split(/\s*,\s*/)) {
    const openEnd = span.endsWith('+');
    const body = openEnd ? span.slice(0, -1) : span;
    const [a, b] = body.split(/\s*-\s*/);
    const s = toMinutes(a);
    if (Number.isNaN(s)) return null;
    let e;
    if (b === undefined) {
      if (!openEnd) return null;
      e = 1440; // "18:00+" open end: assume until midnight
    } else {
      e = toMinutes(b);
      if (Number.isNaN(e)) return null;
    }
    if (e <= s) e += 1440; // past midnight
    intervals.push([s, e]);
  }
  return { days, intervals };
}

const cache = new Map();

/**
 * Parse an opening_hours string.
 * Returns { always: true } | { days: Array<Array<[startMin, endMin]>> } | null.
 */
export function parseOpeningHours(input) {
  if (!input || typeof input !== 'string') return null;
  if (cache.has(input)) return cache.get(input);
  const result = parseUncached(input);
  if (cache.size > 2000) cache.clear();
  cache.set(input, result);
  return result;
}

function parseUncached(input) {
  let s = input
    .replace(/"[^"]*"/g, '')
    .replace(/[–—~～]/g, '-')
    .replace(/：/g, ':')
    .replace(/\s+/g, ' ')
    // tolerate common mistakes: "mon-fri", "MO-FR", "Mon-Fri"
    .replace(/\b(mon|tue|wed|thu|fri|sat|sun)\b/gi, (d) => d.slice(0, 2))
    .replace(/\b(mo|tu|we|th|fr|sa|su|ph|sh)\b/gi, (d) => d[0].toUpperCase() + d[1].toLowerCase())
    .replace(/\bPh\b/g, 'PH')
    .replace(/\bSh\b/g, 'SH')
    .trim();
  if (!s) return null;
  if (/^24\/7\s*;?$/.test(s) || /^Mo-Su 00:00-24:00;?$/.test(s)) return { always: true };
  s = s.replace(/^24\/7\s*;\s*/, 'Mo-Su 00:00-24:00; ');
  const week = Array.from({ length: 7 }, () => null);
  let any = false;
  for (const { text, additional } of splitRules(s)) {
    if (!text) continue;
    if (MONTH_RE.test(text)) continue; // seasonal / holiday exceptions are ignored
    if (UNSUPPORTED_RE.test(text)) return null;
    const rule = parseRule(text);
    if (!rule) return null;
    if (rule.skip) continue;
    any = true;
    for (const d of rule.days) {
      week[d] = additional && week[d] ? week[d].concat(rule.intervals) : rule.intervals.slice();
    }
  }
  if (!any) return null;
  return { days: week.map((d) => (d || []).sort((a, b) => a[0] - b[0])) };
}

const fmtCache = new Map();
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Local weekday (0 = Monday) and minutes since midnight in a time zone. */
export function localTime(date = new Date(), timeZone) {
  const key = timeZone || '';
  let f = fmtCache.get(key);
  if (!f) {
    const opts = { weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' };
    try {
      f = new Intl.DateTimeFormat('en-US', timeZone ? { ...opts, timeZone } : opts);
    } catch {
      f = new Intl.DateTimeFormat('en-US', opts);
    }
    fmtCache.set(key, f);
  }
  const parts = f.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let h = +get('hour');
  if (h === 24) h = 0;
  return { day: WD[get('weekday')] ?? 0, minutes: h * 60 + +get('minute') };
}

/**
 * Current state for a parsed schedule.
 * Returns { open: boolean, closesAt?: minutes, opensAt?: minutes, opensDay?: 0-6 } or null.
 */
export function openState(parsed, date = new Date(), timeZone) {
  if (!parsed) return null;
  if (parsed.always) return { open: true, always: true };
  const { day, minutes } = localTime(date, timeZone);
  const today = parsed.days[day];
  const yesterday = parsed.days[(day + 6) % 7];
  for (const [s, e] of yesterday) {
    if (e > 1440 && minutes < e - 1440) return { open: true, closesAt: e - 1440 };
  }
  for (const [s, e] of today) {
    if (minutes >= s && minutes < e) return { open: true, closesAt: e % 1440 === 0 && e >= 1440 ? 1440 : e % 1440 };
  }
  // next opening within a week
  for (let i = 0; i < 7; i++) {
    const d = (day + i) % 7;
    for (const [s] of parsed.days[d]) {
      if (i > 0 || s > minutes) return { open: false, opensAt: s, opensDay: d, opensInDays: i };
    }
  }
  return { open: false };
}

/** Convenience: true / false / null (unknown). */
export function isOpenNow(ohString, date = new Date(), timeZone) {
  const st = openState(parseOpeningHours(ohString), date, timeZone);
  return st ? st.open : null;
}

export function formatMinutes(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${String(min === 1440 ? 24 : h).padStart(2, '0')}:${mm}`;
}

/** Seven display strings (Mon..Sun) like "11:00–15:00, 17:00–22:00" or "" when closed. */
export function weekRows(parsed) {
  if (!parsed) return null;
  if (parsed.always) return DAY_KEYS.map(() => '00:00–24:00');
  return parsed.days.map((iv) => iv.map(([s, e]) => `${formatMinutes(s)}–${formatMinutes(e > 1440 ? e - 1440 : e)}`).join(', '));
}
