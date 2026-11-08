// Small DOM and browser helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** localStorage that never throws (private mode, blocked storage, ...). */
export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(`mf:${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`mf:${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

let toastTimer;
/** Show a short status message (announced to screen readers). */
export function toast(message, { action, onAction, duration = 3500 } = {}) {
  const el = $('#toast');
  if (!el) return;
  el.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    b.addEventListener('click', () => {
      el.hidden = true;
      onAction?.();
    });
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(() => (el.hidden = true), duration);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Load a classic script once. */
const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.append(s);
      }),
    );
  }
  return scripts.get(src);
}

export function loadStyle(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.append(l);
}

/** Phone number as a tel: link; Korean national numbers get +82 for roaming phones. */
export function telHref(phone, inKorea) {
  let p = String(phone).replace(/[^\d+]/g, '');
  if (inKorea && /^0\d{8,10}$/.test(p)) p = `+82${p.slice(1)}`;
  return `tel:${p}`;
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
