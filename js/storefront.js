/* Karmi Laven storefront PR-2: category tabs, family cards, bag progress line. UI text English.
 *
 * Loaded by index.html (window.klStorefrontBoot) ONLY when /api/stock says storefront.families === true, or when the
 * served ladder table has ui.progress_line === true. With both OFF (the defaults) this file is never requested and the
 * page is exactly the pre-PR-2 page (index.html undoes its pre-paint families layout then: klSfUndo).
 *
 * Data: card identity from /data/cards.json (static); every price, stock, cap and ladder number from /api/stock
 * (window.klPrice / klAvail / klStockQty / klLadders). No price is hard-coded here. Checkout, Stripe and pricing code
 * are untouched: family items go into the same bag and the same /api/checkout call, which prices every unit itself.
 * Vitrin spec: orchestrator/projects/2026-11-23_karmi-relaunch/vitrin (01 brief, 03 rule set K-01..K-12, V-CMA209). */
(function () {
  'use strict';

  /*KL-SF-CORE-START*/ // pure functions (no DOM); tests/storefront.test.mjs evaluates this block as-is
  var SF_TABS = ['gradient', 'bracelets', 'necklaces', 'hair'];
  var SF_TITLE = { gradient: 'The Gradient Edit', bracelets: 'Bracelets', necklaces: 'Necklaces', hair: 'Hair' };
  var SF_CHIP = { gradient: 'Gradient', bracelets: 'Bracelets', necklaces: 'Necklaces', hair: 'Hair' };   // short chip labels: all 4 fit one 390 px row (nav fix F4); panel titles keep SF_TITLE
  var SF_ORDER = { sellable: 0, single: 0, cap: 1, photo: 2, soldout: 3 };
  function sfMoney(p) { return '£' + (p / 100).toFixed(2); }
  /** Pool key exactly as the server (api/_pricing.js poolKey): Gradient Edit -> 'gradient'; any other product -> its
   *  single price in pence when the table has that pool; else null (n x single, no multi-buy). */
  function sfPoolKey(ladders, isGrad, priceP) {
    var pools = ladders && ladders.pools; if (!pools) return null;
    if (isGrad) return pools.gradient ? 'gradient' : null;
    var k = String(priceP); return pools[k] ? k : null;
  }
  /** What q units of a pool cost, as charged (ladders.pools[key].totals[q]); no pool = q x single. */
  function sfPoolTotal(ladders, key, q, singleP) {
    if (!(q > 0)) return 0;
    var t = key && ladders && ladders.pools && ladders.pools[key] && ladders.pools[key].totals;
    return (t && Number.isInteger(t[q])) ? t[q] : q * singleP;
  }
  function sfMaxQ(ladders, key, cap) {
    var t = key && ladders && ladders.pools && ladders.pools[key] && ladders.pools[key].totals;
    return Math.min(cap || 10, t ? t.length - 1 : 0);
  }
  /** "from £x each when you buy N": the lowest EXACT per-piece price below single within N <= 10, smallest N reaching it.
   *  null when the pool has none (then no badge: K-12). */
  function sfFromBadge(ladders, key, cap) {
    if (!key) return null;
    var P = ladders.pools[key], best = null, m = sfMaxQ(ladders, key, cap);
    for (var n = 2; n <= m; n++) {
      var t = P.totals[n]; if (!Number.isInteger(t) || t % n) continue;
      var e = t / n; if (e >= P.single) continue;
      if (!best || e < best.each) best = { n: n, each: e };
    }
    return best;
  }
  /** Card state (vitrin 01 §5). c = {priceP, photoOk, sellable, stock, badge}. Order matters: no price = hidden (K-12),
   *  no QC photo = colour tile, never sellable (K-03); then sellable / cap (stock but nothing left under the caps) / sold out. */
  function sfState(c) {
    if (!(Number.isInteger(c.priceP) && c.priceP > 0)) return 'hidden';
    if (!c.photoOk) return 'photo';
    if (c.sellable > 0) return c.badge ? 'sellable' : 'single';
    if (c.stock > 0) return 'cap';
    return 'soldout';
  }
  /** Bag progress line for one pool, from the table only: next step k = min{k : P(q+k) - P(q) < k * P(q)/q}.
   *  No %, no "save", no strike-through (K-05, DMCC). */
  function sfProgress(ladders, key, q, label, singleP, cap) {
    if (!(q > 0)) return '';
    if (!key) return label + ': ' + sfMoney(singleP) + ' each, single price.';
    var M = sfMaxQ(ladders, key, cap), P = function (n) { return sfPoolTotal(ladders, key, n, singleP); }, eff = P(q) / q;
    for (var k = 1; q + k <= M; k++) {
      if (P(q + k) - P(q) < k * eff) {
        var n = q + k;
        while (n + 1 <= M && P(n + 1) === P(n)) n++;   // same total for more pieces: name the real step (3..5 same total -> 5)
        var t = P(n); k = n - q;
        return label + ': add ' + k + ' more, ' + n + ' for ' + sfMoney(t) + (t % n ? '' : ' (' + sfMoney(t / n) + ' each)') + '.';
      }
    }
    var tq = P(q), b = sfFromBadge(ladders, key, cap), ex = tq % q === 0;
    return label + ': ' + q + ' for ' + sfMoney(tq) + (ex ? ' (' + sfMoney(tq / q) + ' each)' : '') + (b && ex && tq / q === b.each ? ', the lowest step' : '') + '.';
  }
  /** Tabs shown: the Gradient Edit always (today's page); any other tab only with >= 1 sellable card (K-01). */
  function sfVisibleTabs(cards, stateOf) {
    return SF_TABS.filter(function (t) {
      return t === 'gradient' || cards.some(function (c) { var s = stateOf(c); return c.tab === t && (s === 'sellable' || s === 'single'); });
    });
  }
  function sfEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  /** Price shown on a family card. M1 table (mode cart_qty_groups): the group single price + the same M1 text as the
   *  Gradient cards (index.html m1PriceHtml, so a percentage appears only when the table makes it exact); no group =
   *  no price (card hidden, K-12). Pools table: the till price (/api/stock price_pence). W = window (or a test stand-in). */
  function sfPriceLine(bc, W) {
    if (W && typeof W.m1On === 'function' && W.m1On()) {
      var u = typeof W.unitPrice === 'function' ? W.unitPrice(bc) : null, p = u > 0 ? Math.round(u * 100) : null;
      var h = p && typeof W.m1PriceHtml === 'function' ? W.m1PriceHtml(bc) : '';
      return h ? { p: p, html: h, m1: true } : { p: null, html: '', m1: true };
    }
    var k = W && typeof W.klPrice === 'function' ? W.klPrice(bc) : null, q = k > 0 ? Math.round(k * 100) : null;
    return { p: q, html: q ? sfMoney(q) : '', m1: false };
  }
  function sfAddText(p, full, dis) { return full && !dis ? 'All available in your bag' : 'Add to bag — ' + sfMoney(p); }
  /** Family card markup. o = {line: sfPriceLine(), badge, ship, full, dis, why}. */
  function sfFamCard(c, st, o) {
    var p = o.line && o.line.p, b = o.badge, media, body = '';
    if (st === 'photo') {
      media = '<div class="kl-tone" style="background-color:' + sfEsc(c.swatch) + '" role="img" aria-label="Colour tile, not a photo"></div>';
      body = '<p class="kl-stt">Photo coming</p><p class="kl-why">Colour tile is a guide only. Coming soon.</p>';
    } else {
      media = c.photo
        ? '<div class="imgwrap"><img src="' + sfEsc(c.photo) + '" width="400" height="500" loading="lazy" alt="' + sfEsc(c.name + ', ' + c.line) + '"></div>'
        : '<div class="kl-tone" style="background-color:' + sfEsc(c.swatch) + '" role="img" aria-label="' + sfEsc(c.name) + ' colour tile, not a photo"></div>';
      if (!c.photo) body = '<p class="kl-stt">Photo coming</p><p class="kl-why">Colour tile is a guide only.</p>';
      if (st === 'sellable' || st === 'single') {
        if (st === 'sellable' && b) body += '<p class="kl-from">from ' + sfMoney(b.each) + ' each when you buy ' + b.n + '</p>';
        body += '<button type="button" class="add" data-kl-add data-bc="' + sfEsc(c.barcode) + '"' + (o.dis || o.full ? ' disabled aria-disabled="true"' : '') + '>' + sfAddText(p, o.full, o.dis) + '</button>';
      } else if (st === 'soldout') {
        body = '<p class="kl-stt">Sold out</p>';
      } else if (st === 'cap') {
        body = '<p class="kl-stt">Limit reached</p><p class="kl-why">' + sfEsc(o.why || '') + '</p><button type="button" class="add" data-kl-add data-bc="' + sfEsc(c.barcode) + '" disabled aria-disabled="true">Add to bag</button>';
      }
    }
    return '<article class="card in kl-card' + (st === 'soldout' ? ' kl-soldout' : '') + '" data-kl-card data-kl-state="' + st + '"' + (st === 'photo' ? ' data-kl-photo="pending"' : '') + ' data-bc="' + sfEsc(c.barcode) + '">'
      + media + '<div class="cbody">' + (c.ai_image && st !== 'photo' ? '<small class="kl-ai">AI-styled image</small>' : '') + '<h3 class="nm">' + sfEsc(c.name) + '</h3><div class="sub"><span class="d" style="background:' + sfEsc(c.swatch) + '" aria-hidden="true"></span>' + sfEsc(c.line) + '</div>'
      + (p ? '<div class="pr">' + o.line.html + '</div><div class="fee" data-kl="cardship">' + sfEsc(o.ship || '') + '</div>' : '') + body + '</div></article>';
  }
  /** Mobile sticky bar with an empty bag, per tab. Gradient Edit: null = keep the page's own bar ("Each £8.00" +
   *  "Build your bundle"). Other tabs: the lowest single price among the tab's sellable cards + the delivery line;
   *  the button takes the shopper back to the tab's pieces (the bundle builder is Gradient-only). */
  function sfSticky(tab, minP, feeP) {
    if (tab === 'gradient' || SF_TABS.indexOf(tab) < 0) return null;
    var fee = '<span class="dl" data-kl="fee1">' + (typeof window !== 'undefined' && typeof window.cardShipText === 'function' ? window.cardShipText() : (feeP ? '+ ' + sfMoney(feeP) + ' UK delivery' : 'Free UK delivery')) + '</span>';   // CMA209: fee + 10+ condition
    return { info: (minP > 0 ? 'From <b>' + sfMoney(minP) + '</b> each' : '') + fee, btn: 'Shop ' + SF_TITLE[tab] };
  }
  /*KL-SF-CORE-END*/

  /* families view first screen (nav fix 23 Nov, 15_nav_findability F1/F3/F7): sfBar / sfLayout / sfHeroLine / sfMetaCats
     live in index.html (KL-SF-LAYOUT block, window.klSfL) since the CLS fix (18_cls_prepaint): they run BEFORE the first
     paint there; this file binds the pre-built chip bar and re-runs sfLayout (idempotent). */

  if (typeof document === 'undefined') return;
  var CFG = window.klSF || { families: false, progress: false };
  var KL = window.klSfL || {};
  var sfLayout = KL.sfLayout, sfHeroLine = KL.sfHeroLine, sfMetaCats = KL.sfMetaCats;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var L = function () { return window.klLadders || null; };
  var FAM = [];            // family cards from /data/cards.json
  var FAMBY = {};          // barcode -> family card
  var tab = 'gradient', lastPool = null, showOther = false, stockErr = false;

  function priceP(bc) { return sfPriceLine(bc, window).p; }   // M1: group single (no group = null = hidden); else till price
  function isGrad(bc) { return typeof window.isLadder === 'function' && window.isLadder(String(bc)); }
  function unitP(bc) { return isGrad(bc) ? Math.round(PRICE * 100) : priceP(bc); }
  function poolOfBc(bc) { return sfPoolKey(L(), isGrad(bc), unitP(bc)); }
  function inBag(bc) { var f = cart.find(function (c) { return c.bc === bc; }); return f ? f.qty : 0; }
  function famState(c) {
    var p = priceP(c.barcode), key = sfPoolKey(L(), false, p);
    return sfState({ priceP: p, photoOk: !!(c.photo && c.photo_qc) || c.tile_sellable === true,   // G9 exception (Komuta 23 Nov): colour tile, still sellable
      sellable: window.klAvail ? window.klAvail(c.barcode) : 0,
      stock: window.klStockQty ? window.klStockQty(c.barcode) : 0, badge: !!sfFromBadge(L(), key) });
  }
  function poolLabel(key, bc) {
    if (key === 'gradient' || isGrad(bc)) return SF_TITLE.gradient;
    var c = FAMBY[bc]; return c ? (key ? 'Any ' + sfMoney(Number(key)) + ' piece' : c.line) : 'Your bag';
  }

  /* ---------------- families: tabs + panel ---------------- */
  function buildShell() {
    document.documentElement.classList.add('kl-v2');
    // hero copy for a multi-category page (no "hand-strung"/"crystal" claim for hair and necklaces: 03 §2)
    // hero eyebrow / sub-line: sfLayout (H1 + one short line; M1 would put the Gradient-only line back, so its key is dropped)
    // Gradient-only copy (15 shades / 4mm crystal / bracelet sizes, made-in, the Gradient 10+ answer): shown on the
    // Gradient Edit tab only (renderTabs); copy shown on every tab is made family-neutral here.
    $$('.story, section.faq').forEach(function (e) { e.setAttribute('data-kl-gonly', ''); });
    $$('.gtknow .faq').forEach(function (e) {
      var q = e.querySelector('.faq-q'); if (!q) return;
      if (/bracelets made/i.test(q.textContent)) e.setAttribute('data-kl-gonly', '');   // the 10+ price FAQ is group-wide: every tab
      else if (/online only/i.test(q.textContent)) { var a = e.querySelector('.faq-a'); if (a) a.innerHTML = 'No — Karmi Laven is part of <b>Melbe Home UK Ltd</b>, an established UK retailer with physical shops in Watford and Guildford. karmilaven.com is our online home.'; }
    });
    var ft = $('footer .ftag'); if (ft) ft.textContent = 'Colour, worn softly';
    var h2 = $('#palette .col-head h2'); if (h2) h2.innerHTML = 'The Gradient <em>Edit</em>';   // the count line under it says how many shades are on sale
    var md = $('.modal .mdesc'); if (md) md.textContent = 'A single thread of 4mm faceted beads on a gold-tone chain with a delicate charm. Wear it alone, or stack it into the gradient.';
    var sub = $('nav .submark'); if (sub) sub.textContent = 'Colour, worn softly';
    // names for icon-only controls (V-15 / WCAG 4.1.2)
    [['.mclose', 'Close'], ['.bundle-h .x', 'Close bundle builder'], ['.cart-head button', 'Close bag'], ['#klpopEmail', 'Email address']]
      .forEach(function (x) { var e = $(x[0]); if (e && !e.getAttribute('aria-label')) e.setAttribute('aria-label', x[1]); });
    // the chip bar: already in the page when index.html laid the families view out before the first paint; else built now
    var nav = $('nav.kl-tabbar') || KL.sfBar(document, ['gradient'], null, 'gradient');
    nav.querySelector('.kl-tabs').addEventListener('scroll', function () { tabScroll(false); }, { passive: true });
    window.addEventListener('resize', function () { tabScroll(true); });
    var pal = $('#palette'); pal.setAttribute('role', 'tabpanel'); pal.setAttribute('aria-labelledby', 'kltab-gradient');
    var sec = document.createElement('section'); sec.className = 'wrap collection kl-fam'; sec.id = 'klFam'; sec.hidden = true;
    sec.setAttribute('role', 'tabpanel'); sec.setAttribute('tabindex', '-1');
    sec.innerHTML = '<div class="kl-err" id="klErr" role="alert" hidden><span>Prices are not loading. Try again.</span> <button type="button" class="btn" id="klRetry">Try again</button></div>'
      + '<div class="col-head"><h2 id="klFamTitle"></h2><div class="c" id="klFamCount" aria-live="polite"></div><div class="kl-dlv" data-kl="ship"></div></div>'
      + '<div class="kl-empty" id="klEmpty" hidden><p class="et">Nothing here yet</p><p class="es">This category opens once its pieces are photographed.</p><a class="btn ghost" href="#gradient">See The Gradient Edit</a></div>'
      + '<div class="grid" id="klFamGrid"></div>';
    pal.parentNode.insertBefore(sec, pal.nextSibling);
    sfLayout(document, nav, KL.vis);   // chips under the logo row, hero short, delivery/Christmas/trust/VAT after the grids
    // mobile: the bundle builder moves into the colour chip row so the first cards are on the first screen (V-01)
    KL.sfBundleChip(document);
    var chip = $('#swatchbar .kl-bundlechip'); chip.onclick = function () { openBundle(); };
    var lbl = $('#swatchbar .sbl'); if (lbl) lbl.setAttribute('aria-hidden', 'true');
    $$('#swatchbar .sw').forEach(function (b) { if (!b.getAttribute('aria-pressed') && b !== chip) b.setAttribute('aria-pressed', String(b.classList.contains('active'))); });
    // bundle builder: a 10 step (one tap) from the table; tier labels are plain quantities (no "Save")
    try {
      if (!TIERS.some(function (t) { return t.n === 10; }) && sfPoolTotal(L(), 'gradient', 10, 299) > 0) TIERS.push(Object.defineProperty({ n: 10, label: '' }, 'price', { get: function () { return gradTotalP(10) / 100; } }));
      TIERS.forEach(function (t) { t.label = ''; });
    } catch (e) { /* bundle stays as today */ }
    applyShipTexts();
  }
  function setTab(t, push) {
    if (SF_TABS.indexOf(t) < 0) t = 'gradient';
    tab = t;
    if (push && location.hash !== '#' + t) history.pushState(null, '', location.pathname + location.search + '#' + t);
    renderTabs();
  }
  function renderTabs() {
    var vis = sfVisibleTabs(FAM, famState), seen = {};
    SF_TABS.forEach(function (t) {
      var b = $('#kltab-' + t); if (!b) return;
      var v = vis.indexOf(t) >= 0; b.hidden = !v;
      b.setAttribute('aria-selected', String(t === tab && v)); b.tabIndex = t === tab ? 0 : -1;
      var n = t === 'gradient' ? $$('#grid [data-kl-card]').filter(function (c) { return c.dataset.klState === 'sellable'; }).length
        : FAM.filter(function (c) { var s = famState(c); return c.tab === t && (s === 'sellable' || s === 'single'); }).length;
      var cnt = $('[data-count="' + t + '"]'); if (cnt) cnt.textContent = String(n);
      seen[t] = n;
    });
    if (FAM.length) try { localStorage.setItem('kl_sf_tabs', JSON.stringify({ v: vis, n: seen })); } catch (e) {}   // next visit's pre-paint chip bar (index.html)
    var isG = tab === 'gradient', wasG = !$('#palette').hidden;
    $('#palette').hidden = !isG; $('.swatchbar').hidden = !isG;   // colour bar on the Gradient Edit only (K-11)
    $('#klFam').hidden = isG;
    $$('[data-kl-gonly]').forEach(function (e) { e.classList.toggle('kl-goff', !isG); });
    var hp = $('.hero-copy p'); if (hp && hp.parentNode) hp.textContent = sfHeroLine(vis);
    sfMetaCats(document, vis.indexOf('hair') >= 0);
    tabScroll(true); syncSticky(); syncHero();
    // only the open tab's cards are in the page (no hidden duplicate buttons / texts)
    if (isG) { $('#klFamGrid').innerHTML = ''; if (!wasG || !grid.children.length) rerenderGradient(); }
    else { if (grid.children.length) grid.innerHTML = ''; renderFam(vis.indexOf(tab) >= 0); }
  }
  /* 390 px: the tab row scrolls sideways by itself (never the page); edge fades show there is more; the selected tab
     is brought into view. center=true: scroll the selected tab to the middle of the row. */
  function tabScroll(center) {
    var row = $('.kl-tabs'), bar = $('.kl-tabbar'); if (!row || !bar) return;
    if (center) {
      var sel = $('.kl-tabs [aria-selected="true"]');
      if (sel && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, sel.offsetLeft - (row.clientWidth - sel.offsetWidth) / 2);
    }
    try { document.documentElement.style.setProperty('--kl-tb-h', bar.offsetHeight + 'px'); } catch (e) {}   // swatch bar sticks under it, never under it
    var max = row.scrollWidth - row.clientWidth;
    bar.classList.toggle('kl-more-l', max > 1 && row.scrollLeft > 1);
    bar.classList.toggle('kl-more-r', max > 1 && row.scrollLeft < max - 1);
  }
  /* hero price with families on: the Gradient-only '£8' would mislead next to £5 / £13 pieces, so it reads
   *  'Online prices from £x' = the lowest single price among everything sellable now (Gradient + family cards). */
  function syncHero() {
    var hp = $('.launch .p'), lb = $('.launch > span'); if (!hp) return;   // moved to #klInfo by sfLayout
    var minP = null, t = L(), g = t && t.groups && t.gradient_group ? t.groups[t.gradient_group] : null;
    if (g && Number.isInteger(g.single)) minP = g.single;
    FAM.forEach(function (c) { var s = famState(c); if (s !== 'sellable' && s !== 'single') return;
      var p = priceP(c.barcode); if (p && (minP === null || p < minP)) minP = p; });
    if (minP === null) return;
    hp.removeAttribute('data-kl-m1'); hp.textContent = 'from ' + sfMoney(minP);
    if (lb) lb.textContent = 'Online prices';
  }
  /* mobile sticky bar, empty bag: per tab (sfSticky). The Gradient Edit keeps the page's own text and bundle button. */
  var stickyOrig = null;
  function syncSticky() {
    var inf = $('#stickyInfo'), btn = $('#stickyBtn'); if (!inf || !btn) return;
    if (!stickyOrig) stickyOrig = { text: btn.textContent, click: btn.onclick };
    if (totalQty() > 0) return;   // a bag with items: the page's bag total + View bag on every tab
    var minP = null;
    FAM.forEach(function (c) {
      if (c.tab !== tab) return; var s = famState(c); if (s !== 'sellable' && s !== 'single') return;
      var p = priceP(c.barcode); if (p && (minP === null || p < minP)) minP = p;
    });
    var st = sfSticky(tab, minP, SHIP.feeP);
    if (!st) {
      if (btn.textContent !== stickyOrig.text) { btn.textContent = stickyOrig.text; btn.onclick = stickyOrig.click; updateBag(); }
      return;
    }
    inf.innerHTML = st.info; btn.textContent = st.btn; btn.onclick = function () { scrollToGrid(); };
  }
  var inRerender = false;
  function rerenderGradient() {   // back on the Gradient Edit: today's grid, with today's colour filter if one is set
    if (inRerender) return; inRerender = true;
    try { render(typeof active !== 'undefined' && active ? DATA.filter(function (d) { return d.color_en === active; }) : DATA); } finally { inRerender = false; }
  }
  function famCardHTML(c, st) {
    var line = sfPriceLine(c.barcode, window), key = sfPoolKey(L(), false, line.p), w = window.klWindow;
    return sfFamCard(c, st, { line: line, badge: sfFromBadge(L(), key), ship: cardShipText(), dis: stockErr,
      full: inBag(c.barcode) >= (window.klAvail ? window.klAvail(c.barcode) : 0),
      why: w && w.open === false ? (w.message || 'Online orders are closed right now.') : 'This piece is fully reserved for now.' });
  }
  function renderFam(has) {
    $('#klFamTitle').textContent = SF_TITLE[tab];
    $('#klErr').hidden = !stockErr;
    var g = $('#klFamGrid'), list = FAM.filter(function (c) { return c.tab === tab; }).map(function (c) { return { c: c, s: famState(c) }; })
      .filter(function (x) { return x.s !== 'hidden' && (x.s !== 'soldout' || CFG.sold_out !== 'hide'); });
    $('#klEmpty').hidden = has;
    if (!has) { g.innerHTML = ''; $('#klFamCount').textContent = ''; return; }
    list.sort(function (a, b) { return SF_ORDER[a.s] - SF_ORDER[b.s]; });
    var avail = list.filter(function (x) { return x.s === 'sellable' || x.s === 'single'; }).length;
    $('#klFamCount').textContent = list.length + ' pieces · ' + avail + ' available now';
    g.innerHTML = list.map(function (x) { return famCardHTML(x.c, x.s); }).join('');
  }
  function refreshFamButtons() {   // in place: keeps keyboard focus (prototype fix D1)
    $$('#klFamGrid [data-kl-add]').forEach(function (b) {
      var bc = b.dataset.bc, c = FAMBY[bc]; if (!c) return; var st = famState(c); if (st !== 'sellable' && st !== 'single') return;
      var full = inBag(bc) >= (window.klAvail ? window.klAvail(bc) : 0), dis = stockErr || full;
      b.disabled = dis; if (dis) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      b.textContent = sfAddText(priceP(bc), full, stockErr);
    });
  }
  function scrollToGrid() {   // the open tab's first cards just under the sticky tab bar (also when the bar is stuck)
    var s = $('#klFam'), bar = $('.kl-tabbar'); if (!s) return;
    var y = s.getBoundingClientRect().top + window.scrollY - (bar ? bar.offsetHeight : 0);
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
  }
  function scrollToTabs() {   // the open panel's start just under the stuck chip bar (the bar itself sits at the top of the page)
    var bar = $('.kl-tabbar'); if (!bar) return;
    var sb = $('.swatchbar'), t = tab === 'gradient' ? (sb && !sb.hidden ? sb : $('#palette')) : $('#klFam'); if (!t) return;
    var y = Math.max(0, t.getBoundingClientRect().top + window.scrollY - bar.offsetHeight);
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (Math.abs(window.scrollY - y) > 4) window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  }

  /* ---------------- Gradient cards: state attributes, from-badge, sold-out last ---------------- */
  function decorateGradient() {
    var key = sfPoolKey(L(), true, 0), b = sfFromBadge(L(), key);
    $$('#grid [data-kl-card]').forEach(function (card) {
      var bc = card.dataset.bc; if (!bc) return;
      var sold = typeof window.klIsSold === 'function' && window.klStockReady && window.klStockReady() && window.klIsSold(bc);
      var st = sold ? 'soldout' : (b ? 'sellable' : 'single'); card.dataset.klState = st;
      var f = card.querySelector('.kl-from');
      if (st === 'sellable' && b) {
        if (!f) { f = document.createElement('div'); f.className = 'kl-from'; var pr = card.querySelector('.pr'); pr.parentNode.insertBefore(f, pr.nextSibling); }
        f.textContent = 'from ' + sfMoney(b.each) + ' each when you buy ' + b.n;
      } else if (f) f.remove();
      var s = card.querySelector('.kl-stt');
      if (sold) {
        if (!s) { s = document.createElement('p'); s.className = 'kl-stt'; s.textContent = 'Sold out'; card.querySelector('.cbody').appendChild(s); }
      } else if (s) s.remove();
      if (CFG.sold_out === 'hide') card.classList.remove('kl-show');
      else card.classList.add('kl-show');
    });
    var ce = $('#count'); if (ce && grid.children.length) ce.textContent = window.countText(grid.children.length);
  }

  /* ---------------- bag progress line (ladders.json ui.progress_line) ---------------- */
  function bagPools() {
    var m = {}, order = [];
    cart.forEach(function (c) {
      var key = poolOfBc(c.bc), id = key || ('single:' + c.bc);
      if (!m[id]) { m[id] = { key: key, bc: c.bc, q: 0 }; order.push(id); }
      m[id].q += c.qty;
    });
    return { m: m, order: order };
  }
  function progressHTML() {
    var bp = bagPools(); if (!bp.order.length) return '';
    var last = bp.m[lastPool] ? lastPool : bp.order[bp.order.length - 1];
    var line = function (id) { var g = bp.m[id]; return sfProgress(L(), g.key, g.q, poolLabel(g.key, g.bc), unitP(g.bc)); };
    var others = bp.order.filter(function (id) { return id !== last; });
    var h = sfEsc(line(last));
    if (others.length) {
      h += ' <button type="button" class="kl-og" id="klOg" aria-expanded="' + showOther + '">' + others.length + ' other group' + (others.length > 1 ? 's' : '') + '</button>';
      if (showOther) h += '<ul class="kl-ogl">' + others.map(function (id) { return '<li>' + sfEsc(line(id)) + '</li>'; }).join('') + '</ul>';
    }
    return h;
  }
  function ladderRow() {   // K-06: the pool's steps up to 10, from the table
    var bp = bagPools(); var last = bp.m[lastPool] ? lastPool : bp.order[bp.order.length - 1]; var g = last && bp.m[last];
    if (!g || !g.key) return '';
    var P = L().pools[g.key], steps = [1].concat(Object.keys(P.bundles || {}).map(Number)).concat([10]).filter(function (v, i, a) { return v <= 10 && a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    return '<p class="kl-cap">' + sfEsc(poolLabel(g.key, g.bc)) + ', any mix: price for</p>' + steps.map(function (n) { return '<div class="' + (n === g.q ? 'on' : '') + '"><b>' + n + '</b>' + sfMoney(sfPoolTotal(L(), g.key, n, unitP(g.bc))) + '</div>'; }).join('');
  }

  /* ---------------- hooks into the existing page functions ---------------- */
  function hook() {
    if (CFG.progress) { var cs = $('#cartShip'); if (cs) { cs.setAttribute('data-kl-progress', ''); cs.setAttribute('aria-live', 'polite'); } }
    var origRC = window.renderCart;
    window.renderCart = function () {
      origRC.apply(this, arguments);
      try {
        if (CFG.progress && cart.length) {
          var el = $('#cartShip'); el.setAttribute('data-kl-progress', ''); el.setAttribute('aria-live', 'polite'); el.innerHTML = progressHTML();
          var lt = $('#klLadTab'); if (!lt) { lt = document.createElement('div'); lt.id = 'klLadTab'; lt.className = 'kl-ladtab'; el.parentNode.insertBefore(lt, el); }
          lt.innerHTML = ladderRow();
          $('#cartPre').textContent = itemWord(totalQty()) + ' · ships within 1–2 business days';
        }
        if (CFG.families && !cart.length) { $('#cartSub').textContent = '–'; $('#cartTotal').textContent = '–'; }   // never "£0" (K-10)
        if (CFG.families) refreshFamButtons();
      } catch (e) { /* the bag keeps today's text */ }
    };
    var origS = window.addToCartSilent;
    window.addToCartSilent = function (bc) { var r = origS.apply(this, arguments); try { lastPool = poolOfBc(bc) || ('single:' + bc); } catch (e) {} return r; };
    if (CFG.families) {
      var origR = window.render;
      window.render = function () { origR.apply(this, arguments); try { decorateGradient(); renderTabs(); } catch (e) {} };
      var origUB = window.updateBag;
      window.updateBag = function () { origUB.apply(this, arguments); try { syncSticky(); } catch (e) {} };
      // Gradient count line: the shades actually on sale (sold-out hidden), not every shade in the page data
      var origCT = window.countText;
      window.countText = function (n) {
        var cs = $$('#grid [data-kl-card]'), on = cs.filter(function (c) { return !c.classList.contains('sold-out'); }).length;
        return origCT(cs.length && CFG.sold_out === 'hide' ? on : n);
      };
    }
  }

  function bindEvents() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('button,a'); if (!t) return;
      if (t.id === 'klOg') { showOther = !showOther; renderCart(); return; }
      if (!CFG.families) return;
      if (t.matches('[role=tab]') && t.dataset.tab) { setTab(t.dataset.tab, true); scrollToTabs(); return; }
      if (t.matches('#klFamGrid [data-kl-add]')) { if (!t.disabled) addToCart(t.dataset.bc); return; }
      if (t.id === 'klRetry') { refresh(); return; }
      var href = t.getAttribute && t.getAttribute('href');
      if (t.tagName === 'A' && href && href.charAt(0) === '#' && SF_TABS.indexOf(href.slice(1)) >= 0) { e.preventDefault(); setTab(href.slice(1), true); scrollToTabs(); }
    });
    document.addEventListener('keydown', function (e) {
      if (!CFG.families || !e.target.matches || !e.target.matches('[role=tab]')) return;
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].indexOf(e.key) < 0) return;
      e.preventDefault();
      var vt = $$('[role=tab]').filter(function (b) { return !b.hidden; }), i = vt.indexOf(e.target);
      var n = e.key === 'Home' ? vt[0] : e.key === 'End' ? vt[vt.length - 1] : vt[(i + (e.key === 'ArrowRight' ? 1 : vt.length - 1)) % vt.length];
      setTab(n.dataset.tab, true); n.focus();
    });
    window.addEventListener('popstate', function () { if (CFG.families) setTab(location.hash.slice(1) || 'gradient', false); });
  }

  /* ---------------- data ---------------- */
  function famBcs() { return FAM.map(function (c) { return c.barcode; }); }
  function refresh() {
    if (typeof window.klRefreshStock !== 'function') return Promise.resolve(false);
    return window.klRefreshStock(famBcs()).then(function (ok) {
      stockErr = !ok;
      try { if (CFG.families) { decorateGradient(); renderTabs(); } renderCart(); updateBag(); } catch (e) {}
      return ok;
    });
  }
  function loadCards() {
    return fetch('/data/cards.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('cards ' + r.status); return r.json(); })
      .then(function (doc) {
        FAM = (doc && Array.isArray(doc.cards) ? doc.cards : []).filter(function (c) { return c && c.barcode && SF_TABS.indexOf(c.tab) > 0; });
        FAM.forEach(function (c) {
          FAMBY[c.barcode] = c;
          if (!BY[c.barcode]) BY[c.barcode] = { barcode: c.barcode, type: c.line, color_en: c.name, swatch: c.swatch, img: c.photo || '', family: true };
        });
        // bag lines saved before reload for family pieces (dropped by migrateCart because BY did not know them yet)
        (window.__klPendingCart || []).forEach(function (l) { if (FAMBY[l.bc] && !cart.some(function (c) { return c.bc === l.bc; })) cart.push({ bc: l.bc, qty: l.qty }); });
        window.__klPendingCart = [];
      });
  }

  function start() {
    hook(); bindEvents();
    if (!CFG.families) { renderCart(); return; }
    buildShell();
    loadCards().then(refresh, function () { stockErr = true; }).then(function () {
      try { render(DATA); } catch (e) {}
      var h = location.hash.slice(1);
      setTab(SF_TABS.indexOf(h) >= 0 ? h : 'gradient', false);
      if (SF_TABS.indexOf(h) >= 0) scrollToTabs();
      var s = Math.max(15, Number(CFG.refresh_s) || 60);
      setInterval(function () { if (document.visibilityState !== 'hidden') refresh(); }, s * 1000);   // K-07 without reload
    });
  }
  start();
})();
