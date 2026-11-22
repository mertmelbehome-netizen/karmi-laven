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

/**
 * F1 (K&D 23 Nov): a hold attached to a short Stripe session keeps counting after its 40 min until Stripe's outcome
 * is known. Ask Stripe about the ones past their time (fn_karmi_holds_to_check) and report each outcome:
 * 'complete' → keeps counting until the webhook writes the order; 'expired' → released. Any error → nothing is
 * reported and the hold keeps counting (under-sell, never over-sell). Best effort: never throws.
 */
export async function resolveStaleHolds(stripe, env, { max = 10 } = {}) {
  const out = { checked: 0, complete: 0, expired: 0 };
  if (!stripe || !stripe.checkout || !stripe.checkout.sessions || !stripe.checkout.sessions.retrieve) return out;
  const r = await rpc('fn_karmi_holds_to_check', { p_limit: max }, env);
  if (!r.ok || !Array.isArray(r.data)) return out;
  for (const row of r.data.slice(0, max)) {
    const sid = typeof row === 'string' ? row : row && (row.fn_karmi_holds_to_check || row.stripe_session_id);
    if (!sid) continue;
    let outcome = null;
    try {
      const s = await stripe.checkout.sessions.retrieve(sid);
      if (s && s.status === 'complete') outcome = 'complete';
      else if (s && s.status === 'expired') outcome = 'expired';
    } catch (e) {
      console.warn('[caps] Stripe session lookup failed; hold keeps counting:', (e && e.message) || e);
    }
    out.checked++;
    if (!outcome) continue;
    const w = await rpc('fn_karmi_checkout_resolve', { p_session_id: sid, p_outcome: outcome }, env);
    if (w.ok) out[outcome]++;
  }
  return out;
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
