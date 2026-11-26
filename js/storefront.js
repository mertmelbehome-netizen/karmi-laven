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
  var SF_TABS = ['bracelets', 'necklaces', 'gifts', 'hair', 'rings', 'gradient'];   // owner 26 Nov 2026: categories first; Hair / Rings / Gifts (W49-A2) hidden like every tab while nothing in it is sellable
  // 'gradient' (26 Nov 2026, Gradient into Bracelets): an INTERNAL view, no chip of its own any more. It is Bracelets >
  // Beaded: the Gradient Edit panel (#palette: colour bar, bundle builder, Beaded / Beaded Cobra row, the page's sticky
  // bar) under the Bracelets chip + its 'Beaded' sub-chip. Bracelets > All = the family grid with the Gradient cards after
  // it. Its URL: #bracelets-colour(-classic|-cobra); old #gradient(-<sub>), #bracelets-beaded and #bracelets-gradient(-<sub>)
  // still open it (sfParseHash). Komuta 26 Nov (D-002 stands, no visible 'Gradient'; 'Beaded' only as the card meta): the
  // Bracelets row names it 'Colour, worn softly' / 'Classic' / 'Cobra'; the old in-panel style row is hidden there.
  var SF_TITLE = { gradient: 'Colour, worn softly', bracelets: 'Bracelets', necklaces: 'Necklaces', hair: 'Hair', gifts: 'Gifts', rings: 'Rings' };
  var SF_CHIP = { gradient: 'Colour, worn softly', bracelets: 'Bracelets', necklaces: 'Necklaces', hair: 'Hair', gifts: 'Gifts', rings: 'Rings' };   // short chip labels: the first 4 fit one 390 px row (nav fix F4); the row scrolls sideways when Rings shows; panel titles keep SF_TITLE
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
  /** Tabs shown: Bracelets and the Gradient Edit view always (Bracelets hosts the Gradient Edit since 26 Nov 2026; the
   *  'gradient' entry has no chip, it keeps the view reachable); any other tab only with >= 1 sellable card (K-01); Gifts
   *  only with >= SF_GIFTS_MIN sellable picks (giftN = sfGiftCount(sfGiftRows(...)); absent = hidden). */
  var SF_GIFTS_MIN = 4;
  function sfVisibleTabs(cards, stateOf, giftN) {
    return SF_TABS.filter(function (t) {
      if (t === 'gifts') return giftN >= SF_GIFTS_MIN;
      return t === 'gradient' || t === 'bracelets' || cards.some(function (c) { var s = stateOf(c); return c.tab === t && (s === 'sellable' || s === 'single'); });
    });
  }
  /* Sub-categories (owner 23 Nov: bracelets split, each its own sub-tab + URL). A card's sub-category comes from its
   * product line (cards.json `line`; Gradient: index.html DATA `type`), never from `family` (0624 is family "Stretch
   * Double" but labelled and sold as "Stretch Bracelet"). Customer labels never say Lux / crystal / diamond / stone:
   * the Gradient Edit's two DB types read "Gradient" and "Gradient Cobra". Hash = '#<tab>-<key>' (ASCII, hyphen);
   * 'all' is never written to the URL ('#bracelets' = All). */
  var SF_SUBS = {
    // Gradient: index.html LADDER_TYPES (the two DB types of the Gradient Edit) told apart by the word Cobra; regexes, so
    // no DB type name sits in this file as a string (K-08 wording test)
    gradient: [{ k: 'classic', label: 'Classic', re: /^(?!.*\bcobra\b).*\bbracelet$/i }, { k: 'cobra', label: 'Cobra', re: /\bcobra bracelet$/i }],
    bracelets: [{ k: 'stretch', label: 'Stretch', re: /\bstretch bracelet$/i }, { k: 'charm', label: 'Stretch Charm', re: /^stretch charm bracelet$/i },
      { k: 'bangle', label: 'Bangle', re: /^bangle$/i }, { k: 'double', label: 'Stretch Double', re: /^stretch double bracelet$/i },
      { k: 'sparkle', label: 'Sparkle Line', re: /^sparkle line$/i },
      // the Gradient Edit inside Bracelets (26 Nov 2026): never matched by a line (these re match nothing); the Gradient
      // items carry their subs themselves (storefront famItems: ['colour', 'colour-<style>']), so no family line lands here
      { k: 'colour', label: 'Colour, worn softly', re: /[^\s\S]/ }, { k: 'colour-classic', label: 'Classic', re: /[^\s\S]/ },
      { k: 'colour-cobra', label: 'Cobra', re: /[^\s\S]/ }],
    // Rings (K-069, 31_rings_ui_spec): one generic barcode per ring style ('we pick, designs vary'). Labels make no
    // unverified material claim (no stainless / zircon / gemstone / natural; 'Steel-look' until K&D + owner confirm).
    // Keys may hold a hyphen ('#rings-steel-chunky'): sfParseHash splits at the FIRST hyphen only.
    rings: [{ k: 'steel-chunky', label: 'Steel-look Chunky', re: /^steel-look chunky ring$/i }, { k: 'steel', label: 'Steel-look', re: /^steel-look ring$/i },
      { k: 'charm', label: 'Charm', re: /^charm ring$/i }, { k: 'ivory', label: 'Ivory', re: /^ivory ring$/i },
      { k: 'chip', label: 'Chip', re: /^chip ring$/i }, { k: 'butterfly', label: 'Butterfly & Starfish', re: /^butterfly & starfish ring$/i },
      { k: 'sparkle', label: 'Sparkle', re: /^(statement )?sparkle ring$/i }, { k: 'antique', label: 'Antique-Style', re: /^antique-style ring$/i },
      { k: 'enamel', label: 'Enamel', re: /^enamel ring$/i }, { k: 'rough-cut', label: 'Rough-Cut Look', re: /^rough-cut look ring$/i }]
  };
  /** sub-category key of a line/type inside a tab; null = shown under All only */
  function sfSubOf(tab, line) {
    var L = SF_SUBS[tab] || [];
    for (var i = 0; i < L.length; i++) if (L[i].re.test(String(line || ''))) return L[i].k;
    return null;
  }
  /** '#bracelets-bangle' -> {tab:'bracelets', sub:'bangle'}; unknown tab -> null; unknown sub -> 'all'.
   *  '#bracelets-colour(-<style>)' and the old '#bracelets-beaded' / '#bracelets-gradient(-<style>)' -> the Gradient Edit view {tab:'gradient', sub};
   *  old '#gradient' / '#gradient-cobra' as before. */
  function sfParseHash(h) {
    h = String(h || '').replace(/^#/, '').toLowerCase();
    var i = h.indexOf('-'), t = i < 0 ? h : h.slice(0, i), s = i < 0 ? '' : h.slice(i + 1);
    if (SF_TABS.indexOf(t) < 0) return null;
    if (t === 'bracelets' && sfIsGradSub(s)) return { tab: 'gradient', sub: sfGradSub(s) };
    var ok = (SF_SUBS[t] || []).some(function (x) { return x.k === s; });
    return { tab: t, sub: ok ? s : 'all' };
  }
  /** a Bracelets sub key that means the Gradient Edit view: 'colour(-<style>)', old 'beaded', old 'gradient(-<style>)' */
  function sfIsGradSub(s) { s = String(s || ''); return s === 'beaded' || /^(colour|gradient)(-|$)/.test(s); }
  /** 'colour-cobra' / 'gradient-cobra' / 'colour' / 'beaded' -> the Gradient Edit sub ('cobra' / 'all') */
  function sfGradSub(s) {
    var m = /^(?:colour|gradient)-(.+)$/.exec(String(s || '')), g = m ? m[1] : '';
    return SF_SUBS.gradient.some(function (x) { return x.k === g; }) ? g : 'all';
  }
  /** URL of a tab + sub-chip; the Gradient Edit view = '#bracelets-colour', its styles '#bracelets-colour-<style>' */
  function sfHash(tab, sub) {
    var has = function (t) { return sub && sub !== 'all' && (SF_SUBS[t] || []).some(function (x) { return x.k === sub; }); };
    if (tab === 'gradient') return '#bracelets-colour' + (has('gradient') ? '-' + sub : '');
    return '#' + tab + (has(tab) ? '-' + sub : '');
  }
  /** Sub-chips of a tab: [{k,label,n}] with All first; only subs with >= 1 sellable item (like the main tabs, K-01).
   *  items = [{line, ok, sub?}] (ok = sellable now; sub = the item's sub-category when its line does not say it: the
   *  Gradient Edit inside Bracelets; a list = every sub it belongs to). Fewer than 2 sub-categories = no row ([]). */
  function sfInSub(tab, it, k) { var s = it.sub || sfSubOf(tab, it.line); return Array.isArray(s) ? s.indexOf(k) >= 0 : s === k; }
  function sfVisibleSubs(tab, items) {
    var subs = (SF_SUBS[tab] || []).map(function (x) {
      return { k: x.k, label: x.label, n: items.filter(function (it) { return it.ok && sfInSub(tab, it, x.k); }).length };
    }).filter(function (x) { return x.n > 0; });
    if (subs.length < 2) return [];
    return [{ k: 'all', label: 'All', n: items.filter(function (it) { return it.ok; }).length }].concat(subs);
  }
  /** Sub-chip row buttons (all of a tab's subs are built once; renderTabs toggles hidden / counts / selection in place,
   *  so keyboard focus survives the 60 s stock refresh). */
  function sfSubButtons(tab, ctl) {
    return [{ k: 'all', label: 'All' }].concat(SF_SUBS[tab] || []).map(function (x) {
      return '<button type="button" role="tab" class="kl-sub" id="klsub-' + tab + '-' + x.k + '" data-subtab="' + tab + '" data-sub="' + x.k + '" aria-controls="' + ctl + '" aria-selected="' + (x.k === 'all') + '" tabindex="' + (x.k === 'all' ? 0 : -1) + '">' + sfEsc(x.label) + ' <span class="n"></span></button>';
    }).join('');
  }
  /** Gifts tab (W49-A2): data/gifts.json {sections:[{heading?, items:[bc | {bc, ai_image}]}]} -> the rows shown, in order:
   *  {bc} for every pick ok(bc) (sellable now) once, {h} for a section heading only when its section keeps >= 1 pick
   *  and something is already above it (no heading above the first cards: V-01). No price text here: the cards carry it. */
  function sfGiftRows(doc, ok) {
    var out = [], seen = {}, secs = doc && Array.isArray(doc.sections) ? doc.sections : [];
    secs.forEach(function (s) {
      var bcs = (s && Array.isArray(s.items) ? s.items : []).map(function (x) { return String(x && typeof x === 'object' ? x.bc : x); })
        .filter(function (bc) { return bc && !seen[bc] && ok(bc); });
      if (!bcs.length) return;
      if (s.heading && out.length) out.push({ h: String(s.heading) });
      bcs.forEach(function (bc) { seen[bc] = 1; out.push({ bc: bc }); });
    });
    return out;
  }
  function sfGiftCount(rows) { return rows.filter(function (r) { return r.bc; }).length; }
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
  /** Family card markup. o = {line: sfPriceLine(), badge, ship, full, dis, why, shipKey?, note?}. shipKey = the delivery
   *  line's data-kl hook (rings: 'ringship', never refreshed with the generic 10+ free line); note = an extra line (rings:
   *  'Designs vary ...'). Without them the markup is byte-for-byte what it was. */
  /** Product gallery (24 Nov, shipped dormant): the QC-passed entries of the optional c.photos [{src, type, alt, qc, ai}].
   *  photos[0] must be the card's own QC photo (c.photo + photo_qc), else no gallery. Fewer than 2 entries = no gallery:
   *  the card is byte-for-byte the one-photo card (tests/product-gallery.test.mjs pins it against the pre-gallery render). */
  function sfPhotos(c) {
    var ps = c && c.photo && c.photo_qc && Array.isArray(c.photos) ? c.photos.filter(function (x) { return x && typeof x.src === 'string' && x.src && x.qc === true; }) : [];
    if (!(ps.length > 1 && ps[0].src === c.photo)) return [];
    var k = sfLeadIdx(c), L = k ? ps.indexOf(c.photos[k]) : 0;   // PHOTO-MIX v1 trial: the lead photo first, the rest in order
    return L > 0 ? [ps[L]].concat(ps.slice(0, L), ps.slice(L + 1)) : ps;
  }
  /** PHOTO-MIX RULE v1 trial (D-004, 26 Nov): optional c.lead = index into c.photos of the photo the card shows FIRST
   *  (default 0 = the main photo). Valid only as an integer >= 1 pointing at a qc:true entry of a card whose photos[0] is
   *  its QC main photo; anything else = 0, so a card without lead is byte-for-byte what it was. photos[0] stays the main
   *  photo in the data. Rule + checker: scripts/photo-mix.mjs, tests/photo-mix-lead.test.mjs. */
  function sfLeadIdx(c) {
    var ps = c && Array.isArray(c.photos) ? c.photos : null, n = c && c.lead;
    if (!ps || !c.photo || !c.photo_qc || !ps[0] || ps[0].src !== c.photo) return 0;
    return typeof n === 'number' && n % 1 === 0 && n > 0 && n < ps.length && ps[n] && ps[n].qc === true && typeof ps[n].src === 'string' && ps[n].src ? n : 0;
  }
  /** The image that stands for the card everywhere else (bag line thumbnail, BY[].img): the lead photo, else c.photo. */
  function sfLeadSrc(c) {
    var k = sfLeadIdx(c);
    return k && sfPhotos(c).length ? c.photos[k].src : (c && c.photo) || null;
  }
  /** Card carousel: native scroll-snap track + dot buttons (index.html klCar* binds dots / arrow keys / scroll). Fixed 4/5
   *  box (.imgwrap), every img with width/height, photo 1 eager, 2+ lazy; one "AI-styled image" label per AI photo
   *  (ai missing: photo 1 follows c.ai_image, later photos are labelled). Pure. */
  function sfGallery(c, ps) {
    var n = ps.length, base = c.name + ', ' + c.line, slides = '', dots = '', m = 0;
    for (var j = 1; j < n; j++) if (c.photo && ps[j].src === c.photo) m = j;   // where the main photo sits (slide 2 when a lead swapped it; v1 trial)
    ps.forEach(function (x, i) {
      // the card's main photo: an AI main photo stays labelled whatever its entry says (K&D #93 B1); every other photo,
      // the lead included, follows its OWN ai flag (missing = labelled, never an unlabelled render; D-004 K&D condition)
      var ai = i === m ? (x.ai === true || !!c.ai_image) : (x.ai == null ? true : x.ai === true);
      slides += '<div class="kl-slide" role="group" aria-roledescription="slide" aria-label="' + (i + 1) + ' of ' + n + '">'
        + '<img src="' + sfEsc(x.src) + '" width="400" height="500" ' + (i ? 'loading="lazy" decoding="async"' : 'loading="eager"')
        + ' alt="' + sfEsc(x.alt || (i ? base + ', photo ' + (i + 1) : base)) + '">'
        + (ai ? '<small class="kl-ai kl-ai-s">AI-styled image</small>' : '') + '</div>';
      dots += '<button type="button" class="kl-dot" data-kl-dot="' + i + '" aria-label="Photo ' + (i + 1) + ' of ' + n + '"' + (i ? '' : ' aria-current="true"') + '></button>';
    });
    return '<div class="imgwrap kl-car" role="region" aria-roledescription="carousel" aria-label="' + sfEsc(c.name) + ' photos" tabindex="0" data-kl-car>'
      + '<div class="kl-track">' + slides + '</div><div class="kl-dots">' + dots + '</div></div>';
  }
  function sfFamCard(c, st, o) {
    var p = o.line && o.line.p, b = o.badge, media, body = '', gal = st === 'photo' ? [] : sfPhotos(c);
    if (st === 'photo') {
      media = '<div class="kl-tone" style="background-color:' + sfEsc(c.swatch) + '" role="img" aria-label="Colour tile, not a photo"></div>';
      body = '<p class="kl-stt">Photo coming</p><p class="kl-why">Colour tile is a guide only. Coming soon.</p>';
    } else {
      media = gal.length ? sfGallery(c, gal) : c.photo
        ? '<div class="imgwrap"><img src="' + sfEsc(c.photo) + '" width="400" height="500" loading="lazy" alt="' + sfEsc(c.name + ', ' + c.line) + '">'
          + (c.ai_image ? '<small class="kl-ai kl-ai-s">AI-styled image</small>' : '') + '</div>'   // 26 Nov (Komuta): same overlay label as the carousel cards
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
      + media + '<div class="cbody">' + (c.ai_image && st !== 'photo' && !gal.length && !c.photo ? '<small class="kl-ai">AI-styled image</small>' : '') + '<h3 class="nm">' + sfEsc(c.name) + '</h3><div class="sub"><span class="d" style="background:' + sfEsc(c.swatch) + '" aria-hidden="true"></span>' + sfEsc(c.line) + '</div>'
      + (p ? '<div class="pr">' + o.line.html + '</div><div class="fee" data-kl="' + (o.shipKey || 'cardship') + '">' + sfEsc(o.ship || '') + '</div>' + (o.note ? '<p class="kl-note">' + sfEsc(o.note) + '</p>' : '') : '') + body + '</div></article>';
  }
  /** Mobile sticky bar with an empty bag, per tab. Gradient Edit: null = keep the page's own bar ("Each £8.00" +
   *  "Build your bundle"). Other tabs: the lowest single price among the tab's sellable cards + the delivery line;
   *  the button takes the shopper back to the tab's pieces (the bundle builder is Gradient-only). */
  function sfSticky(tab, minP, feeP, ring, deal) {
    if (tab === 'gradient' || SF_TABS.indexOf(tab) < 0) return null;
    if (ring) return { info: '<b>' + sfEsc(ring.price) + '</b><span class="dl" data-kl="ringship">' + sfEsc(ring.ship) + '</span>', btn: 'Shop ' + SF_TITLE[tab] };   // K-069: never the generic 10+ free line next to rings
    var fee = '<span class="dl" data-kl="fee1">' + (typeof window !== 'undefined' && typeof window.cardShipText === 'function' ? window.cardShipText() : (feeP ? '+ ' + sfMoney(feeP) + ' UK delivery' : 'Free UK delivery')) + '</span>';   // CMA209: fee + 10+ condition
    // deal-first (owner 24 Nov): the lowest 10+ price of the tab + its condition lead (the hero block's short form 'for any
    // 10+ items', one bar line at 375 px). The single prices are on every card right above the bar (14 px, same view); a
    // longer bar would push the first full card under it (V-01, 375x812)
    if (deal && minP > 0) return { info: (deal.from ? 'From ' : '') + '<b>' + sfEsc(deal.big) + '</b> each ' + sfEsc(deal.short || deal.cond0 || deal.cond) + fee, btn: 'Shop ' + SF_TITLE[tab] };
    return { info: (minP > 0 ? 'From <b>' + sfMoney(minP) + '</b> each' : '') + fee, btn: 'Shop ' + SF_TITLE[tab] };
  }
  /** Deal parts for a set of sellable barcodes (sticky bar / info line): the group with the lowest 10+ price gives the
   *  bold figure + its condition (index.html m1Deal, so a percentage only where the table makes it exact); 'from' when
   *  the groups' 10+ prices differ; one = that group's single text, or 'Single pieces from £x' when singles differ.
   *  Flat groups (rings) never take part. null without the M1 table. W = window (or a test stand-in). */
  function sfDeal(bcs, W) {
    if (!W || typeof W.m1On !== 'function' || !W.m1On() || typeof W.m1Deal !== 'function' || typeof W.m1Group !== 'function') return null;
    var t = W.m1T(), gs = [];
    bcs.forEach(function (bc) { var k = W.m1Group(bc), g = k && t.groups && Object.prototype.hasOwnProperty.call(t.groups, k) ? t.groups[k] : null; if (g && gs.indexOf(g) < 0) gs.push(g); });
    if (!gs.length) return null;
    var lo = gs.reduce(function (a, g) { return g.tier_each < a.tier_each ? g : a; }), d = W.m1Deal(lo);
    var tiers = gs.filter(function (g) { return g.tier_each !== lo.tier_each; }).length, sMin = Math.min.apply(null, gs.map(function (g) { return g.single; }));
    var singles = gs.filter(function (g) { return g.single !== lo.single; }).length;
    return { from: tiers > 0, big: d.big, cond: d.cond, cond0: d.cond0, short: d.short, one: singles ? 'Single pieces from ' + sfMoney(sMin) : d.one };
  }
  /** The barcodes SHOWN on a tab + sub-chip (Komuta 24 Nov: per-tab 'from' price). rows = [{bc, tab, line, ok, sub?}] (ok =
   *  sellable now; sub as in sfVisibleSubs). Pure; js tabBcs() feeds it the page's cards. */
  function sfTabPick(tab, sk, rows) {
    return rows.filter(function (r) { return r.ok && r.tab === tab && (!sk || sk === 'all' || sfInSub(tab, r, sk)); }).map(function (r) { return String(r.bc); });
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
  var sub = { gradient: 'all', bracelets: 'all', rings: 'all' }, lastGSub = 'all';   // selected sub-chip per tab (SF_SUBS)

  function priceP(bc) { return sfPriceLine(bc, window).p; }
  function isRing(bc) { return typeof window.m1FlatOf === 'function' && !!window.m1FlatOf(String(bc)); }   // flat group (K-069 rings), from the served table
  function ringTexts() { return typeof window.m1RingTexts === 'function' ? window.m1RingTexts() : null; }
  /* Rings tab: the panel's delivery line, the sticky bar and the info block after the grids carry the RING line (min 5, rings
     count toward free delivery, K-070: 'free with any 10+ items (rings included)'), never the 10+ hero price (E1 / N2). */
  function syncRingInfo() {
    var on = tab === 'rings', R = on ? ringTexts() : null, rd = $('#klRDlv'), gd = $('#klFam .col-head [data-kl="ship"]');
    if (rd) { rd.hidden = !R; rd.textContent = R ? R.price + ' · ' + R.ship : ''; }
    if (gd) gd.hidden = !!R;
    var info = $('#klInfo'); if (!info) return;
    $$('.launch, .launchfee', info).forEach(function (e) { e.classList.toggle('kl-roff', !!R); });
    var ri = $('#klRingInfo');
    if (R && !ri) { ri = document.createElement('p'); ri.id = 'klRingInfo'; ri.className = 'kl-ringinfo'; info.insertBefore(ri, info.firstChild); }
    if (ri) { ri.hidden = !R; ri.textContent = R ? R.price + ' · ' + R.ship : ''; }
  }   // M1: group single (no group = null = hidden); else till price
  function isGrad(bc) { return typeof window.isLadder === 'function' && window.isLadder(String(bc)); }
  function unitP(bc) { return isGrad(bc) ? Math.round(PRICE * 100) : priceP(bc); }
  function poolOfBc(bc) { return sfPoolKey(L(), isGrad(bc), unitP(bc)); }
  function inBag(bc) { var f = cart.find(function (c) { return c.bc === bc; }); return f ? f.qty : 0; }
  function famState(c) {
    var p = priceP(c.barcode), key = sfPoolKey(L(), false, p);
    return sfState({ priceP: p, photoOk: !!(c.photo && c.photo_qc) || (c.tab !== 'rings' && c.tile_sellable === true),   // G9 exception (Komuta 23 Nov): colour tile, still sellable; never for rings (K-069: photo first)
      sellable: window.klAvail ? window.klAvail(c.barcode) : 0,
      stock: window.klStockQty ? window.klStockQty(c.barcode) : 0, badge: !!sfFromBadge(L(), key) });
  }
  /* ---------------- Gifts (data/gifts.json, W49-A2) ---------------- */
  var GIFTDOC = null, GIFTBY = {};   // gift picks doc; barcode -> card identity for Gradient picks (family picks use FAMBY)
  function giftMeta(bc) {
    var m = null; ((GIFTDOC && GIFTDOC.sections) || []).forEach(function (s) { (s.items || []).forEach(function (x) { if (x && typeof x === 'object' && String(x.bc) === bc) m = x; }); });
    return m || {};
  }
  function giftCard(bc) {
    bc = String(bc); if (FAMBY[bc]) return FAMBY[bc]; if (GIFTBY[bc]) return GIFTBY[bc];
    var d = (window.DATA || []).filter(function (x) { return String(x.barcode) === bc; })[0]; if (!d || !isGrad(bc)) return null;
    var sk = sfSubOf('gradient', d.type), sl = SF_SUBS.gradient.filter(function (x) { return x.k === sk; })[0], real = !!d.img && String(d.img).indexOf('/img/tone/') !== 0;
    return (GIFTBY[bc] = { barcode: bc, tab: 'gradient', grad: true, name: d.color_en, line: 'Beaded bracelet', swatch: d.swatch,   // = the Gradient card meta (Komuta 26 Nov: 'Beaded' only there)
      photo: real ? d.img : null, photo_qc: real, ai_image: giftMeta(bc).ai_image === true });
  }
  /** a gift pick's card state: a QC-passed photo only (never a colour tile, never a ring); Gradient picks: the M1 group
   *  price, on sale once live stock says so */
  function giftState(c) {
    if (!c || c.tab === 'rings' || !(c.photo && c.photo_qc)) return 'hidden';
    if (!c.grad) return famState(c);
    var ok = !!(window.klStockReady && window.klStockReady()) && gradOk(c.barcode);
    return sfState({ priceP: priceP(c.barcode), photoOk: true, sellable: ok ? 1 : 0, stock: ok ? 1 : 0, badge: !!sfFromBadge(L(), sfPoolKey(L(), true, 0)) });
  }
  function giftOk(bc) { var s = giftState(giftCard(bc)); return s === 'sellable' || s === 'single'; }
  function giftRows() { return sfGiftRows(GIFTDOC, giftOk); }
  function poolLabel(key, bc) {
    if (key === 'gradient' || isGrad(bc)) return SF_TITLE.gradient;
    var c = FAMBY[bc]; return c ? (key ? 'Any ' + sfMoney(Number(key)) + ' piece' : c.line) : 'Your bag';
  }

  /* ---------------- families: tabs + panel ---------------- */
  function buildShell() {
    document.documentElement.classList.add('kl-v2');
    // hero copy for a multi-category page (no "hand-strung"/"crystal" claim for hair and necklaces: 03 §2)
    // hero eyebrow / sub-line: sfLayout (H1 + one short line; M1 would put the Gradient-only line back, so its key is dropped)
    // Gradient-only copy (shade count / 4mm crystal / bracelet sizes, made-in, the Gradient 10+ answer): shown on the
    // Gradient Edit tab only (renderTabs); copy shown on every tab is made family-neutral here.
    $$('.story, section.faq').forEach(function (e) { e.setAttribute('data-kl-gonly', ''); });
    $$('.gtknow .faq').forEach(function (e) {
      var q = e.querySelector('.faq-q'); if (!q) return;
      if (/bracelets made/i.test(q.textContent)) e.setAttribute('data-kl-gonly', '');   // the 10+ price FAQ is group-wide: every tab
      else if (/online only/i.test(q.textContent)) { var a = e.querySelector('.faq-a'); if (a) a.innerHTML = 'No — Karmi Laven is a UK brand with shops in Watford and Guildford, part of <b>Melbe Home UK Ltd</b>. karmilaven.com is our online home.'; }
    });
    var ft = $('footer .ftag'); if (ft) ft.textContent = 'Colour, worn softly';
    var h2 = $('#palette .col-head h2'); if (h2) h2.innerHTML = 'Colour, <em>worn softly</em>';   // the count line under it says how many shades are on sale
    var md = $('.modal .mdesc'); if (md) md.textContent = 'A single thread of 4mm faceted beads on a gold-tone chain with a delicate charm. Wear it alone, or stack a few shades.';
    var sub = $('nav .submark'); if (sub) sub.textContent = 'Colour, worn softly';
    // names for icon-only controls (V-15 / WCAG 4.1.2)
    [['.mclose', 'Close'], ['.bundle-h .x', 'Close bundle builder'], ['.cart-head button', 'Close bag'], ['#klpopEmail', 'Email address']]
      .forEach(function (x) { var e = $(x[0]); if (e && !e.getAttribute('aria-label')) e.setAttribute('aria-label', x[1]); });
    // the chip bar: already in the page when index.html laid the families view out before the first paint; else built now
    var nav = $('nav.kl-tabbar') || KL.sfBar(document, ['gradient'], null, 'gradient');
    nav.querySelector('.kl-tabs').addEventListener('scroll', function () { tabScroll(false); }, { passive: true });
    window.addEventListener('resize', function () { tabScroll(true); });
    var pal = $('#palette'); pal.setAttribute('role', 'tabpanel'); pal.setAttribute('aria-labelledby', 'kltab-bracelets');   // the Gradient Edit panel belongs to the Bracelets chip (26 Nov 2026)
    var sec = document.createElement('section'); sec.className = 'wrap collection kl-fam'; sec.id = 'klFam'; sec.hidden = true;
    sec.setAttribute('role', 'tabpanel'); sec.setAttribute('tabindex', '-1');
    sec.innerHTML = '<div class="kl-err" id="klErr" role="alert" hidden><span>Prices are not loading. Try again.</span> <button type="button" class="btn" id="klRetry">Try again</button></div>'
      + '<div class="col-head"><h2 id="klFamTitle"></h2><div class="c" id="klFamCount" aria-live="polite"></div><div class="kl-dlv" data-kl="ship"></div><div class="kl-dlv kl-rdlv" id="klRDlv" hidden></div></div>'
      + '<div class="kl-empty" id="klEmpty" hidden><p class="et">Nothing here yet</p><p class="es">This category opens once its pieces are photographed.</p><a class="btn ghost" href="#bracelets">See all bracelets</a></div>'
      + '<div class="kl-subs" id="klBSubs" role="tablist" aria-label="Bracelet styles" hidden>' + sfSubButtons('bracelets', 'klFamGrid') + '</div>'
      + '<div class="kl-subs" id="klRSubs" role="tablist" aria-label="Ring styles" hidden>' + sfSubButtons('rings', 'klFamGrid') + '</div>'
      + '<div id="klBGrid"><div class="grid" id="klFamGrid"></div></div>';   // klBGrid: Bracelets > All = ONE grid of the family cards + the Gradient cards (#grid moved in, renderTabs)
    // Bracelets panel ABOVE the Gradient Edit panel (26 Nov 2026): Bracelets > All = family grid, then the Gradient cards
    // (#palette, its head hidden); Bracelets > Beaded = the sub-chip row, then the colour bar + Gradient grid as before
    var swb = $('.swatchbar'), at = swb && swb.parentNode === pal.parentNode ? swb : pal;
    pal.parentNode.insertBefore(sec, at);
    sfLayout(document, nav, KL.vis);   // chips under the logo row, hero short, delivery/Christmas/trust/VAT after the grids
    // mobile: the bundle builder moves into the colour chip row so the first cards are on the first screen (V-01)
    KL.sfBundleChip(document);
    var chip = $('#swatchbar .kl-bundlechip'); chip.onclick = function () { openBundle(); };
    if (!$('#klGSubs') && KL.sfGradSubs) KL.sfGradSubs(document);   // Gradient / Gradient Cobra, first in the colour row (no extra row)
    var lbl = $('#swatchbar .sbl'); if (lbl) lbl.setAttribute('aria-hidden', 'true');
    $$('#swatchbar .sw').forEach(function (b) { if (!b.getAttribute('aria-pressed') && b !== chip) b.setAttribute('aria-pressed', String(b.classList.contains('active'))); });
    // bundle builder: a 10 step (one tap) from the table; tier labels are plain quantities (no "Save")
    try {
      if (!TIERS.some(function (t) { return t.n === 10; }) && sfPoolTotal(L(), 'gradient', 10, 299) > 0) TIERS.push(Object.defineProperty({ n: 10, label: '' }, 'price', { get: function () { return gradTotalP(10) / 100; } }));
      TIERS.forEach(function (t) { t.label = ''; });
    } catch (e) { /* bundle stays as today */ }
    applyShipTexts();
  }
  /** landing tab (owner 26 Nov 2026): Bracelets (All) when it has a sellable card, else the Gradient Edit */
  function landingTab() { return KL.sfDefTab ? KL.sfDefTab(sfVisibleTabs(FAM, famState, sfGiftCount(giftRows())), '') : 'gradient'; }
  function setTab(t, push, s) {
    if (SF_TABS.indexOf(t) < 0) t = landingTab();
    if (t === 'bracelets' && s && sfIsGradSub(s)) { t = 'gradient'; s = sfGradSub(s); }   // Bracelets > Gradient (-Classic / -Cobra) = the Gradient Edit view
    tab = t;
    if (s !== undefined && sub[t] !== undefined) sub[t] = s || 'all';
    renderTabs();   // may fall back to 'All' when the asked sub-category has nothing on sale (hidden)
    var sb = tab === 'gradient' ? $('#klBSubs [aria-selected="true"]') : $('.kl-subs [data-subtab="' + tab + '"][aria-selected="true"]'), sc = sb && (sb.closest('#klBSubs') || sb.closest('#klRSubs') || $('#swatchbar'));   // the Gradient view: its named chip in the Bracelets row
    if (sc) {   // 390 px: the selected sub-chip is brought into view inside its own row (deep link #gradient-cobra)
      var r = sb.getBoundingClientRect(), cr = sc.getBoundingClientRect();
      if (r.right > cr.right || r.left < cr.left) sc.scrollLeft += (r.left - cr.left) - (cr.width - r.width) / 2;
    }
    var h = sfHash(tab, sub[tab]), url = location.pathname + location.search + h;
    if (push && location.hash !== h) history.pushState(null, '', url);
    else if (!push && location.hash && location.hash !== h) history.replaceState(null, '', url);   // deep link to a hidden sub-tab
  }
  /* Gradient Edit pieces on sale now (same rule as decorateGradient: not sold out) */
  /** the Bracelets subs of a Gradient piece: 'colour' (all of them) + its style chip ('colour-classic' / '-cobra') */
  function gradSubs(type) { var k = sfSubOf('gradient', type); return k ? ['colour', 'colour-' + k] : ['colour']; }
  function gradOk(bc) { return !(typeof window.klIsSold === 'function' && window.klStockReady && window.klStockReady() && window.klIsSold(bc)); }
  function gradItems() {
    return (window.DATA || []).filter(function (d) { return isGrad(d.barcode); }).map(function (d) { return { line: d.type, ok: gradOk(d.barcode) }; });
  }
  function famItems(t) {
    var fam = FAM.filter(function (c) { return c.tab === t; }).map(function (c) { var s = famState(c); return { line: c.line, ok: s === 'sellable' || s === 'single' }; });
    // Bracelets hosts the Gradient Edit (26 Nov 2026): its pieces count under All and under the 'Beaded' sub-chip
    return t === 'bracelets' ? fam.concat(gradItems().map(function (x) { return { line: x.line, ok: x.ok, sub: gradSubs(x.line) }; })) : fam;
  }
  /** one sub-chip row in place: hidden when < 2 sub-categories are on sale; the selected sub falls back to All when its
   *  sub-tab is hidden. Returns the visible subs. On the Gradient Edit view the Bracelets row shows 'Beaded' selected. */
  function renderSubs(t, row) {
    var vs = sfVisibleSubs(t, t === 'gradient' ? gradItems() : famItems(t)), keys = vs.map(function (x) { return x.k; });
    if (keys.indexOf(sub[t]) < 0) sub[t] = 'all';
    if (!row) return vs;
    row.hidden = !vs.length;
    var cur = t === 'bracelets' && tab === 'gradient' ? (sub.gradient && sub.gradient !== 'all' ? 'colour-' + sub.gradient : 'colour') : sub[t];
    $$('[role=tab]', row).forEach(function (b) {
      var x = vs.filter(function (v) { return v.k === b.dataset.sub; })[0], on = !!x && b.dataset.sub === cur;
      b.hidden = !x; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      var n = b.querySelector('.n'); if (n) n.textContent = x ? String(x.n) : '';
    });
    return vs;
  }
  function renderTabs() {
    document.documentElement.setAttribute('data-kl-tab', tab);   // phone CSS: family tabs use a one-line hero price (V-01)
    var gn = sfGiftCount(giftRows()), vis = sfVisibleTabs(FAM, famState, gn), seen = {};
    SF_TABS.forEach(function (t) {
      var b = $('#kltab-' + t); if (!b) return;   // 'gradient' has no chip (26 Nov 2026): the Bracelets chip stands for it
      var v = vis.indexOf(t) >= 0, me = t === tab || (t === 'bracelets' && tab === 'gradient'); b.hidden = !v;
      b.setAttribute('aria-selected', String(me && v)); b.tabIndex = me ? 0 : -1;
      var gN = gradItems().filter(function (x) { return x.ok; }).length;   // all Gradient pieces on sale, whatever sub-chip / colour is picked
      var n = t === 'gifts' ? gn : t === 'gradient' ? gN
        : FAM.filter(function (c) { var s = famState(c); return c.tab === t && (s === 'sellable' || s === 'single'); }).length + (t === 'bracelets' ? gN : 0);
      var cnt = $('[data-count="' + t + '"]'); if (cnt) cnt.textContent = String(n);
      seen[t] = n;
    });
    var gsv = renderSubs('gradient', $('#klGSubs')); renderSubs('bracelets', $('#klBSubs'));
    var rsr = $('#klRSubs'); renderSubs('rings', rsr); if (rsr && tab !== 'rings') rsr.hidden = true;
    if (tab !== 'bracelets' && tab !== 'gradient') { var bsr = $('#klBSubs'); if (bsr) bsr.hidden = true; }   // bracelet style chips on Bracelets (+ its Beaded view) only (they also showed on Necklaces)
    syncRingInfo();
    if (FAM.length) try { localStorage.setItem('kl_sf_tabs', JSON.stringify({ v: vis, n: seen,   // next visit's pre-paint chip bar + Gradient sub-chips (index.html)
      gs: gsv.reduce(function (o, x) { o[x.k] = x.n; return o; }, {}) })); } catch (e) {}
    // 26 Nov 2026: Bracelets > Beaded (isG) = the Gradient Edit panel as before, under the Bracelets panel's sub-chip row;
    // Bracelets > All (gall) = ONE grid: the Gradient grid node (#grid, the page's own cards and code) moves into #klBGrid
    // after the family grid, both display:contents there (css), so the Gradient cards fill the family grid's last row
    var isG = tab === 'gradient', gall = tab === 'bracelets' && sub.bracelets === 'all', withG = isG || gall;
    var pal = $('#palette'), bw = $('#klBGrid');
    if (bw) {
      if (gall && grid.parentNode !== bw) bw.appendChild(grid); else if (!gall && grid.parentNode !== pal) pal.appendChild(grid);
      bw.className = gall ? 'grid kl-bgrid' : '';
    }
    pal.hidden = !isG; $('.swatchbar').hidden = !isG;   // colour bar + bundle block on the Gradient Edit view only (K-11)
    $('#klFam').hidden = false;
    if (gall) document.documentElement.setAttribute('data-kl-gall', ''); else document.documentElement.removeAttribute('data-kl-gall');
    $$('[data-kl-gonly]').forEach(function (e) { e.classList.toggle('kl-goff', !isG); });
    var hp = $('.hero-copy p'); if (hp && hp.parentNode) hp.textContent = sfHeroLine(vis);
    // hero price block: the lowest 10+ price + singles of the groups on sale (index.html klHeroPriceApply)
    try { if (typeof window.klHeroPriceApply === 'function') window.klHeroPriceApply(); } catch (e) {}
    sfMetaCats(document, vis.indexOf('hair') >= 0);
    tabScroll(true); syncSticky(); syncHero();
    // only the open tab's cards are in the page (no hidden duplicate buttons / texts)
    if (isG) {
      $('#klFamGrid').innerHTML = ''; $('#klEmpty').hidden = true; $('#klErr').hidden = !stockErr; $('#klFamCount').textContent = '';
      $('#klFamTitle').textContent = SF_TITLE.bracelets + ' · ' + SF_TITLE.gradient;
      if (gridMode !== 'g' || !grid.children.length || lastGSub !== sub.gradient) { gridMode = 'g'; lastGSub = sub.gradient; rerenderGradient(); }
    } else {
      renderFam(vis.indexOf(tab) >= 0);
      if (withG) { if (gridMode !== 'all' || !grid.children.length) { gridMode = 'all'; rerenderGradient(true); } }
      else if (grid.children.length) { grid.innerHTML = ''; gridMode = null; }
    }
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
  /* Per-tab 'from' price (Komuta 24 Nov, CMA: a 'from' price must be available on what is shown): the priced, sellable
   * barcodes shown on the ACTIVE tab and sub-chip (Gradient: its pieces on sale; Gifts: the picks; family tabs: their
   * cards). Rings never take part (K-069: flat price, not in the 10+ offer). Drives the hero block (index.html
   * klHeroPriceApply via window.klTabGroups), the sticky bar and the info line after the grids. */
  function tabBcs() {
    var on = function (s) { return s === 'sellable' || s === 'single'; }, rows;
    if (tab === 'gradient') rows = (window.DATA || []).filter(function (d) { return isGrad(d.barcode); }).map(function (d) { return { bc: d.barcode, tab: 'gradient', line: d.type, ok: gradOk(d.barcode) }; });
    else if (tab === 'gifts') rows = giftRows().filter(function (r) { return r.bc; }).map(function (r) { return { bc: r.bc, tab: 'gifts', line: '', ok: true }; });
    else rows = FAM.map(function (c) { return { bc: c.barcode, tab: c.tab, line: c.line, ok: on(famState(c)) }; });
    if (tab === 'bracelets') rows = rows.concat((window.DATA || []).filter(function (d) { return isGrad(d.barcode); }).map(function (d) { return { bc: d.barcode, tab: 'bracelets', line: d.type, sub: gradSubs(d.type), ok: gradOk(d.barcode) }; }));   // Bracelets > All shows the Gradient cards too
    return sfTabPick(tab, tab === 'gifts' ? 'all' : sub[tab], rows).filter(function (bc) { return !isRing(bc) && priceP(bc) > 0; });   // K-069: rings never set the 'from' price
  }
  /** groups (non-flat, in the served table) of the cards on the active tab; null = not known yet (family data not
   *  loaded, or families off): the page then keeps the landing (Gradient) figure. */
  window.klTabGroups = function () {
    var t = L(); if (!CFG.families || !t || !t.groups || typeof window.m1Group !== 'function') return null;
    if (tab !== 'gradient' && !FAM.length) return null;
    var ks = [];
    tabBcs().forEach(function (bc) { var k = window.m1Group(bc); if (k && Object.prototype.hasOwnProperty.call(t.groups, k) && ks.indexOf(k) < 0) ks.push(k); });
    return ks;
  };
  function syncHero() {
    var hp = $('.launch .p'), lb = $('.launch > span'); if (!hp) return;   // moved to #klInfo by sfLayout
    var minP = null, bcs = tabBcs();   // per tab (Komuta 24 Nov)
    bcs.forEach(function (bc) { var p = priceP(bc); if (p && (minP === null || p < minP)) minP = p; });
    if (minP === null) return;
    // deal-first (owner 24 Nov): the lowest 10+ price + its condition lead, the single prices follow in the same line
    var d = sfDeal(bcs, window);
    hp.removeAttribute('data-kl-m1');
    if (d) hp.innerHTML = '<span class="m1d">' + (d.from ? 'from ' : '') + '<b class="m1big">' + sfEsc(d.big) + '</b> each <span class="m1c">' + sfEsc(d.cond) + '</span></span><span class="m1sep"> · </span><span class="m1one">' + sfEsc(d.one) + '</span>';
    else hp.textContent = 'from ' + sfMoney(minP);
    if (lb) lb.textContent = 'Online prices';
  }
  /* mobile sticky bar, empty bag: per tab (sfSticky). The Gradient Edit keeps the page's own text and bundle button. */
  var stickyOrig = null;
  function syncSticky() {
    var inf = $('#stickyInfo'), btn = $('#stickyBtn'); if (!inf || !btn) return;
    if (!stickyOrig) stickyOrig = { text: btn.textContent, click: btn.onclick };
    if (totalQty() > 0) return;   // a bag with items: the page's bag total + View bag on every tab
    var minP = null, dealBcs = tab === 'rings' ? [] : tabBcs();   // per tab + sub-chip (Komuta 24 Nov)
    var on = function (s) { return s === 'sellable' || s === 'single'; };
    (tab === 'rings' ? FAM.filter(function (c) { return c.tab === tab && on(famState(c)); }).map(function (c) { return c.barcode; }) : dealBcs)
      .forEach(function (bc) { var p = priceP(bc); if (p && (minP === null || p < minP)) minP = p; });
    var st = sfSticky(tab, minP, SHIP.feeP, tab === 'rings' ? ringTexts() : null, tab === 'rings' ? null : sfDeal(dealBcs, window));
    if (!st) {
      if (btn.textContent !== stickyOrig.text) { btn.textContent = stickyOrig.text; btn.onclick = stickyOrig.click; updateBag(); }
      return;
    }
    inf.innerHTML = st.info; btn.textContent = st.btn; btn.onclick = function () { scrollToGrid(); };
  }
  var inRerender = false, gridMode = null;   // gridMode: what #grid holds now ('g' = Beaded view, 'all' = after the Bracelets family grid)
  function rerenderGradient(all) {   // Beaded view: today's grid, with today's colour filter if one is set; all = every Gradient piece (Bracelets > All)
    if (inRerender) return; inRerender = true;
    try { render(!all && typeof active !== 'undefined' && active ? DATA.filter(function (d) { return d.color_en === active; }) : DATA); } finally { inRerender = false; }
  }
  function famCardHTML(c, st) {
    var line = sfPriceLine(c.barcode, window), key = sfPoolKey(L(), !!c.grad, line.p), w = window.klWindow, R = isRing(c.barcode) ? ringTexts() : null;
    return sfFamCard(c, st, { line: line, badge: sfFromBadge(L(), key), ship: R ? R.ship : cardShipText(), shipKey: R ? 'ringship' : null, note: R ? R.design : null, dis: stockErr,
      full: inBag(c.barcode) >= (window.klAvail ? window.klAvail(c.barcode) : 0),
      why: w && w.open === false ? (w.message || 'Online orders are closed right now.') : 'This piece is fully reserved for now.' });
  }
  function renderFam(has) {
    if (tab === 'gifts') return renderGifts(has);
    var sk = sub[tab] || 'all', sl = (SF_SUBS[tab] || []).filter(function (x) { return x.k === sk; })[0];
    $('#klFamTitle').textContent = SF_TITLE[tab] + (sl ? ' · ' + sl.label : '');
    $('#klErr').hidden = !stockErr;
    var g = $('#klFamGrid'), list = FAM.filter(function (c) { return c.tab === tab && (sk === 'all' || sfSubOf(tab, c.line) === sk); }).map(function (c) { return { c: c, s: famState(c) }; })
      .filter(function (x) { return x.s !== 'hidden' && (x.s !== 'soldout' || CFG.sold_out !== 'hide') && !(x.c.tab === 'rings' && x.s === 'photo'); });   // rings: no 'Photo coming' tiles (K-069: photo + owner decision first)
    $('#klEmpty').hidden = has;
    if (!has) { g.innerHTML = ''; $('#klFamCount').textContent = ''; return; }
    list.forEach(function (x, i) { x.i = i; });   // stable: state, then real photo before colour tile (Komuta 23 Nov), then original order
    list.sort(function (a, b) { return SF_ORDER[a.s] - SF_ORDER[b.s] || (a.c.photo ? 0 : 1) - (b.c.photo ? 0 : 1) || a.i - b.i; });
    var avail = list.filter(function (x) { return x.s === 'sellable' || x.s === 'single'; }).length, gi = tab === 'bracelets' && sk === 'all' ? gradItems().filter(function (x) { return x.ok || CFG.sold_out !== 'hide'; }) : [];   // + the Gradient cards after the grid
    $('#klFamCount').textContent = (list.length + gi.length) + ' pieces · ' + (avail + gi.filter(function (x) { return x.ok; }).length) + ' available now';
    g.innerHTML = list.map(function (x) { return famCardHTML(x.c, x.s); }).join('');
    var fi = g.querySelector('img[loading="lazy"]'); if (fi) { fi.setAttribute('loading', 'eager'); fi.setAttribute('fetchpriority', 'high'); }   // 26 Nov: first card photo is not lazy (cold load LCP)
  }
  function renderGifts(has) {
    $('#klFamTitle').textContent = SF_TITLE.gifts;
    $('#klErr').hidden = !stockErr;
    var g = $('#klFamGrid'), rows = has ? giftRows() : [];
    $('#klEmpty').hidden = has;
    if (!has) { g.innerHTML = ''; $('#klFamCount').textContent = ''; return; }
    $('#klFamCount').textContent = 'Gift picks from across the shop';   // one line at 375 px (the chip carries the count); no % here: every card carries its single price + the 10+ condition (K-046)
    g.innerHTML = rows.map(function (r) { if (r.h) return '<h3 class="kl-gh">' + sfEsc(r.h) + '</h3>'; var c = giftCard(r.bc); return famCardHTML(c, giftState(c)); }).join('');
  }
  function refreshFamButtons() {   // in place: keeps keyboard focus (prototype fix D1)
    $$('#klFamGrid [data-kl-add]').forEach(function (b) {
      var bc = b.dataset.bc, c = tab === 'gifts' ? giftCard(bc) : FAMBY[bc]; if (!c) return; var st = tab === 'gifts' ? giftState(c) : famState(c); if (st !== 'sellable' && st !== 'single') return;
      var full = inBag(bc) >= (window.klAvail ? window.klAvail(bc) : 0), dis = stockErr || full;
      b.disabled = dis; if (dis) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      if (b.getAttribute('data-kl-added') === '1') { b.setAttribute('data-kl-was', sfAddText(priceP(bc), full, stockErr)); return; }   // basket-1 U3: 'Added ✓' keeps its text, then restores this one
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
    var t = $('#klFam'); if (!t) return;   // every tab, the Beaded view too: its Bracelets sub-chip row is the panel's start (26 Nov 2026)
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
      window.render = function (list) {   // Gradient sub-chip: only that type's cards (the colour filter still applies on top)
        if (Array.isArray(list) && tab === 'gradient' && sub.gradient !== 'all') list = list.filter(function (d) { return sfSubOf('gradient', d.type) === sub.gradient; });
        else if (Array.isArray(list) && tab !== 'gradient') list = DATA;   // Bracelets > All: every Gradient piece, never a colour filter left from the Beaded view
        origR.call(this, list); try { decorateGradient(); renderTabs(); } catch (e) {}
      };
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
      if (t.matches('[role=tab]') && t.dataset.tab) { setTab(t.dataset.tab, true, 'all'); scrollToTabs(); return; }
      if (t.matches('[role=tab]') && t.dataset.sub) { setTab(t.dataset.subtab, true, t.dataset.sub); return; }
      if (t.matches('#klFamGrid [data-kl-add]')) { if (!t.disabled) addToCart(t.dataset.bc); return; }
      if (t.id === 'klRetry') { refresh(); return; }
      var href = t.getAttribute && t.getAttribute('href');
      var ph = t.tagName === 'A' && href && href.charAt(0) === '#' ? sfParseHash(href) : null;
      if (ph) { e.preventDefault(); setTab(ph.tab, true, ph.sub); scrollToTabs(); }
    });
    document.addEventListener('keydown', function (e) {
      if (!CFG.families || !e.target.matches || !e.target.matches('[role=tab]')) return;
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].indexOf(e.key) < 0) return;
      e.preventDefault();
      var vt = $$('[role=tab]', e.target.closest('[role=tablist]') || document).filter(function (b) { return !b.hidden; }), i = vt.indexOf(e.target);   // arrows stay inside their own row
      var n = e.key === 'Home' ? vt[0] : e.key === 'End' ? vt[vt.length - 1] : vt[(i + (e.key === 'ArrowRight' ? 1 : vt.length - 1)) % vt.length];
      if (n.dataset.sub) setTab(n.dataset.subtab, true, n.dataset.sub); else setTab(n.dataset.tab, true, 'all');
      n.focus();
    });
    window.addEventListener('popstate', function () { if (!CFG.families) return; var ph = sfParseHash(location.hash); setTab(ph ? ph.tab : landingTab(), false, ph ? ph.sub : 'all'); });
  }

  /* ---------------- data ---------------- */
  // ring barcodes are asked for only while the served table has an enabled flat group (K-069 dark = the request as before)
  function famBcs() { var r = typeof window.m1FlatKeys === 'function' && window.m1FlatKeys().length > 0; return FAM.filter(function (c) { return c.tab !== 'rings' || r; }).map(function (c) { return c.barcode; }); }
  function refresh() {
    if (typeof window.klRefreshStock !== 'function') return Promise.resolve(false);
    return window.klRefreshStock(famBcs()).then(function (ok) {
      stockErr = !ok;
      if (ok && FAM.length) window.__klGroupsKnown = true;   // hero price: from now on only the groups on sale (index.html klHeroPriceApply)
      try { if (CFG.families) { decorateGradient(); renderTabs(); } renderCart(); updateBag(); } catch (e) {}
      return ok;
    });
  }
  function loadGifts() {   // no gifts file / a bad file = no Gifts chip; never blocks the other tabs
    return fetch('/data/gifts.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { GIFTDOC = d && Array.isArray(d.sections) ? d : null; }, function () { GIFTDOC = null; });
  }
  function loadCards() {
    return Promise.all([loadGifts(), loadCardsJson()]);
  }
  function loadCardsJson() {
    return fetch('/data/cards.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('cards ' + r.status); return r.json(); })
      .then(function (doc) {
        FAM = (doc && Array.isArray(doc.cards) ? doc.cards : []).filter(function (c) { return c && c.barcode && c.tab !== 'gradient' && SF_TABS.indexOf(c.tab) >= 0; });
        FAM.forEach(function (c) {
          FAMBY[c.barcode] = c;
          if (!BY[c.barcode]) BY[c.barcode] = { barcode: c.barcode, type: c.line, color_en: c.name, swatch: c.swatch, img: sfLeadSrc(c) || '', family: true };   // bag thumbnail = the card's lead image (D-004)
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
      var ph = sfParseHash(location.hash);   // '#bracelets-bangle' opens Bracelets with Bangle selected
      setTab(ph ? ph.tab : landingTab(), false, ph ? ph.sub : 'all');
      if (ph) scrollToTabs();
      var s = Math.max(15, Number(CFG.refresh_s) || 60);
      setInterval(function () { if (document.visibilityState !== 'hidden') refresh(); }, s * 1000);   // K-07 without reload
    });
  }
  start();
})();
