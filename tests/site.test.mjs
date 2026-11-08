import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchRecords } from '../scripts/lib/build.mjs';
import { matchesQuery } from '../assets/js/core/text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir))) {
    const rel = path.posix.join(dir, e);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

const swFiles = [...read('sw.js').matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);

test('service worker precaches every app module and only existing files', () => {
  const modules = walk('assets/js').filter((f) => f.endsWith('.js'));
  for (const m of modules) assert.ok(swFiles.includes(m), `${m} missing from sw.js SHELL_FILES`);
  for (const f of swFiles) {
    if (f === './') continue;
    assert.ok(existsSync(path.join(ROOT, f)), `sw.js lists missing file ${f}`);
  }
  for (const f of walk('assets/i18n')) assert.ok(swFiles.includes(f), `${f} missing from sw.js`);
});

test('relative imports resolve', () => {
  for (const f of [...walk('assets/js'), ...walk('scripts').filter((x) => x.endsWith('.mjs'))]) {
    const src = read(f);
    for (const m of src.matchAll(/(?:import|from)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
      const target = path.join(ROOT, path.dirname(f), m[1]);
      assert.ok(existsSync(target), `${f} imports missing ${m[1]}`);
    }
  }
});

test('index.html and manifest reference existing files', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="((?:assets|data)\/[^"#?]+)"/g)) {
    assert.ok(existsSync(path.join(ROOT, m[1])), `index.html references missing ${m[1]}`);
  }
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const icon of manifest.icons) assert.ok(existsSync(path.join(ROOT, icon.src)), icon.src);
});

test('committed fallback data is consistent', () => {
  const index = JSON.parse(read('data/index.json'));
  const catalog = JSON.parse(read('data/search.json'));
  const expected = new Map();
  assert.equal(index.v, 1);
  for (const [key, v] of Object.entries(index.cells)) {
    const file = `data/cells/${key}.json`;
    assert.ok(existsSync(path.join(ROOT, file)), file);
    const places = JSON.parse(read(file));
    assert.equal(places.length, v[0] + v[4], `${file} count`);
    for (const p of places) {
      assert.ok(p.id && Number.isFinite(p.y) && Number.isFinite(p.x) && p.k, `${file}: bad place ${JSON.stringify(p)}`);
      if (p.k !== 'p') assert.ok(['C', 'O', 'Y', 'F', 'L', 'U'].includes(p.s), `${file}: ${p.id} status ${p.s}`);
    }
    for (const row of searchRecords(places)) expected.set(row.id, JSON.parse(JSON.stringify(row)));
  }
  assert.equal(catalog.length, index.stats.food);
  assert.equal(new Set(catalog.map((p) => p.id)).size, catalog.length);
  for (const row of catalog) assert.deepEqual(row, expected.get(row.id));
  assert.ok(catalog.some((row) => matchesQuery(row, 'mandi a l’agneau') && row.id === 'kto-asalam-jeju'));
});

test('Korean source files carry license and source metadata', () => {
  for (const f of walk('data/sources').filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(read(f));
    assert.ok(j.url && j.license && j.title && Array.isArray(j.places), f);
    const ids = new Set(j.places.map((p) => p.id));
    assert.equal(ids.size, j.places.length, `${f} has duplicate ids`);
  }
});
