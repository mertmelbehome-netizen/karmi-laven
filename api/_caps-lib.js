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

/** `timeoutMs` (optional): abort the call after that long (→ { ok: false }). */
export async function rpc(fn, args, { base, key, fetchImpl = fetch, timeoutMs } = {}) {
  if (!base || !key) return { ok: false, error: 'ops supabase env not set' };
  const ac = timeoutMs ? new AbortController() : null;
  try {
    const call = (async () => {
      const r = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        ...(ac ? { signal: ac.signal } : {}),
      });
      if (!r.ok) return { ok: false, error: `${fn} ${r.status}` };
      return { ok: true, data: await r.json() };
    })();
    return await (timeoutMs ? withTimeout(call, timeoutMs) : call);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    if (ac) ac.abort();
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
  paidLimit: 20, paidCallMs: 1500,
  // K2: Stripe 404 burst guard
  missingBurstMax: 3, missingWindowMs: 30 * 60 * 1000, missingAlarmEveryMs: 30 * 60 * 1000,
});

/**
 * K2: the Stripe mode of a secret / restricted key ('live' | 'test' | 'unknown'). Reads only the prefix; the key is
 * never logged or returned.
 */
export function stripeKeyMode(key) {
  if (typeof key !== 'string') return 'unknown';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}
/** K2: the mode a Checkout Session id was created in ('live' | 'test' | 'unknown'). */
export function sessionMode(sid) {
  if (typeof sid !== 'string') return 'unknown';
  if (sid.startsWith('cs_live_')) return 'live';
  if (sid.startsWith('cs_test_')) return 'test';
  return 'unknown';
}

let lastPaidCheck = 0;
let recentMissing = []; // K2: times (ms) of holds freed because Stripe said 404, in this instance
let lastMissingAlarm = 0;
/** Test hook: forget when the paid-but-unrecorded check last ran, and the K2 404 history, in this instance. */
export function _resetPaidCheck() { lastPaidCheck = 0; recentMissing = []; lastMissingAlarm = 0; }

/**
 * F1 (K&D 23 Nov): a hold attached to a short Stripe session keeps counting after its 40 min until Stripe's outcome
 * is known. Ask Stripe about the ones past their time (fn_karmi_holds_to_check — least recently checked first, N1)
 * and report each outcome: 'complete' → keeps counting until the webhook writes the order; 'expired' → released.
 * Error / timeout → nothing is reported and the hold keeps counting (under-sell, never over-sell).
 *
 * A session Stripe does not know (404 / resource_missing, N1) is freed as expired ONLY when (K2, K&D #36):
 *   (a) the key's mode (sk_live_/rk_live_ vs sk_test_/rk_test_) matches the session id's mode (cs_live_ / cs_test_) —
 *       otherwise a wrong key / test-vs-live mix-up would free real holds: never freed, logged as an error;
 *   (b) it is not a burst: more than `missingBurstMax` 404 frees in this run plus the last `missingWindowMs` in this
 *       instance, or (2 or more and) more than half of the sessions Stripe answered this run, looks like a wrong key /
 *       account → NONE are freed, error log + push alarm (Bearer WEBHOOK_SECRET when set; at most every 30 min).
 * Then (N3/K1) alarm on paid holds that still have no order row: awaited inside the request, each call with a short
 * timeout, and a session is marked "alarmed" only after the push answered 2xx. Best effort: never throws.
 */
export async function resolveStaleHolds(stripe, env, opts = {}) {
  const o = { ...RESOLVER_DEFAULTS, ...opts };
  const keyMode = o.keyMode !== undefined ? o.keyMode : stripeKeyMode(process.env.STRIPE_SECRET);
  const out = { checked: 0, complete: 0, expired: 0, missing: 0, failed: 0, timedOut: 0, budgetHit: false, unrecorded: 0,
    modeMismatch: 0, missingBlocked: 0 };
  const deadline = Date.now() + o.budgetMs;
  const missingCandidates = [];

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
      if (isMissingSession(e)) {
        const sm = sessionMode(sid);
        if (keyMode !== 'unknown' && keyMode === sm) missingCandidates.push(sid);
        else {
          out.modeMismatch++;
          console.error(`[caps] Stripe says a ${sm}-mode session does not exist, but the key is ${keyMode}-mode `
            + '(wrong key / account / test-vs-live mix-up?): hold NOT freed, keeps counting');
        }
      } else if (e && e.code === 'caps_timeout') out.timedOut++;
      else out.failed++;
      if (!isMissingSession(e)) console.warn('[caps] Stripe session lookup failed; hold keeps counting:', (e && e.message) || e);
    }
    out.checked++;
    if (!outcome) return;
    const w = await rpc('fn_karmi_checkout_resolve', { p_session_id: sid, p_outcome: outcome }, env);
    if (w.ok) out[outcome]++;
  };

  // K2 (b): free the 404 sessions only when they do not look like a wrong key / account.
  const settleMissing = async () => {
    if (!missingCandidates.length) return;
    const now = Date.now();
    recentMissing = recentMissing.filter((t) => now - t < o.missingWindowMs);
    const answered = out.checked - out.timedOut - out.failed;
    const n = missingCandidates.length;
    const burst = n + recentMissing.length > o.missingBurstMax || (n >= 2 && n * 2 > answered);
    if (burst) {
      out.missingBlocked = n;
      const detail = `${n} of ${answered} Stripe sessions answered "does not exist" (404) in one check`
        + (recentMissing.length ? ` (+${recentMissing.length} freed in the last ${Math.round(o.missingWindowMs / 60000)} min)` : '')
        + ': holds NOT freed, they keep counting. Check the STRIPE_SECRET key / account / mode.';
      console.error('[caps] STRIPE 404 BURST:', detail);
      if (now - lastMissingAlarm >= o.missingAlarmEveryMs) {
        const sent = await pushNotify('Karmi caps: Stripe 404 burst, holds kept', detail,
          { ...(o.appUrl !== undefined ? { appUrl: o.appUrl } : {}), ...(o.secret !== undefined ? { secret: o.secret } : {}),
            ...(env && env.fetchImpl ? { fetchImpl: env.fetchImpl } : {}), timeoutMs: o.paidCallMs });
        if (sent) lastMissingAlarm = now;
      }
      return;
    }
    for (const sid of missingCandidates) {
      const w = await rpc('fn_karmi_checkout_resolve', { p_session_id: sid, p_outcome: 'expired' }, env);
      if (w.ok) { out.expired++; out.missing++; recentMissing.push(Date.now()); }
    }
  };

  const work = async () => {
    const canAsk = !!(stripe && stripe.checkout && stripe.checkout.sessions && stripe.checkout.sessions.retrieve);
    if (!canAsk) return;
    const r = await rpc('fn_karmi_holds_to_check', { p_limit: o.max }, env);
    if (!(r.ok && Array.isArray(r.data))) return;
    const queue = r.data.slice(0, o.max)
      .map((row) => (typeof row === 'string' ? row : row && (row.fn_karmi_holds_to_check || row.stripe_session_id)))
      .filter(Boolean);
    const worker = async () => {
      while (queue.length && Date.now() < deadline) await lookup(queue.shift());
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency, queue.length)) }, worker));
    await settleMissing();
  };

  let t;
  const budget = new Promise((resolve) => { t = setTimeout(() => { out.budgetHit = true; resolve(); }, o.budgetMs); });
  try {
    await Promise.race([work().catch((e) => console.warn('[caps] hold resolver error (holds keep counting):', (e && e.message) || e)), budget]);
  } finally {
    clearTimeout(t);
  }
  if (out.budgetHit) console.warn('[caps] hold resolver stopped at its time budget; unanswered holds keep counting');

  // K1: the paid-not-recorded alarm runs here, awaited (not past the budget in the background), each call with a
  // short timeout; throttled per instance so it costs a request at most once per `paidCheckEveryMs`.
  if (o.paidAlarm && Date.now() - lastPaidCheck >= o.paidCheckEveryMs) {
    lastPaidCheck = Date.now();
    try {
      const a = await alarmUnrecordedPaid(env, { minAge: o.paidMinAge, limit: o.paidLimit, appUrl: o.appUrl,
        secret: o.secret, timeoutMs: o.paidCallMs });
      out.unrecorded = a.total;
    } catch (e) {
      console.warn('[caps] paid-not-recorded check failed (will retry):', (e && e.message) || e);
    }
  }
  return { ...out };
}

/**
 * Push to ops-v2 /api/orders/notify (owner + clocked-in WAT staff). Best effort. Returns true ONLY when the route
 * answered 2xx (K1: a 401 / 5xx / timeout is a failed push). `timeoutMs` aborts a hanging push (default 2.5 s).
 */
export async function pushNotify(title, detail, { appUrl = process.env.OPS_APP_URL, fetchImpl = fetch,
  secret = process.env.WEBHOOK_SECRET, timeoutMs = 2500 } = {}) {
  if (!appUrl) return false;
  const ac = new AbortController();
  try {
    const r = await withTimeout(fetchImpl(`${appUrl}/api/orders/notify`, {
      method: 'POST', headers: notifyHeaders(secret), body: JSON.stringify({ title, detail, url: '/orders' }), signal: ac.signal,
    }), timeoutMs);
    const status = r && typeof r.status === 'number' ? r.status : 0;
    if (!(r && r.ok) || status < 200 || status >= 300) {
      console.warn(`[caps] notify push not accepted (HTTP ${status || '?'}); counts as not sent`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[caps] notify push failed (non-fatal):', (e && e.message) || e);
    return false;
  } finally {
    ac.abort();
  }
}

const sessionLine = (it) => `${it.session}: ${(it.lines || []).map((l) =>
  `${l.qty} x ${l.name}${l.bc ? ` (${l.bc})` : ''}`).join(', ')}`;

/**
 * N3 + K1 (K&D 23 Nov): a Stripe-paid hold with no online_orders row after `minAge` = an order the shop has not
 * recorded (ops down past Stripe's retries, env missing, ...). Log + push for a MANUAL check. The read
 * (fn_karmi_paid_unrecorded_due) marks nothing; the push names EVERY listed session plus the full count, and only after
 * it answered 2xx are exactly those sessions marked (fn_karmi_paid_unrecorded_mark → next alarm for them in 24 h).
 * A failed push marks nothing, so the next check (≤ 5 min) tries again. The hold keeps counting: nothing is released
 * or refunded. Returns { items, total, sent, marked }.
 */
export async function alarmUnrecordedPaid(env, { minAge = '2 hours', limit = 20, appUrl, secret, timeoutMs = 1500 } = {}) {
  const callEnv = { ...env, timeoutMs };
  const r = await rpc('fn_karmi_paid_unrecorded_due', { p_min_age: minAge, p_limit: limit }, callEnv);
  const items = r.ok && r.data && Array.isArray(r.data.items) ? r.data.items.filter((it) => it && it.session) : [];
  if (!r.ok) console.warn('[caps] paid-not-recorded check failed (will retry):', r.error);
  if (!items.length) return { items, total: 0, sent: false, marked: 0 };
  const total = Math.max(items.length, Number(r.data.total) || 0);
  const head = total > items.length
    ? `${total} paid sessions without an order row (oldest ${items.length} listed; the rest follow in the next alarm): `
    : `${total} paid session${total === 1 ? '' : 's'} without an order row: `;
  const detail = head + items.map(sessionLine).join('; ');
  console.warn('[caps] PAID ORDER NOT RECORDED (manual check; hold keeps counting, no refund):', detail);
  const sent = await pushNotify('Karmi paid order not recorded: manual check', detail,
    { ...(appUrl !== undefined ? { appUrl } : {}), ...(secret !== undefined ? { secret } : {}),
      ...(env && env.fetchImpl ? { fetchImpl: env.fetchImpl } : {}), timeoutMs });
  if (!sent) {
    console.warn('[caps] paid-not-recorded push not sent: nothing marked, the next check alarms again');
    return { items, total, sent: false, marked: 0 };
  }
  const m = await rpc('fn_karmi_paid_unrecorded_mark', { p_session_ids: items.map((it) => it.session) }, callEnv);
  if (!m.ok) console.warn('[caps] paid-not-recorded mark failed (the alarm may repeat):', m.error);
  return { items, total, sent: true, marked: m.ok ? Number(m.data) || 0 : 0 };
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
