// api/_caps-lib.js — calls to the online caps / price / Christmas cut-off functions in the ops Supabase
// (db/20261122230000_karmi_online_caps.sql). Service role only; never shipped to the browser.
//
// Every call returns { ok: true, data } or { ok: false, error } (env missing, HTTP error, network error).
// What a failure MEANS is decided by the caller:
//   * cart with any non-Gradient product  -> refuse (fail CLOSED, 503)
//   * Gradient-Edit-only cart             -> fail OPEN as before, EXCEPT inside the Christmas limit window or after
//                                            the cut-off, which cannot be verified without the DB (gradientFallback).

/** Built-in copy of the Christmas 2026 dates, used ONLY when the DB cannot be read (karmi_online_window is the source). */
export const FALLBACK_WINDOW = Object.freeze({
  limitFrom: '2026-12-13T00:00:00Z', // 13 Dec 00:00 London (GMT in December)
  recoveryOffFrom: '2026-12-13T00:00:00Z', // no Stripe recovery link for sessions created from here
  message: "Sorry — we can't take online orders right now. Please try again shortly.",
});

export const MSG_UNAVAILABLE = "We can't confirm stock right now, please try again shortly.";

export async function rpc(fn, args, { base, key, fetchImpl = fetch } = {}) {
  if (!base || !key) return { ok: false, error: 'ops supabase env not set' };
  try {
    const r = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) return { ok: false, error: `${fn} ${r.status}` };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** otherQty {bc: qty} = non-Gradient barcodes; gradientUnits = Gradient Edit unit count. */
export function reserve(ref, otherQty, gradientUnits, env) {
  const items = Object.entries(otherQty).map(([bc, qty]) => ({ bc, qty }));
  return rpc('fn_karmi_checkout_reserve', { p_ref: ref, p_items: items, p_gradient_units: gradientUnits }, env);
}
export const attach = (ref, sessionId, env) => rpc('fn_karmi_checkout_attach', { p_ref: ref, p_session_id: sessionId }, env);
export const release = (ref, env) => rpc('fn_karmi_checkout_release', { p_ref: ref }, env);
export const status = (barcodes, env) => rpc('fn_karmi_online_status', { p_barcodes: barcodes }, env);
export const flagLate = (sessionId, env) => rpc('fn_karmi_flag_late_order', { p_session_id: sessionId }, env);
export const complete = (ref, sessionId, env) => rpc('fn_karmi_checkout_complete', { p_ref: ref, p_session_id: sessionId }, env);
export const overshoot = (sessionId, env) => rpc('fn_karmi_cap_overshoot', { p_session_id: sessionId }, env);

/** Stripe says the session does not exist (404 / resource_missing): it can never be paid → treat as expired (N1). */
export function isMissingSession(e) {
  return !!e && (e.statusCode === 404 || e.code === 'resource_missing' || (e.raw && e.raw.code === 'resource_missing'));
}

/** Rejects after `ms` (the underlying call is not cancelled; its late answer is ignored). */
export function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error(`timed out after ${ms} ms`), { code: 'caps_timeout' })), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

/**
 * Resolver limits (N2, K&D 23 Nov). Every Stripe lookup has its own short timeout and no retries, at most
 * `concurrency` run at once, and the whole resolver (DB calls included) returns after `budgetMs` at the latest.
 * Anything not answered in time is simply not reported: that hold keeps counting (fail closed for caps); the
 * caller then admits / reads as usual, so a slow Stripe never blocks a Gradient-only cart.
 */
export const RESOLVER_DEFAULTS = Object.freeze({
  max: 10, concurrency: 3, perCallMs: 2500, budgetMs: 3000,
  paidAlarm: true, paidMinAge: '2 hours', paidCheckEveryMs: 5 * 60 * 1000,
});

let lastPaidCheck = 0;
/** Test hook: forget when the paid-but-unrecorded check last ran in this instance. */
export function _resetPaidCheck() { lastPaidCheck = 0; }

/**
 * F1 (K&D 23 Nov): a hold attached to a short Stripe session keeps counting after its 40 min until Stripe's outcome
 * is known. Ask Stripe about the ones past their time (fn_karmi_holds_to_check — least recently checked first, N1)
 * and report each outcome: 'complete' → keeps counting until the webhook writes the order; 'expired' or a session
 * Stripe does not know (404, N1) → released. Error / timeout → nothing is reported and the hold keeps counting
 * (under-sell, never over-sell). Then (N3) alarm on paid holds that still have no order row. Best effort: never throws.
 */
export async function resolveStaleHolds(stripe, env, opts = {}) {
  const o = { ...RESOLVER_DEFAULTS, ...opts };
  const out = { checked: 0, complete: 0, expired: 0, missing: 0, failed: 0, timedOut: 0, budgetHit: false, unrecorded: 0 };
  const deadline = Date.now() + o.budgetMs;

  const lookup = async (sid) => {
    const left = deadline - Date.now();
    if (left <= 0) return;
    const ms = Math.max(1, Math.min(o.perCallMs, left));
    let outcome = null;
    try {
      const s = await withTimeout(stripe.checkout.sessions.retrieve(sid, {}, { timeout: ms, maxNetworkRetries: 0 }), ms);
      if (s && s.status === 'complete') outcome = 'complete';
      else if (s && s.status === 'expired') outcome = 'expired';
    } catch (e) {
      if (isMissingSession(e)) { outcome = 'expired'; out.missing++; }
      else if (e && e.code === 'caps_timeout') out.timedOut++;
      else out.failed++;
      if (!outcome) console.warn('[caps] Stripe session lookup failed; hold keeps counting:', (e && e.message) || e);
    }
    out.checked++;
    if (!outcome) return;
    const w = await rpc('fn_karmi_checkout_resolve', { p_session_id: sid, p_outcome: outcome }, env);
    if (w.ok) out[outcome]++;
  };

  const work = async () => {
    const canAsk = !!(stripe && stripe.checkout && stripe.checkout.sessions && stripe.checkout.sessions.retrieve);
    if (canAsk) {
      const r = await rpc('fn_karmi_holds_to_check', { p_limit: o.max }, env);
      if (r.ok && Array.isArray(r.data)) {
        const queue = r.data.slice(0, o.max)
          .map((row) => (typeof row === 'string' ? row : row && (row.fn_karmi_holds_to_check || row.stripe_session_id)))
          .filter(Boolean);
        const worker = async () => {
          while (queue.length && Date.now() < deadline) await lookup(queue.shift());
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency, queue.length)) }, worker));
      }
    }
    if (o.paidAlarm && Date.now() - lastPaidCheck >= o.paidCheckEveryMs) {
      lastPaidCheck = Date.now();
      const a = await alarmUnrecordedPaid(env, { minAge: o.paidMinAge, appUrl: o.appUrl, secret: o.secret });
      out.unrecorded = a.items.length;
    }
  };

  let t;
  const budget = new Promise((resolve) => { t = setTimeout(() => { out.budgetHit = true; resolve(); }, o.budgetMs); });
  try {
    await Promise.race([work().catch((e) => console.warn('[caps] hold resolver error (holds keep counting):', (e && e.message) || e)), budget]);
  } finally {
    clearTimeout(t);
  }
  if (out.budgetHit) console.warn('[caps] hold resolver stopped at its time budget; unanswered holds keep counting');
  return { ...out };
}

/** Push to ops-v2 /api/orders/notify (owner + clocked-in WAT staff). Best effort; returns true when sent. */
export async function pushNotify(title, detail, { appUrl = process.env.OPS_APP_URL, fetchImpl = fetch, secret = process.env.WEBHOOK_SECRET } = {}) {
  if (!appUrl) return false;
  try {
    await fetchImpl(`${appUrl}/api/orders/notify`, {
      method: 'POST', headers: notifyHeaders(secret), body: JSON.stringify({ title, detail, url: '/orders' }),
    });
    return true;
  } catch (e) {
    console.warn('[caps] notify push failed (non-fatal):', (e && e.message) || e);
    return false;
  }
}

/**
 * N3 (K&D 23 Nov): a Stripe-paid hold with no online_orders row after `minAge` = an order the shop has not
 * recorded (ops down past Stripe's retries, env missing, ...). Log + push for a MANUAL check, at most once per
 * session per 24 h (fn_karmi_paid_unrecorded). The hold keeps counting: nothing is released or refunded.
 */
export async function alarmUnrecordedPaid(env, { minAge = '2 hours', appUrl, secret } = {}) {
  const r = await rpc('fn_karmi_paid_unrecorded', { p_min_age: minAge, p_limit: 10 }, env);
  const items = r.ok && r.data && Array.isArray(r.data.items) ? r.data.items : [];
  if (!items.length) return { items };
  const detail = items.slice(0, 5).map((it) => `${it.session}: ${(it.lines || []).map((l) =>
    `${l.qty} x ${l.name}${l.bc ? ` (${l.bc})` : ''}`).join(', ')}`).join('; ');
  console.warn('[caps] PAID ORDER NOT RECORDED (manual check; hold keeps counting, no refund):', detail);
  await pushNotify('Karmi paid order not recorded: manual check', detail,
    { ...(appUrl !== undefined ? { appUrl } : {}), ...(secret !== undefined ? { secret } : {}), ...(env && env.fetchImpl ? { fetchImpl: env.fetchImpl } : {}) });
  return { items };
}

/** Headers for ops-v2 /api/orders/notify: the route reads the body only with the WEBHOOK_SECRET bearer (F6). */
export function notifyHeaders(secret = process.env.WEBHOOK_SECRET) {
  const h = { 'Content-Type': 'application/json' };
  if (secret) h.Authorization = `Bearer ${secret}`;
  return h;
}

/** Gradient-only cart while the DB is unreadable: allowed before the limit window, refused from it on. */
export function gradientFallback(now = new Date()) {
  if (now.getTime() >= Date.parse(FALLBACK_WINDOW.limitFrom)) return { ok: false, message: FALLBACK_WINDOW.message };
  return { ok: true, recoveryOk: now.getTime() < Date.parse(FALLBACK_WINDOW.recoveryOffFrom) };
}
