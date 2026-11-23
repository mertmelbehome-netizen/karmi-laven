// scripts/dev/serve.mjs — LOCAL preview of the storefront with a FIXTURE /api/stock (no DB, no Stripe, no network writes).
// For the vitrin rule audit and screenshots only; never deployed as a function (Vercel only runs api/*.js).
//   node scripts/dev/serve.mjs [--port 8790] [--families] [--table A] [--fail-stock]
//     --families    /api/stock serves storefront.families = true (default: the real api/_storefront.js value = off)
//     --table A     serve tests/fixtures/ladders.A.json (family pools + progress line on) instead of ladders.json
//     --fail-stock  /api/stock answers 500 (K-10 error state)
//     --rings       Rings tab preview (K-069): flat group R ENABLED in the served table (ladders.json itself stays dark),
//                   ring cards get online_group R + the placeholder; other family cards get their M1 group by line.
//                   Open http://127.0.0.1:<port>/?sf=families#rings  (implies --families)
// Fixture state (labelled, NOT live stock): Gradient sellable = the 8 barcodes from 03_categories §1; family pieces get a
// placeholder "photo" (scripts/dev/photo-placeholder.svg, says PHOTO PENDING) except 2 left without one (colour tile),
// one piece at its cap and one sold out. /api/checkout is not served (404): nothing can be bought here.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(ROOT); // api/_pricing.js reads <cwd>/ladders.json
const { loadLadders, publicLadders } = await import('../../api/_pricing.js');
const { storefrontConfig } = await import('../../api/_storefront.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const PORT = Number(arg('--port', 8790));
const table = arg('--table', null);
const RINGS = has('--rings');
const ringsTable = () => { const r = JSON.parse(readFileSync(join(ROOT, 'ladders.json'), 'utf8')); r.flat_groups.R.enabled = true; return loadLadders(r).table; };
const LAD = table ? publicLadders(loadLadders(JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', `ladders.${table}.json`), 'utf8'))).table) : RINGS ? publicLadders(ringsTable()) : publicLadders();
// --rings: M1 group per card line (fixture; the live page gets it from the DB online_group)
const LINE_GROUP = { 'Stretch Bracelet': 'A', 'Stretch Charm Bracelet': 'B', 'Bead Necklace': 'B', 'Charm Necklace': 'C', 'Chip Bead Necklace': 'C', 'Cube Bead Stretch Bracelet': 'C', 'Stretch Double Bracelet': 'C', Bangle: 'C', 'Hair Claw': 'C', 'Sparkle Line': 'C' };

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const DATA = JSON.parse(html.slice(html.indexOf('const DATA=') + 11, html.indexOf('}], PRICE=') + 2));
const CARDS = JSON.parse(readFileSync(join(ROOT, 'data', 'cards.json'), 'utf8'));
const GRAD_SELLABLE = new Set(['1266', '1267', '1268', '1269', '1271', '1272', '1302', '1310']);
const FAM_PRICE = { 'Stretch Charm': 599, 'Stretch Double': 999, 'Necklace Lux Stone': 999, Hair: 400 };
const fixtureCards = { ...CARDS, _doc: 'DEV FIXTURE (scripts/dev/serve.mjs): placeholder photos, not QC photos', cards: CARDS.cards.map((c, i) => {
  const noPhoto = i === 3 || i === CARDS.cards.length - 2;
  return { ...c, photo: noPhoto ? null : '/scripts/dev/photo-placeholder.svg', photo_qc: !noPhoto };
}) };
const capBc = CARDS.cards.find((c) => c.tab === 'hair')?.barcode;
const soldBc = CARDS.cards.filter((c) => c.tab === 'bracelets')[5]?.barcode;

function stock(bcs) {
  const st = {}, sellable = {}, price = {}, group = {};
  for (const bc of bcs) {
    const g = DATA.find((d) => d.barcode === bc);
    if (g) { st[bc] = GRAD_SELLABLE.has(bc) ? 4 : 0; continue; }
    const c = CARDS.cards.find((x) => x.barcode === bc); if (!c) continue;
    const p = FAM_PRICE[c.family] ?? (c.line.includes('Claw') ? 799 : 400);
    price[bc] = p; st[bc] = bc === soldBc ? 0 : 5; sellable[bc] = bc === capBc || bc === soldBc ? 0 : 5;
    if (RINGS) {
      const g = c.tab === 'rings' ? 'R' : LINE_GROUP[c.line] || 'B';
      group[bc] = g; price[bc] = g === 'R' ? LAD.flat_groups.R.each : LAD.groups[g].single;
      if (c.tab === 'rings') { st[bc] = 50; sellable[bc] = 20; }
    }
  }
  const sf = storefrontConfig(has('--families') || RINGS ? { KARMI_STOREFRONT_FAMILIES: 'on' } : process.env);
  return { ok: true, store: 'WAT', stock: st, sellable, price_pence: price, ...(RINGS ? { online_group: group } : {}), window: { open: true, message: null }, ts: new Date().toISOString(), ladders: LAD, storefront: sf, _fixture: 'DEV FIXTURE, not live stock' };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/stock') {
    if (has('--fail-stock')) { res.writeHead(500); return res.end('fixture failure'); }
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(stock((u.searchParams.get('bc') || '').split(',').filter(Boolean))));
  }
  if (u.pathname === '/data/cards.json') { res.writeHead(200, { 'Content-Type': TYPES['.json'] }); return res.end(JSON.stringify(fixtureCards)); }
  if (u.pathname.startsWith('/api/')) { res.writeHead(404); return res.end('not served locally'); }
  const p = normalize(join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
  if (!p.startsWith(ROOT) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(PORT, '127.0.0.1', () => console.log(`storefront dev server http://127.0.0.1:${PORT}/ pid ${process.pid} families=${has('--families') || RINGS} table=${table || (RINGS ? 'ladders.json + R enabled (--rings)' : 'ladders.json')}`));
