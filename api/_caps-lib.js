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

/** Gradient-only cart while the DB is unreadable: allowed before the limit window, refused from it on. */
export function gradientFallback(now = new Date()) {
  if (now.getTime() >= Date.parse(FALLBACK_WINDOW.limitFrom)) return { ok: false, message: FALLBACK_WINDOW.message };
  return { ok: true, recoveryOk: now.getTime() < Date.parse(FALLBACK_WINDOW.recoveryOffFrom) };
}
