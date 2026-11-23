// api/_christmas.js — the Christmas last-order notice data for /api/stock (`christmas`, additive, 23 Nov 2026).
//
// Source = the ops table karmi_online_window (db/20261122230000_karmi_online_caps.sql), the same row the checkout
// cut-off uses (id 'christmas_2026': closes_at 16 Dec 00:00 London). Read-only GET with the service key, short
// timeout. Fail-safe: any error / no row / already closed -> null, and /api/stock then omits the field, so the page
// shows no notice (the existing closed message handles the time after closes_at).
//
// last_order_date = the London calendar day of the last moment orders are still taken (closes_at minus 1 ms):
// closes_at 2026-12-16 00:00 London -> '2026-12-15'. The visible date is formatted by the page from this field; no
// date is hard-coded in any visible copy. (FALLBACK_WINDOW in api/_caps-lib.js has no closes_at, so it is not used.)

const LONDON_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' London calendar day of a Date / ms. */
export function londonDay(t) {
  return LONDON_DAY.format(new Date(t));
}

/** Pure: a karmi_online_window row -> the public `christmas` object, or null (bad row / already closed). */
export function christmasFromRow(row, now = new Date()) {
  if (!row || typeof row !== 'object') return null;
  const closes = Date.parse(row.closes_at);
  if (!Number.isFinite(closes) || now.getTime() >= closes) return null;
  const lim = row.limit_from ? Date.parse(row.limit_from) : NaN;
  return {
    last_order_date: londonDay(closes - 1),
    closes_at: new Date(closes).toISOString(),
    limit_from: Number.isFinite(lim) ? new Date(lim).toISOString() : null,
  };
}

/**
 * Reads the next Christmas window (id christmas_*, closes_at still ahead). Never throws; null on any problem.
 * env: { base, key, fetchImpl?, timeoutMs?, now? }
 */
export async function christmasNotice({ base, key, fetchImpl, timeoutMs = 1500, now = new Date() } = {}) {
  if (!base || !key) return null;
  const f = fetchImpl || globalThis.fetch;
  const ac = new AbortController();
  let t;
  try {
    const url = `${base}/rest/v1/karmi_online_window?select=id,closes_at,limit_from&id=like.christmas*`
      + `&closes_at=gt.${encodeURIComponent(now.toISOString())}&order=closes_at.asc&limit=1`;
    const call = (async () => {
      const r = await f(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ac.signal });
      if (!r || !r.ok) return null;
      const rows = await r.json();
      return Array.isArray(rows) && rows.length ? christmasFromRow(rows[0], now) : null;
    })();
    const timer = new Promise((resolve) => { t = setTimeout(() => resolve(null), timeoutMs); });
    return await Promise.race([call.catch(() => null), timer]);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
    ac.abort();
  }
}
