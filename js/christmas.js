/* Karmi Laven: Christmas last-order notice (23 Nov 2026; command centre approved, CMA: the condition is visible and
 * there is no delivery promise). UI text English.
 *
 * The date comes ONLY from /api/stock `christmas.last_order_date` (karmi_online_window, api/_christmas.js); nothing here
 * hard-codes a date. No field (DB unreadable, no window, window closed) or the date has passed (London) = no notice and
 * no DOM change at all: the page is exactly as before.
 *
 * index.html: the live-stock loader calls window.klXmasApply(data.christmas) once /api/stock answers.
 * shipping-returns.html: <script src="/js/christmas.js" data-kl-xmas-fetch> fetches /api/stock itself.
 * tests/christmas.test.mjs evaluates the KL-XMAS-CORE block as-is. */
(function (W) {
  /*KL-XMAS-CORE-START*/
  var XM_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var XM_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function xmLondonToday(now) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
    catch (e) { return now.toISOString().slice(0, 10); }
  }
  // The last order day as {w, d, m} (weekday index, day, month index), or null = show nothing.
  function xmDay(c, now) {
    if (!c || typeof c !== 'object') return null;
    var iso = String(c.last_order_date || ''), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    now = now || new Date();
    var closes = Date.parse(c.closes_at);
    if (isFinite(closes) && now.getTime() >= closes) return null;          // closed: the existing closed message handles it
    if (xmLondonToday(now) > iso) return null;                              // the date has passed
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return null;
    return { w: dt.getUTCDay(), d: +m[3], m: +m[2] - 1 };
  }
  // long date, e.g. "Monday 1 March"
  function xmLongDate(c, now) { var x = xmDay(c, now); return x ? XM_DAYS[x.w] + ' ' + x.d + ' ' + XM_MONTHS[x.m] : ''; }
  // short date, e.g. "Mon 1 Mar"
  function xmShortDate(c, now) { var x = xmDay(c, now); return x ? XM_DAYS[x.w].slice(0, 3) + ' ' + x.d + ' ' + XM_MONTHS[x.m].slice(0, 3) : ''; }
  // FAQ / Shipping & Returns answer (approved sentence, verbatim apart from the date)
  function xmLongText(c, now) {
    var d = xmLongDate(c, now);
    return d ? 'Last online order date for Christmas: ' + d + ' (or earlier if our Christmas order limit is reached). '
      + "We dispatch within 1–2 business days; Royal Mail usually takes 2–5 business days, so we can't guarantee delivery before Christmas for late orders." : '';
  }
  // next to the delivery line and under the bag totals
  function xmShortText(c, now) {
    var d = xmShortDate(c, now);
    return d ? 'Christmas: last online order ' + d + ' (or earlier if our limit is reached) · delivery not guaranteed before Christmas for late orders' : '';
  }
  var XM_FAQ_Q = 'Last order date for Christmas?';
  /*KL-XMAS-CORE-END*/

  if (!W || !W.document) return;
  var doc = W.document;
  var CSS = '.kl-xmas{font-size:12px;line-height:1.55;color:#5c554a;font-weight:400;letter-spacing:.01em}'
    + '.hero .kl-xmas-hero{margin-top:6px;max-width:440px}'
    + '.kl-xmas-bag{margin:-6px 0 14px}'
    + '.kl-xmas-faq .faq-a{color:#5c554a}';

  function style() {
    if (doc.getElementById('klXmasCss')) return;
    var s = doc.createElement('style'); s.id = 'klXmasCss'; s.textContent = CSS; doc.head.appendChild(s);
  }
  function after(anchor, el) { if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling); }
  function drop(id) { var e = doc.getElementById(id); if (e && e.parentNode) e.parentNode.removeChild(e); }
  function line(id, cls, tag, text, anchor) {
    drop(id);
    if (!text || !anchor) return;
    var e = doc.createElement(tag); e.id = id; e.className = cls; e.textContent = text; after(anchor, e);
  }

  function apply(c) {
    var long = xmLongText(c), short = xmShortText(c);
    if (!long) { ['klXmasHero', 'klXmasBag', 'klXmasFaq', 'klXmasShip'].forEach(drop); return; }
    style();
    // (b) next to the delivery line (hero "+ £x UK delivery …")
    line('klXmasHero', 'kl-xmas kl-xmas-hero', 'div', short, doc.querySelector('.hero .launchfee'));
    // (c) under the bag totals
    line('klXmasBag', 'kl-xmas kl-xmas-bag', 'div', short, doc.getElementById('cartPre'));
    // (a) index.html "Good to know" FAQ: right after "When will my order arrive?"
    drop('klXmasFaq');
    var grid = doc.querySelector('.gtknow-grid');
    if (grid) {
      var f = doc.createElement('div'); f.id = 'klXmasFaq'; f.className = 'faq kl-xmas-faq';
      var q = doc.createElement('p'); q.className = 'faq-q'; q.textContent = XM_FAQ_Q;
      var a = doc.createElement('p'); a.className = 'faq-a'; a.textContent = long;
      f.appendChild(q); f.appendChild(a);
      var qs = grid.querySelectorAll('.faq-q'), at = null;
      for (var i = 0; i < qs.length; i++) if (/^When will my order arrive/.test(qs[i].textContent)) at = qs[i].parentNode;
      if (at) after(at, f); else grid.appendChild(f);
    }
    // shipping-returns.html: under the delivery list
    line('klXmasShip', 'kl-xmas-ship', 'p', long, doc.querySelector('[data-kl-xmas-anchor]'));
  }
  W.klXmasApply = function (c) { try { apply(c); } catch (e) { /* no notice */ } };

  // Pages without the live-stock loader ask /api/stock themselves (short timeout; any failure = no notice).
  var me = doc.currentScript;
  if (me && me.hasAttribute('data-kl-xmas-fetch')) {
    var go = function () {
      try {
        var ac = typeof AbortController === 'function' ? new AbortController() : null;
        var t = setTimeout(function () { if (ac) ac.abort(); }, 5000);
        fetch('/api/stock', ac ? { signal: ac.signal } : {}).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { clearTimeout(t); W.klXmasApply(d && d.christmas); })
          .catch(function () { clearTimeout(t); });
      } catch (e) { /* no notice */ }
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', go); else go();
  }
})(typeof window !== 'undefined' ? window : null);
