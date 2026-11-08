// Deep links into map apps. In South Korea, Google Maps cannot give walking or
// driving directions, so Naver Map and Kakao Map come first there.

import { isInKorea } from './geo.js';

const enc = encodeURIComponent;

function bestName(p, lang) {
  return (p.nl && (p.nl[lang] || p.nl.en)) || p.n || '';
}

/** Short Korean district part ("용산구", "해운대구") from a Korean address. */
export function koreanDistrict(address) {
  if (!address) return '';
  const m = /([가-힣]+[시군구])\s+([가-힣]+[구])?/.exec(address);
  if (!m) return '';
  return (m[2] || m[1]).trim();
}

// Approximate (geocoded) or unnamed places are better found by address text.
const byAddress = (p) => Boolean(p.a && (p.ap || !p.n));

export function naverLink(p) {
  const name = (p.nl && p.nl.ko) || p.n;
  const q = byAddress(p) && !name ? p.a : [name, koreanDistrict(p.a)].filter(Boolean).join(' ');
  return `https://map.naver.com/p/search/${enc(q || `${p.y},${p.x}`)}`;
}

export function kakaoLink(p) {
  if (byAddress(p)) return `https://map.kakao.com/link/search/${enc(p.n ? `${p.n} ${koreanDistrict(p.a)}`.trim() : p.a)}`;
  // Kakao uses commas as separators inside the path.
  const name = ((p.nl && p.nl.ko) || p.n || 'Place').replace(/,/g, ' ');
  return `https://map.kakao.com/link/map/${enc(name)},${p.y},${p.x}`;
}

export function kakaoRouteLink(p) {
  if (byAddress(p)) return kakaoLink(p);
  const name = ((p.nl && p.nl.ko) || p.n || 'Place').replace(/,/g, ' ');
  return `https://map.kakao.com/link/to/${enc(name)},${p.y},${p.x}`;
}

export function googleLink(p) {
  const q = p.n ? `${p.n} ${p.a || ''}`.trim() : p.a || `${p.y},${p.x}`;
  return `https://www.google.com/maps/search/?api=1&query=${enc(q)}`;
}

export function googleRouteLink(p) {
  const dest = byAddress(p) ? enc(p.a) : `${p.y},${p.x}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

export function appleLink(p, lang = 'en') {
  return `https://maps.apple.com/?q=${enc(bestName(p, lang) || 'Place')}&ll=${p.y},${p.x}`;
}

export function appleRouteLink(p) {
  return `https://maps.apple.com/?daddr=${p.y},${p.x}`;
}

export function osmLink(p) {
  const m = /^([nwr])(\d+)$/.exec(p.id || '');
  if (!m) return `https://www.openstreetmap.org/?mlat=${p.y}&mlon=${p.x}#map=19/${p.y}/${p.x}`;
  const type = { n: 'node', w: 'way', r: 'relation' }[m[1]];
  return `https://www.openstreetmap.org/${type}/${m[2]}`;
}

/** Link to add an anonymous OpenStreetMap note at the place (report a problem). */
export function osmNoteLink(p) {
  return `https://www.openstreetmap.org/note/new#map=19/${p.y}/${p.x}`;
}

export function osmEditLink(p) {
  const m = /^([nwr])(\d+)$/.exec(p.id || '');
  if (!m) return `https://www.openstreetmap.org/edit#map=19/${p.y}/${p.x}`;
  const type = { n: 'node', w: 'way', r: 'relation' }[m[1]];
  return `https://www.openstreetmap.org/edit?${type}=${m[2]}`;
}

export function isAppleDevice(ua = globalThis.navigator?.userAgent || '') {
  return /iPhone|iPad|iPod|Macintosh/.test(ua);
}

/**
 * Ordered list of map apps for a place: [{ id, label, href, route }].
 * Korea: Naver, Kakao, Google (+Apple on Apple devices). Elsewhere: Google, Apple.
 */
const APP_LABELS = {
  ko: { naver: '네이버 지도', kakao: '카카오맵', google: '구글 지도', apple: '애플 지도' },
  default: { naver: 'Naver Map', kakao: 'Kakao Map', google: 'Google Maps', apple: 'Apple Maps' },
};

export function mapApps(p, { lang = 'en', apple = isAppleDevice() } = {}) {
  const L = APP_LABELS[lang] || APP_LABELS.default;
  const google = { id: 'google', label: L.google, href: googleLink(p), route: googleRouteLink(p) };
  const appleApp = { id: 'apple', label: L.apple, href: appleLink(p, lang), route: appleRouteLink(p) };
  if (isInKorea(p.y, p.x)) {
    const apps = [
      { id: 'naver', label: L.naver, href: naverLink(p), route: naverLink(p) },
      { id: 'kakao', label: L.kakao, href: kakaoLink(p), route: kakaoRouteLink(p) },
      google,
    ];
    if (apple) apps.push(appleApp);
    return apps;
  }
  return apple ? [appleApp, google] : [google, appleApp];
}
