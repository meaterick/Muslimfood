// Convert the Korean free-text opening hours used in Korean public datasets
// (e.g. "화-목 17시-23시,금 17시-24시", "11시30분-21시30분") to OSM
// opening_hours syntax so the app can compute "open now".

const KDAY = { 월: 'Mo', 화: 'Tu', 수: 'We', 목: 'Th', 금: 'Fr', 토: 'Sa', 일: 'Su' };
const DAYS = '[월화수목금토일]';
const DAY_SEL = `(?:${DAYS}(?:-${DAYS})?)(?:,${DAYS}(?:-${DAYS})?)*`;
const TIME = '\\d{1,2}시(?:\\s*\\d{1,2}분)?';
const SPAN = `${TIME}\\s*-\\s*${TIME}`;
const GROUP_RE = new RegExp(`(${DAY_SEL})?\\s*((?:${SPAN}\\s*)+)`, 'g');

function time(t) {
  const m = /(\d{1,2})시(?:\s*(\d{1,2})분)?/.exec(t);
  if (!m) return null;
  const h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 30 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function days(sel) {
  return sel
    .split(',')
    .map((p) => p.split('-').map((d) => KDAY[d]).join('-'))
    .join(',');
}

/**
 * @param {string} text Korean hours text
 * @param {string} defaultDays OSM weekday selector used when the text has none ("Mo-Fr" / "Sa-Su")
 * @returns {string|null} OSM opening_hours fragment, or null when unknown
 */
export function koreanHoursToOsm(text, defaultDays) {
  const t = String(text || '').trim();
  if (!t || t === '정보없음' || t === '-') return null;
  if (/^(휴무|휴일|정기휴무)$/.test(t)) return `${defaultDays} off`;
  if (/^(24시간|연중무휴\s*24시간)$/.test(t)) return `${defaultDays} 00:00-24:00`;
  const rules = [];
  let consumed = '';
  GROUP_RE.lastIndex = 0;
  let m;
  while ((m = GROUP_RE.exec(t))) {
    if (!m[0].trim()) {
      GROUP_RE.lastIndex++;
      continue;
    }
    consumed += m[0];
    const sel = m[1] ? days(m[1]) : defaultDays;
    const spans = [];
    for (const s of m[2].matchAll(new RegExp(SPAN, 'g'))) {
      const [a, b] = s[0].split('-');
      const ta = time(a);
      const tb = time(b);
      if (!ta || !tb) return null;
      spans.push(`${ta}-${tb}`);
    }
    if (!spans.length) return null;
    rules.push(`${sel} ${spans.join(',')}`);
  }
  // Refuse partial parses: everything except separators must be understood.
  const leftover = t.replace(GROUP_RE, '').replace(/[\s,]/g, '');
  if (!rules.length || leftover) return null;
  return rules.join('; ');
}

/** Combine weekday + weekend fields into one opening_hours value. */
export function combineKoreanHours(weekday, weekend) {
  const a = koreanHoursToOsm(weekday, 'Mo-Fr');
  const b = koreanHoursToOsm(weekend, 'Sa-Su');
  if (!a && !b) return null;
  // If only one half is known we cannot claim the other half is closed.
  if (!a || !b) return null;
  return `${a}; ${b}`;
}
