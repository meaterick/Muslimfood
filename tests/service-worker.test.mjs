import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('activating the MUFKO update drops old cells and keeps the new offline data and tiles', async () => {
  const handlers = new Map();
  const keys = new Set(['mf-shell-v11', 'mf-data-v1', 'mf-data-v2', 'mf-tiles-v1', 'another-app']);
  let claimed = false;
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    self: {
      addEventListener: (name, fn) => handlers.set(name, fn),
      clients: { claim: async () => { claimed = true; } },
    },
    caches: {
      keys: async () => [...keys],
      delete: async (key) => keys.delete(key),
    },
  });
  let activation;
  handlers.get('activate')({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.ok(!keys.has('mf-data-v1'), 'pre-MUFKO cells must not hide the new restaurants');
  assert.ok(!keys.has('mf-shell-v11'));
  assert.ok(keys.has('mf-data-v2'));
  assert.ok(keys.has('mf-tiles-v1'));
  assert.ok(keys.has('another-app'));
  assert.ok(claimed);
});
