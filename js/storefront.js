/* Karmi Laven storefront PR-2: category tabs, family cards, bag progress line. UI text English.
 *
 * Loaded by index.html (window.klStorefrontBoot) ONLY when /api/stock says storefront.families === true, or when the
 * served ladder table has ui.progress_line === true. With both OFF (the defaults) this file is never requested and the
 * page is exactly the pre-PR-2 page.
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
  /*KL-SF-CORE-END*/

  if (typeof document === 'undefined') return;
  var CFG = window.klSF || { families: false, progress: false };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var L = function () { return window.klLadders || null; };
  var FAM = [];            // family cards from /data/cards.json
  var FAMBY = {};          // barcode -> family card
  var tab = 'gradient', lastPool = null, showOther = false, stockErr = false;

  function priceP(bc) { var p = typeof window.klPrice === 'function' ? window.klPrice(bc) : null; return p > 0 ? Math.round(p * 100) : null; }
  function isGrad(bc) { return typeof window.isLadder === 'function' && window.isLadder(String(bc)); }
  function unitP(bc) { return isGrad(bc) ? Math.round(PRICE * 100) : priceP(bc); }
  function poolOfBc(bc) { return sfPoolKey(L(), isGrad(bc), unitP(bc)); }
  function inBag(bc) { var f = cart.find(function (c) { return c.bc === bc; }); return f ? f.qty : 0; }
  function famState(c) {
    var p = priceP(c.barcode), key = sfPoolKey(L(), false, p);
    return sfState({ priceP: p, photoOk: !!(c.photo && c.photo_qc), sellable: window.klAvail ? window.klAvail(c.barcode) : 0,
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
    var k = $('.hero-copy .k'); if (k) k.textContent = 'Part of Melbe Home · shops in Watford & Guildford';
    var p = $('.hero-copy p'); if (p) p.textContent = 'Bracelets, necklaces and hair pieces in soft colour. Mix pieces, build your own stack.';
    var md = $('.modal .mdesc'); if (md) md.textContent = 'A single thread of 4mm faceted beads on a gold-tone chain with a delicate charm. Wear it alone, or stack it into the gradient.';
    var sub = $('nav .submark'); if (sub) sub.textContent = 'Colour, worn softly';
    // names for icon-only controls (V-15 / WCAG 4.1.2)
    [['.mclose', 'Close'], ['.bundle-h .x', 'Close bundle builder'], ['.cart-head button', 'Close bag'], ['#klpopEmail', 'Email address']]
      .forEach(function (x) { var e = $(x[0]); if (e && !e.getAttribute('aria-label')) e.setAttribute('aria-label', x[1]); });
    var nav = document.createElement('nav'); nav.className = 'kl-tabbar'; nav.setAttribute('aria-label', 'Shop by category');
    nav.innerHTML = '<div class="kl-tabs" role="tablist" aria-label="Categories">' + SF_TABS.map(function (t) {
      return '<button role="tab" type="button" id="kltab-' + t + '" data-tab="' + t + '" aria-controls="' + (t === 'gradient' ? 'palette' : 'klFam') + '" aria-selected="' + (t === 'gradient') + '"' + (t === 'gradient' ? '' : ' hidden') + '>' + SF_TITLE[t] + ' <span class="n" data-count="' + t + '"></span></button>';
    }).join('') + '</div>';
    var sb = $('.swatchbar'); sb.parentNode.insertBefore(nav, sb);
    var pal = $('#palette'); pal.setAttribute('role', 'tabpanel'); pal.setAttribute('aria-labelledby', 'kltab-gradient');
    var sec = document.createElement('section'); sec.className = 'wrap collection kl-fam'; sec.id = 'klFam'; sec.hidden = true;
    sec.setAttribute('role', 'tabpanel'); sec.setAttribute('tabindex', '-1');
    sec.innerHTML = '<div class="kl-err" id="klErr" role="alert" hidden><span>Prices are not loading. Try again.</span> <button type="button" class="btn" id="klRetry">Try again</button></div>'
      + '<div class="col-head"><h2 id="klFamTitle"></h2><div class="c" id="klFamCount" aria-live="polite"></div><div class="kl-dlv" data-kl="ship"></div></div>'
      + '<div class="kl-empty" id="klEmpty" hidden><p class="et">Nothing here yet</p><p class="es">This category opens once its pieces are photographed.</p><a class="btn ghost" href="#gradient">See The Gradient Edit</a></div>'
      + '<div class="grid" id="klFamGrid"></div>';
    pal.parentNode.insertBefore(sec, pal.nextSibling);
    // mobile: the bundle builder moves into the colour chip row so the first cards are on the first screen (V-01)
    var chip = document.createElement('button'); chip.type = 'button'; chip.className = 'sw kl-bundlechip'; chip.textContent = 'Build your bundle';
    chip.setAttribute('aria-haspopup', 'dialog'); chip.onclick = function () { openBundle(); };
    var sbi = $('#swatchbar'); sbi.insertBefore(chip, sbi.firstChild);
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
    var vis = sfVisibleTabs(FAM, famState);
    SF_TABS.forEach(function (t) {
      var b = $('#kltab-' + t); if (!b) return;
      var v = vis.indexOf(t) >= 0; b.hidden = !v;
      b.setAttribute('aria-selected', String(t === tab && v)); b.tabIndex = t === tab ? 0 : -1;
      var n = t === 'gradient' ? $$('#grid [data-kl-card]').filter(function (c) { return c.dataset.klState === 'sellable'; }).length
        : FAM.filter(function (c) { var s = famState(c); return c.tab === t && (s === 'sellable' || s === 'single'); }).length;
      var cnt = $('[data-count="' + t + '"]'); if (cnt) cnt.textContent = String(n);
    });
    var isG = tab === 'gradient', wasG = !$('#palette').hidden;
    $('#palette').hidden = !isG; $('.swatchbar').hidden = !isG;   // colour bar on the Gradient Edit only (K-11)
    $('#klFam').hidden = isG;
    // only the open tab's cards are in the page (no hidden duplicate buttons / texts)
    if (isG) { $('#klFamGrid').innerHTML = ''; if (!wasG || !grid.children.length) rerenderGradient(); }
    else { if (grid.children.length) grid.innerHTML = ''; renderFam(vis.indexOf(tab) >= 0); }
  }
  var inRerender = false;
  function rerenderGradient() {   // back on the Gradient Edit: today's grid, with today's colour filter if one is set
    if (inRerender) return; inRerender = true;
    try { render(typeof active !== 'undefined' && active ? DATA.filter(function (d) { return d.color_en === active; }) : DATA); } finally { inRerender = false; }
  }
  function famCardHTML(c, st) {
    var p = priceP(c.barcode), key = sfPoolKey(L(), false, p), b = sfFromBadge(L(), key), dis = stockErr;
    var media, body = '';
    if (st === 'photo') {
      media = '<div class="kl-tone" style="background-color:' + sfEsc(c.swatch) + '" role="img" aria-label="Colour tile, not a photo"></div>';
      body = '<p class="kl-stt">Photo coming</p><p class="kl-why">Colour tile is a guide only. Coming soon.</p>';
    } else {
      media = '<div class="imgwrap"><img src="' + sfEsc(c.photo) + '" width="400" height="500" loading="lazy" alt="' + sfEsc(c.name + ', ' + c.line) + '"></div>';
      if (st === 'sellable' || st === 'single') {
        if (st === 'sellable' && b) body += '<p class="kl-from">from ' + sfMoney(b.each) + ' each when you buy ' + b.n + '</p>';
        var full = inBag(c.barcode) >= (window.klAvail ? window.klAvail(c.barcode) : 0);
        body += '<button type="button" class="add" data-kl-add data-bc="' + sfEsc(c.barcode) + '"' + (dis || full ? ' disabled aria-disabled="true"' : '') + '>' + (full && !dis ? 'All available in your bag' : 'Add to bag — ' + sfMoney(p)) + '</button>';
      } else if (st === 'soldout') {
        body = '<p class="kl-stt">Sold out</p>';
      } else if (st === 'cap') {
        var w = window.klWindow, why = w && w.open === false ? (w.message || 'Online orders are closed right now.') : 'This piece is fully reserved for now.';
        body = '<p class="kl-stt">Limit reached</p><p class="kl-why">' + sfEsc(why) + '</p><button type="button" class="add" data-kl-add data-bc="' + sfEsc(c.barcode) + '" disabled aria-disabled="true">Add to bag</button>';
      }
    }
    return '<article class="card in kl-card' + (st === 'soldout' ? ' kl-soldout' : '') + '" data-kl-card data-kl-state="' + st + '"' + (st === 'photo' ? ' data-kl-photo="pending"' : '') + ' data-bc="' + sfEsc(c.barcode) + '">'
      + media + '<div class="cbody"><h3 class="nm">' + sfEsc(c.name) + '</h3><div class="sub"><span class="d" style="background:' + sfEsc(c.swatch) + '" aria-hidden="true"></span>' + sfEsc(c.line) + '</div>'
      + (p ? '<div class="pr">' + sfMoney(p) + '</div><div class="fee" data-kl="cardship">' + sfEsc(cardShipText()) + '</div>' : '') + body + '</div></article>';
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
      b.textContent = full && !stockErr ? 'All available in your bag' : 'Add to bag — ' + sfMoney(priceP(bc));
    });
  }
  function scrollToTabs() {
    var bar = $('.kl-tabbar'); if (!bar) return;
    var y = bar.getBoundingClientRect().top + window.scrollY;
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
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var vt = $$('[role=tab]').filter(function (b) { return !b.hidden; }), i = vt.indexOf(e.target);
      var n = vt[(i + (e.key === 'ArrowRight' ? 1 : vt.length - 1)) % vt.length]; setTab(n.dataset.tab, true); n.focus();
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
