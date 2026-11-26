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
test('families first screen is drawn from cards.json before /api/stock: no price, disabled button, label kept', () => {
  assert.match(sf, /function sfPreviewHTML/);
  assert.match(sf, /loadCards\(\)\.then\(function \(\) \{ try \{ renderPreview\(\)/);
  const fn = sf.slice(sf.indexOf('function sfPreviewHTML'), sf.indexOf('function renderPreview'));
  assert.match(fn, /disabled aria-disabled="true">Loading prices/);
  assert.match(fn, /AI-styled image/);
  assert.doesNotMatch(fn, /sfMoney|unitPrice|£/);
});
test('a rejecting stock refresh still reaches the render (preview never stuck)', () => {
  assert.match(sf, /return refresh\(\); \}, function \(\) \{ stockErr = true; \}\)\.catch\(function \(\) \{ stockErr = true; \}\)\.then\(function \(\) \{/);
});
