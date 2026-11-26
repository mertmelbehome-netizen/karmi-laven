import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sf = readFileSync(new URL('../js/storefront.js', import.meta.url), 'utf8');
test('default grid: first card photo is eager + high priority, later ones lazy', () => {
  assert.match(html, /\$\{i<2\?\(i\?'loading="eager"':'loading="eager" fetchpriority="high"'\):'loading="lazy"'\}/);
});
test('families grid: first card photo is made eager + high priority', () => {
  assert.match(sf, /g\.querySelector\('img\[loading="lazy"\]'\)[\s\S]{0,200}fetchpriority/);
});
