// K&D B1 (24 Nov 2026): regex lookbehind ("(?<=" / "(?<!") is a SyntaxError on iOS Safari <= 16.3 and
// would break the whole bag/checkout script there. Keep it out of everything the browser loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['index.html', ...readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f)];

test('no regex lookbehind in index.html or js/*.js (iOS <= 16.3)', () => {
  for (const f of files) {
    const src = readFileSync(path.join(root, f), 'utf8');
    assert.ok(!src.includes('(?<='), f + ' contains a lookbehind (?<=');
    assert.ok(!src.includes('(?<!'), f + ' contains a negative lookbehind (?<!');
  }
});

test('E1c free-delivery claim rewrite works without lookbehind', () => {
  const N = ' non-ring', SN = ' (rings included)';
  const nr = (s) => s.replace(/(free with any )?\b(\d+\+|\d+ or more) items/g, (m, pre, n) => (pre ? m : n + N + ' items')).replace(/(free with any \d+\+ items)/g, '$1' + SN);
  assert.equal(nr('70% off when you buy any 10+ items'), '70% off when you buy any 10+ non-ring items');
  assert.equal(nr('free with any 10+ items'), 'free with any 10+ items (rings included)');
  assert.equal(nr('buy 10 or more items, free with any 10+ items'), 'buy 10 or more non-ring items, free with any 10+ items (rings included)');
});
