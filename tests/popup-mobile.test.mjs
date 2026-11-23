import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.slice(html.indexOf('/* EMAIL POPUP:'), html.indexOf('</script>', html.indexOf('/* EMAIL POPUP:')));

test('popup: touch trigger at 50% scroll or 30 s', () => {
  assert.match(block, /\(hover: none\), \(pointer: coarse\)/);
  assert.match(block, /setTimeout\(fire, 30000\)/);
  assert.match(block, />=0\.5/);
});
test('popup: 7-day cap unchanged and checked before firing', () => {
  assert.match(block, /INTERVAL=7\*24\*3600\*1000/);
  assert.match(block, /function fire\(\)\{ if\(fired \|\| !canShow\(\)\) return;/);
});
test('popup: never opens over an open modal/bag (#ovl)', () => {
  assert.match(block, /function busy\(\)/);
  assert.match(block, /cookie-banner/);
  assert.match(block, /if\(busy\(\)\)\{ setTimeout\(show, 4000\)/);
});
test('popup: desktop exit-intent kept', () => {
  assert.match(block, /mouseleave/);
});
test('popup: consent/form markup unchanged', () => {
  assert.match(html, /<button class="klpop-submit" id="klpopBtn" onclick="submitEmailPopup\(\)">Notify Me<\/button>/);
});

test('popup: no unverified claims, privacy link at collection (K&D N1/N2)', () => {
  const pop = html.slice(html.indexOf('<div class="klpop"'), html.indexOf('<script>', html.indexOf('<div class="klpop"')));
  assert.doesNotMatch(pop, /limited edition|exclusive|early access/i);
  assert.match(pop, /href="\/privacy\.html"[^>]*>Privacy<\/a>/);
});
