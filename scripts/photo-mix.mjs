// scripts/photo-mix.mjs — PHOTO-MIX RULE v1 trial (D-004, owner principle; K&D yes with conditions, 26 Nov 2026).
//   node scripts/photo-mix.mjs              per-tab scene sequence (mobile 2-column grid) BEFORE (photos[0]) and AFTER (lead)
//   node scripts/photo-mix.mjs --solve      the minimum set of lead = close-up swaps that meets the rule (prints, never writes)
//   node scripts/photo-mix.mjs --json       the same as JSON (contact sheet / report input)
//
// v1 trial rule, in the order the owner gave it:
//   (b) no two NEIGHBOURING cards lead with a worn scene (the shared wrist template on bracelets, the shared neck
//       template on necklaces): neighbours = same row side by side, or the same column one row down, in the 2-column
//       phone grid (index.html .grid at <= 560 px). Diagonals are not neighbours in v1.
//   (c) a real photo leads where one exists (lead never moves off a real photo).
//   (a) first screen: >= 60 % of the first 8 cards lead with a non-worn image (plain / real / tile); at most 2 'plain'
//       leads in a row (reading order), so the page does not turn into a run of close-ups.
// Scenes come from data, not from pixels:
//   tile  = no QC main photo (colour tile)
//   real  = main photo with ai_image false
//   plain = a gallery close-up (photos[i>0] whose alt says close-up), or one of the product-only main photos below
//   wrist / neck = every other AI main photo (the shared on-body template); unknown lead images count as worn (safe side)
// Grid order = what js/storefront.js renderFam shows with every card priced and in stock: cards.json order, photo cards
// before colour tiles (sellable tiles before 'Photo coming' tiles). Live stock can move a sold-out card to the end.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Product-only main photos (no hand / neck), classified by eye from img/fam/<bc>.jpg on 26 Nov 2026 (contact sheet in
// orchestrator/outputs/2026-11-26_photo_mix_lead). A new card is NOT in this list, so it counts as worn until added.
export const PRODUCT_ONLY_MAIN = ['2000', '6008', '80012', '80043'];
export const COLS = 2;
export const FIRST = 8;
export const MIN_NON_WORN = 0.6;
export const MAX_PLAIN_RUN = 2;
// D-004: the owner's gold-tone Sparkle screenshot. These lead with their close-up whatever the sequence needs.
export const OWNER_LEADS = ['81004', '81006', '81013'];

const WORN = new Set(['wrist', 'neck']);
export const isWorn = (s) => WORN.has(s) || s === 'unknown';

/** Valid lead index into c.photos (the storefront rule, js/storefront.js sfLeadIdx): 0 unless an integer >= 1 that points
 *  at a qc:true entry of a card whose photos[0] is its QC main photo. */
export function leadIdx(c) {
  const ps = c && Array.isArray(c.photos) ? c.photos : null;
  if (!ps || !c.photo || !c.photo_qc || !ps.length || !ps[0] || ps[0].src !== c.photo) return 0;
  const n = c.lead;
  return Number.isInteger(n) && n > 0 && n < ps.length && ps[n] && ps[n].qc === true && typeof ps[n].src === 'string' ? n : 0;
}
/** Scene of photos[i] (i = 0: the main photo). */
export function sceneAt(c, i) {
  if (!c.photo || !c.photo_qc) return 'tile';
  if (i === 0) {
    if (c.ai_image !== true) return 'real';
    if (PRODUCT_ONLY_MAIN.includes(c.barcode)) return 'plain';
    return c.tab === 'necklaces' ? 'neck' : c.tab === 'bracelets' ? 'wrist' : 'unknown';
  }
  const p = c.photos[i];
  return p && /close-up/i.test(p.alt || '') ? 'plain' : 'unknown';
}
export const leadScene = (c, useLead = true) => sceneAt(c, useLead ? leadIdx(c) : 0);
/** The close-up a card could lead with (index), or 0. */
export function closeUpIdx(c) {
  if (!Array.isArray(c.photos) || !c.photo || !c.photo_qc || c.ai_image !== true) return 0;   // rule (c): never off a real photo
  for (let i = 1; i < c.photos.length; i++) if (c.photos[i] && c.photos[i].qc === true && sceneAt(c, i) === 'plain') return i;
  return 0;
}

/** Grid order of a tab (all priced, all in stock): photo cards, then sellable tiles, then 'Photo coming' tiles. */
export function gridOrder(cards, tab) {
  const rank = (c) => (c.photo && c.photo_qc ? 0 : c.tile_sellable === true ? 1 : 2);
  return cards.map((c, i) => ({ c, i })).filter((x) => x.c.tab === tab).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

/** Rule check of one scene sequence. Returns { pairs: [[i, j]], plainRuns: [[from, to]], firstShare, firstN }. */
export function checkSeq(seq, cols = COLS) {
  const pairs = [], plainRuns = [];
  for (let i = 0; i < seq.length; i++) {
    if (!isWorn(seq[i])) continue;
    if (i % cols !== cols - 1 && i + 1 < seq.length && isWorn(seq[i + 1])) pairs.push([i, i + 1]);
    if (i + cols < seq.length && isWorn(seq[i + cols])) pairs.push([i, i + cols]);
  }
  for (let i = 0; i < seq.length;) {
    let j = i; while (j < seq.length && seq[j] === 'plain') j++;
    if (j - i > MAX_PLAIN_RUN) plainRuns.push([i, j - 1]);
    i = j > i ? j : i + 1;
  }
  const first = seq.slice(0, FIRST), firstN = first.length;
  const firstShare = firstN ? first.filter((s) => !isWorn(s)).length / firstN : 1;
  return { pairs, plainRuns, firstShare, firstN };
}

/** Full report for a tab: sequence rows + violations. A worn pair is 'fixable' when either card has a close-up that does
 *  not lead yet; otherwise it is a data limit (no close-up on either card; v1 makes no new render). */
export function tabReport(cards, tab, useLead = true) {
  const order = gridOrder(cards, tab);
  const seq = order.map((c) => leadScene(c, useLead));
  const r = checkSeq(seq);
  const free = (c) => closeUpIdx(c) > 0 && (!useLead || leadIdx(c) === 0) && sceneAt(c, 0) !== 'plain';
  const pairs = r.pairs.map(([i, j]) => ({ a: order[i].barcode, b: order[j].barcode, i, j, fixable: free(order[i]) || free(order[j]) }));
  const firstFixable = order.slice(0, FIRST).some(free);
  return { tab, order: order.map((c, k) => ({ pos: k, barcode: c.barcode, name: c.name, line: c.line, scene: seq[k], lead: useLead ? leadIdx(c) : 0, canLead: closeUpIdx(c) })), seq, pairs, plainRuns: r.plainRuns, firstShare: r.firstShare, firstN: r.firstN, firstFixable };
}

/** Is the lead swap on order[k] needed? Reverting it (back to photos[0]) would create a worn neighbour pair, or drop
 *  the first screen under 60 %, or the owner asked for it (OWNER_LEADS). An unneeded swap is a failure (v1 = fewest swaps). */
export function swapNeeded(order, seq, k) {
  if (OWNER_LEADS.includes(order[k].barcode)) return 'owner';
  const rev = seq.slice(); rev[k] = sceneAt(order[k], 0);
  const a = checkSeq(seq), b = checkSeq(rev);
  if (b.pairs.length > a.pairs.length) return 'neighbour';
  if (k < FIRST && a.firstShare + 1e-9 >= MIN_NON_WORN && b.firstShare + 1e-9 < MIN_NON_WORN) return 'first screen';
  return '';
}

/** Checker failures for one tab (AFTER = shipped leads). Data limits (no close-up anywhere to swap) are reported, not failed. */
export function failures(rep) {
  const f = [];
  for (const p of rep.pairs) if (p.fixable) f.push(`${rep.tab}: neighbouring worn leads ${p.a} (pos ${p.i}) + ${p.b} (pos ${p.j}), a close-up could lead`);
  if (rep.firstShare + 1e-9 < MIN_NON_WORN && rep.firstFixable) f.push(`${rep.tab}: first ${rep.firstN} cards ${(rep.firstShare * 100).toFixed(0)} % non-worn (< 60 %) while a close-up there does not lead`);
  if (rep._cards) {
    const order = rep.order.map((o) => rep._cards[o.barcode]);
    for (const o of rep.order) if (o.lead && !swapNeeded(order, rep.seq, o.pos)) f.push(`${rep.tab}: ${o.barcode} leads with its close-up but does not need to (v1 = fewest swaps)`);
  }
  return f;
}
/** Data limits for one tab: unfixable worn pairs, first screen under 60 %, plain runs over 2 (forced by the swaps). */
export function limits(rep) {
  const l = [];
  for (const p of rep.pairs) if (!p.fixable) l.push(`worn pair ${p.a}+${p.b}: neither card has a close-up`);
  if (rep.firstShare + 1e-9 < MIN_NON_WORN) l.push(`first ${rep.firstN}: ${(rep.firstShare * 100).toFixed(0)} % non-worn, every close-up there already leads`);
  for (const [a, b] of rep.plainRuns) l.push(`${b - a + 1} plain leads in a row (${rep.order.slice(a, b + 1).map((o) => o.barcode).join(', ')}): each swap in it is needed (neighbour rule / owner) or the main photo is product-only`);
  return l;
}
export function report(cards, tab, useLead = true) {
  const rep = tabReport(cards, tab, useLead);
  rep._cards = Object.fromEntries(cards.map((c) => [c.barcode, c]));
  return rep;
}

/** Minimum-swap lead assignment for a tab (exhaustive over the close-up candidates; forced = barcodes that must swap).
 *  Score: fewest worn neighbour pairs, no plain run, first-screen share met, then fewest swaps. */
export function solve(cards, tab, forced = []) {
  const order = gridOrder(cards, tab);
  const cand = order.map((c, k) => ({ c, k, idx: closeUpIdx(c) })).filter((x) => x.idx && sceneAt(x.c, 0) !== 'plain');
  const base = order.map((c) => sceneAt(c, 0));
  let best = null;
  for (let m = 0; m < 1 << cand.length; m++) {
    if (cand.some((x, b) => forced.includes(x.c.barcode) && !(m >> b & 1))) continue;
    const seq = base.slice(); let swaps = 0;
    cand.forEach((x, b) => { if (m >> b & 1) { seq[x.k] = 'plain'; swaps++; } });
    const r = checkSeq(seq);
    const score = [r.pairs.length, r.plainRuns.length, r.firstShare + 1e-9 >= MIN_NON_WORN ? 0 : 1, swaps];
    if (!best || score < best.score || score.join() !== best.score.join() && cmp(score, best.score) < 0) best = { score, m, seq };
  }
  const lead = {}; cand.forEach((x, b) => { if (best.m >> b & 1) lead[x.c.barcode] = x.idx; });
  return { tab, lead, seq: best.seq, pairs: checkSeq(best.seq).pairs.map(([i, j]) => [order[i].barcode, order[j].barcode]), score: best.score };
}
function cmp(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

export const TABS = ['bracelets', 'necklaces'];
const ABBR = { wrist: 'W', neck: 'N', plain: 'P', real: 'R', tile: 'T', unknown: '?' };
export function grid(rep) {
  const rows = [];
  for (let i = 0; i < rep.order.length; i += COLS) rows.push(rep.order.slice(i, i + COLS).map((o) => `${ABBR[o.scene]} ${o.barcode}${o.lead ? '*' : ''}`.padEnd(10)).join(' '));
  return rows.map((r, k) => `  row ${String(k + 1).padStart(2)}  ${r}`).join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const CARDS = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')).cards;
  const args = process.argv.slice(2);
  if (args.includes('--solve')) {
    for (const t of TABS) console.log(JSON.stringify(solve(CARDS, t, OWNER_LEADS)));
  } else {
    const out = TABS.map((t) => ({ before: report(CARDS, t, false), after: report(CARDS, t, true) }));
    if (args.includes('--json')) { console.log(JSON.stringify(out.map((x) => ({ before: { ...x.before, _cards: undefined }, after: { ...x.after, _cards: undefined, failures: failures(x.after), limits: limits(x.after) } })), null, 1)); }
    else for (const { before, after } of out) for (const [label, rep] of [['BEFORE (photos[0])', before], ['AFTER (lead)', after]]) {
      console.log(`\n${rep.tab} ${label}: ${rep.seq.map((s) => ABBR[s]).join('')}   (W wrist, N neck, P plain, R real, T tile; * = lead swapped)`);
      console.log(grid(rep));
      console.log(`  first ${rep.firstN}: ${(rep.firstShare * 100).toFixed(0)} % non-worn; worn neighbour pairs: ${rep.pairs.map((p) => p.a + '+' + p.b + (p.fixable ? '' : ' (no close-up)')).join(', ') || 'none'}; plain runs > ${MAX_PLAIN_RUN}: ${rep.plainRuns.length}`);
      if (rep === after) { const f = failures(rep); console.log('  checker: ' + (f.length ? 'FAIL ' + f.join('; ') : 'PASS')); for (const x of limits(rep)) console.log('  data limit: ' + x); }
    }
  }
}
