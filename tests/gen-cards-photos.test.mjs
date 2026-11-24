// gen-cards.mjs writes photos[] for the gallery (PR #93 precondition): extra QC files <bc>_2.jpg ... only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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

test('extra files: photos[0] = main photo, consecutive _n files, qc true, ai only when given', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'gc-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  for (const f of ['222.jpg', '222_2.jpg', '222_3.jpg', '222_5.jpg']) writeFileSync(join(d, f), 'x');
  const p = galleryPhotos('222', 'Short', d);
  assert.deepEqual(p.map((x) => x.src), ['/img/fam/222.jpg', '/img/fam/222_2.jpg', '/img/fam/222_3.jpg']);
  assert.ok(p.every((x) => x.qc === true && !('ai' in x)));
  assert.equal(p[1].alt, 'Short, photo 2');
  assert.ok(galleryPhotos('222', 'S', d, false).every((x) => x.ai === false));
});

test('buildCards: photos only when the main photo passed QC', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'gc-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  for (const f of ['333.jpg', '333_2.jpg', '444_2.jpg']) writeFileSync(join(d, f), 'x');
  const cards = buildCards([item('333'), item('444')], d);
  const [a, b] = cards;
  assert.equal(a.photos[0].src, a.photo);
  assert.equal(a.photos.length, 2);
  assert.equal(b.photo, null);
  assert.ok(!('photos' in b));
});
