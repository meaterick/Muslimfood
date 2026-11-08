import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'i18n');
const load = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const PLURAL_KEYS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/** Flatten to "a.b.c" keys; plural objects ({one, other}) count as one leaf. */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      if (Object.keys(v).every((x) => PLURAL_KEYS.has(x))) out[key] = v;
      else flatten(v, key, out);
    } else out[key] = v;
  }
  return out;
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const en = flatten(load('en.json'));
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('every language file has every English key with the same placeholders', () => {
  assert.ok(files.length >= 6, files.join());
  for (const f of files) {
    const lang = path.basename(f, '.json');
    const tr = flatten(load(f));
    const missing = Object.keys(en).filter((k) => !(k in tr));
    assert.deepEqual(missing, [], `${f} is missing keys`);
    const extra = Object.keys(tr).filter((k) => !(k in en));
    assert.deepEqual(extra, [], `${f} has unknown keys`);
    for (const [k, v] of Object.entries(en)) {
      const a = typeof v === 'object' ? v.other : v;
      const tv = tr[k];
      if (typeof v === 'object') {
        assert.equal(typeof tv, 'object', `${f}:${k} must be a plural object`);
        assert.ok('other' in tv, `${f}:${k} needs an "other" form`);
        const rules = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
        for (const form of Object.keys(tv)) assert.ok(rules.includes(form) || form === 'zero', `${f}:${k} has form ${form} not used by ${lang}`);
        for (const form of Object.values(tv)) {
          if (form.includes('{')) assert.equal(placeholders(form), placeholders(a), `${f}:${k} placeholders`);
        }
      } else {
        assert.equal(typeof tv, 'string', `${f}:${k}`);
        assert.ok(tv.trim().length > 0, `${f}:${k} is empty`);
        assert.equal(placeholders(tv), placeholders(v), `${f}:${k} placeholders`);
      }
    }
  }
});

test('meta direction is set correctly', () => {
  for (const f of files) {
    const meta = load(f).meta;
    assert.equal(meta.dir, f === 'ar.json' ? 'rtl' : 'ltr', f);
  }
});
