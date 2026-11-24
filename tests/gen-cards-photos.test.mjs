// gen-cards.mjs writes photos[] for the gallery (PR #93 precondition): extra QC files <bc>_2.jpg ... only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCards, galleryPhotos } from '../scripts/gen-cards.mjs';

const item = (bc, extra = {}) => ({ barcode: bc, name_status: 'final', tab: 'Hair', family: 'F', customer_name_en: 'Line — Short', tone_group: 'x', ...extra });

test('no extra file: no photos key (cards.json unchanged)', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'gc-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, '111.jpg'), 'x');
  assert.equal(galleryPhotos('111', 'Short', d), null);
  assert.equal(galleryPhotos('111', 'Short', null), null);
});

test('extra files: photos[0] = main photo, consecutive _n files, qc true, photo 1 has no ai, extras take gallery_ai (required)', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'gc-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  for (const f of ['222.jpg', '222_2.jpg', '222_3.jpg', '222_5.jpg']) writeFileSync(join(d, f), 'x');
  assert.throws(() => galleryPhotos('222', 'Short', d), /gallery_ai \(true\/false\) is required for 222/);
  const p = galleryPhotos('222', 'Short', d, false);
  assert.deepEqual(p.map((x) => x.src), ['/img/fam/222.jpg', '/img/fam/222_2.jpg', '/img/fam/222_3.jpg']);
  assert.ok(p.every((x) => x.qc === true));
  assert.ok(!('ai' in p[0]), 'photo 1 follows the card ai_image');
  assert.deepEqual(p.slice(1).map((x) => x.ai), [false, false]);
  assert.equal(p[1].alt, 'Short, photo 2');
});

test('buildCards: photos only when the main photo passed QC', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'gc-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  for (const f of ['333.jpg', '333_2.jpg', '444_2.jpg']) writeFileSync(join(d, f), 'x');
  const cards = buildCards([item('333', { gallery_ai: false }), item('444')], d);
  const [a, b] = cards;
  assert.equal(a.photos[0].src, a.photo);
  assert.equal(a.photos.length, 2);
  assert.equal(b.photo, null);
  assert.ok(!('photos' in b));
});

test('K&D #93 B1: ai_image card + gallery_ai false -> slide 1 still labelled AI, the real extra photos not', () => {
  const SF = readFileSync(new URL('../js/storefront.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const CORE = SF.match(/\/\*KL-SF-CORE-START\*\/([\s\S]*?)\/\*KL-SF-CORE-END\*\//)[1];
  const { sfGallery } = new Function(`${CORE}; return { sfGallery };`)();
  const c = { name: 'N', line: 'L', ai_image: true };
  const ps = [{ src: '/a.jpg', qc: true, ai: false }, { src: '/b.jpg', qc: true, ai: false }, { src: '/c.jpg', qc: true, ai: false }];
  const slides = sfGallery(c, ps).split('class="kl-slide"').slice(1);
  assert.deepEqual(slides.map((x) => x.includes('AI-styled image')), [true, false, false]);
  const real = sfGallery({ ...c, ai_image: false }, ps).split('class="kl-slide"').slice(1);
  assert.deepEqual(real.map((x) => x.includes('AI-styled image')), [false, false, false]);
});
