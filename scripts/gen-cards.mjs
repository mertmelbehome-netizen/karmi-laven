// scripts/gen-cards.mjs — builds data/cards.json (family card IDENTITY only: tab, family, name, tone, photo, photos[]) from the
// wave-1 config JSON (online-marketing, 2026-11-22_karmi_wave1_config.json v2.1).
//   node scripts/gen-cards.mjs <wave1_config.json> [--photos <dir with <barcode>.jpg that PASSED photo QC>]
//
// Prices, stock, caps and "sellable" are NEVER in this file: the page reads them live from /api/stock.
// Rules (03_categories §2, 05_pr_scope §1, vitrin 01 §5):
//   - only rows with name_status = "final" (numbered "No. 1476" names are not listed until photo + name QC);
//   - photo is set ONLY for a barcode whose QC-passed file exists in --photos (copied to img/fam/<bc>.jpg by hand);
//     no photo = the card is a "Photo coming" colour tile and cannot be added to the bag (K-03). No photo is invented.
//   - customer-facing name must not contain " · " (Stripe line name separator) or forbidden words (K-08).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAB = { Bracelets: 'bracelets', Necklaces: 'necklaces', Hair: 'hair' };
// tone_group -> flat tile colour (a guide only, labelled "Colour tile is a guide only"; never presented as a photo)
const TONE = { blue: '#a9c3e3', pink: '#e9b9c6', purple: '#c9b6de', green_teal: '#a9d6c0', brown_beige: '#c9a882',
  grey_black: '#8e8a86', white_clear: '#e8ecee', gold_tone: '#d9c08a', multi: '#d2c4d8' };
export const FORBIDDEN = /(diamond|lux stone|genuine|real (gold|silver)|sterling|14ct|hypoallergenic|nickel[- ]free|waterproof|hand-strung|crystal)/i;

// Gallery (PR #93): extra QC-passed photos sit next to the main one as <barcode>_2.jpg, <barcode>_3.jpg ... in the
// same --photos dir (copied by hand to img/fam/). photos[0] is always the main photo, so the storefront's rule
// (photos[0].src === photo, >= 2 entries with qc) holds. No extra file = no photos[] key = the card JSON is unchanged.
// ai: photo 1 (the main photo) never carries ai: the storefront labels it from the card's ai_image (K&D #93 B1).
// The extra photos take the wave-1 item's gallery_ai (true/false), which is REQUIRED once extra files exist (N1).
// Rule for the pilot (N2): a file in --photos counts as QC-passed; only put photos there that passed photo QC.
export const MAX_GALLERY = 6;
export function galleryPhotos(bc, name, photoDir, galleryAi) {
  if (!photoDir) return null;
  const extra = [];
  for (let n = 2; n <= MAX_GALLERY; n++) {
    if (!existsSync(join(photoDir, `${bc}_${n}.jpg`))) break;
    extra.push(n);
  }
  if (!extra.length) return null;
  if (typeof galleryAi !== 'boolean') throw new Error(`gallery_ai (true/false) is required for ${bc}: it has extra photos`);
  const mk = (src, n) => {
    const e = { src, type: n === 1 ? 'main' : 'gallery', alt: `${name}, photo ${n}`, qc: true };
    if (n > 1) e.ai = galleryAi;
    return e;
  };
  return [mk(`/img/fam/${bc}.jpg`, 1), ...extra.map((n) => mk(`/img/fam/${bc}_${n}.jpg`, n))];
}

// PHOTO-MIX RULE v1 trial (D-004, 26 Nov): the wave-1 item's optional gallery_lead (index into photos[], >= 1) becomes the
// card's `lead`: the storefront shows that photo first (photos[0] stays the main photo). Which cards lead with a close-up
// is chosen by scripts/photo-mix.mjs --solve and checked by tests/photo-mix-lead.test.mjs. No gallery_lead = no lead key.
export function leadOf(bc, photos, galleryLead) {
  if (galleryLead == null || galleryLead === 0) return null;
  if (!Number.isInteger(galleryLead) || galleryLead < 1 || !photos || galleryLead >= photos.length) throw new Error(`gallery_lead ${galleryLead} for ${bc}: must point at one of its extra photos (1..${photos ? photos.length - 1 : 0})`);
  return galleryLead;
}

export function buildCards(items, photoDir = null) {
  const out = [];
  for (const it of items) {
    if (it.name_status !== 'final') continue;
    const tab = TAB[it.tab];
    if (!tab) throw new Error(`unknown tab ${it.tab} (${it.barcode})`);
    const nm = String(it.customer_name_en || '');
    const [line, short] = nm.includes(' — ') ? nm.split(' — ') : [nm, ''];
    const bc = String(it.barcode);
    if (!/^[0-9A-Za-z]+$/.test(bc)) throw new Error(`bad barcode ${bc}`);
    if (nm.includes(' · ')) throw new Error(`name contains " · ": ${nm}`);
    if (FORBIDDEN.test(nm)) throw new Error(`forbidden word in name: ${nm}`);
    const qc = !!(photoDir && existsSync(join(photoDir, `${bc}.jpg`)));
    const card = { barcode: bc, tab, family: it.family, line, name: short || line, swatch: TONE[it.tone_group] || '#d8d2c8',
      photo: qc ? `/img/fam/${bc}.jpg` : null, photo_qc: qc };
    const photos = qc ? galleryPhotos(bc, short || line, photoDir, it.gallery_ai) : null;
    if (photos) card.photos = photos;
    const lead = leadOf(bc, photos, it.gallery_lead);
    if (lead) card.lead = lead;
    out.push(card);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cfgPath, ...rest] = process.argv.slice(2);
  if (!cfgPath) { console.error('usage: node scripts/gen-cards.mjs <wave1_config.json> [--photos <dir>]'); process.exit(2); }
  const pi = rest.indexOf('--photos');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const cards = buildCards(cfg.items, pi >= 0 ? rest[pi + 1] : null);
  const doc = { _doc: 'Family card identity for the storefront (PR-2). Generated by scripts/gen-cards.mjs from the wave-1 config; prices/stock/caps come live from /api/stock. photo=null => "Photo coming" tile, not sellable.',
    version: cfg.meta && cfg.meta.version ? String(cfg.meta.version) : 'wave1', cards };
  writeFileSync(join(ROOT, 'data', 'cards.json'), JSON.stringify(doc, null, 1) + '\n');
  console.log(`cards ${cards.length}`, Object.entries(cards.reduce((a, c) => ((a[c.tab] = (a[c.tab] || 0) + 1), a), {})),
    'with QC photo', cards.filter((c) => c.photo_qc).length);
}
