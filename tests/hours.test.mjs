import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpeningHours, openState, isOpenNow, weekRows, localTime } from '../assets/js/core/hours.js';
import { koreanHoursToOsm, combineKoreanHours } from '../scripts/lib/kr-hours.mjs';

// 2026-11-09 is a Monday. Use explicit time zones so tests do not depend on the machine.
const at = (iso) => new Date(iso);
const SEOUL = 'Asia/Seoul';

test('24/7 is always open', () => {
  assert.deepEqual(parseOpeningHours('24/7'), { always: true });
  assert.equal(isOpenNow('24/7', at('2026-11-09T03:00:00Z'), SEOUL), true);
});

test('weekday ranges and times', () => {
  const p = parseOpeningHours('Mo-Fr 09:00-18:00; Sa 10:00-14:00');
  assert.deepEqual(p.days[0], [[540, 1080]]);
  assert.deepEqual(p.days[5], [[600, 840]]);
  assert.deepEqual(p.days[6], []);
  // Monday 10:00 Seoul = 01:00Z
  assert.equal(isOpenNow('Mo-Fr 09:00-18:00; Sa 10:00-14:00', at('2026-11-09T01:00:00Z'), SEOUL), true);
  // Sunday 12:00 Seoul
  assert.equal(isOpenNow('Mo-Fr 09:00-18:00; Sa 10:00-14:00', at('2026-11-08T03:00:00Z'), SEOUL), false);
});

test('split shifts and later rules override earlier ones', () => {
  const p = parseOpeningHours('Mo-Su 11:00-15:00,17:00-22:00; Tu off');
  assert.deepEqual(p.days[0], [[660, 900], [1020, 1320]]);
  assert.deepEqual(p.days[1], []);
  // Monday 16:00 Seoul is between shifts
  const st = openState(p, at('2026-11-09T07:00:00Z'), SEOUL);
  assert.equal(st.open, false);
  assert.equal(st.opensAt, 1020);
});

test('past midnight spans count for the next morning', () => {
  const oh = 'Fr-Sa 18:00-02:00';
  // Saturday 01:00 Seoul = Friday 16:00Z
  assert.equal(isOpenNow(oh, at('2026-11-13T16:00:00Z'), SEOUL), true);
  // Saturday 03:00 Seoul
  assert.equal(isOpenNow(oh, at('2026-11-13T18:00:00Z'), SEOUL), false);
  const st = openState(parseOpeningHours(oh), at('2026-11-13T16:00:00Z'), SEOUL);
  assert.equal(st.closesAt, 120);
});

test('additional rules with comma and holiday rules', () => {
  const p = parseOpeningHours('Mo-Fr 08:00-12:00, We 14:00-18:00; PH off');
  assert.deepEqual(p.days[2], [[480, 720], [840, 1080]]);
  assert.deepEqual(p.days[0], [[480, 720]]);
});

test('tolerates common mistakes', () => {
  assert.deepEqual(parseOpeningHours('mon-fri 9:00-18:00').days[0], [[540, 1080]]);
  assert.deepEqual(parseOpeningHours('Mo-Fr: 10:00-20:00').days[4], [[600, 1200]]);
});

test('unsupported syntax returns null instead of guessing', () => {
  assert.equal(parseOpeningHours('Mo-Fr sunrise-sunset'), null);
  assert.equal(parseOpeningHours('week 1-20 Mo-Fr 10:00-12:00'), null);
  assert.equal(parseOpeningHours('by appointment'), null);
  assert.equal(parseOpeningHours(''), null);
  assert.equal(isOpenNow('garbage', new Date()), null);
});

test('month rules are ignored, leaving the regular schedule', () => {
  const p = parseOpeningHours('Mo-Su 10:00-22:00; Dec 25 off');
  assert.deepEqual(p.days[3], [[600, 1320]]);
});

test('weekRows formats intervals', () => {
  const rows = weekRows(parseOpeningHours('Mo-Fr 11:30-21:00; Sa 18:00-02:00'));
  assert.equal(rows[0], '11:30–21:00');
  assert.equal(rows[5], '18:00–02:00');
  assert.equal(rows[6], '');
});

test('localTime respects time zone', () => {
  const t = localTime(at('2026-11-09T15:30:00Z'), SEOUL); // Tue 00:30 in Seoul
  assert.equal(t.day, 1);
  assert.equal(t.minutes, 30);
});

test('Korean public-data hours convert to OSM syntax', () => {
  assert.equal(koreanHoursToOsm('화-목 17시-23시,금 17시-24시', 'Mo-Fr'), 'Tu-Th 17:00-23:00; Fr 17:00-24:00');
  assert.equal(koreanHoursToOsm('11시30분-21시30분', 'Mo-Fr'), 'Mo-Fr 11:30-21:30');
  assert.equal(koreanHoursToOsm('월,수,목,금 10시40분-20시30분', 'Mo-Fr'), 'Mo,We,Th,Fr 10:40-20:30');
  assert.equal(koreanHoursToOsm('11시-15시 17시-22시', 'Sa-Su'), 'Sa-Su 11:00-15:00,17:00-22:00');
  assert.equal(koreanHoursToOsm('휴무', 'Sa-Su'), 'Sa-Su off');
  assert.equal(koreanHoursToOsm('정보없음', 'Mo-Fr'), null);
  assert.equal(koreanHoursToOsm('브레이크타임 있음', 'Mo-Fr'), null);
  const combined = combineKoreanHours('월-금 11시-21시', '토-일 12시-22시');
  assert.equal(combined, 'Mo-Fr 11:00-21:00; Sa-Su 12:00-22:00');
  assert.ok(parseOpeningHours(combined));
  assert.equal(combineKoreanHours('월-금 11시-21시', '정보없음'), null);
});
