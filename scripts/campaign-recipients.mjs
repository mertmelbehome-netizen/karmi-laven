// scripts/campaign-recipients.mjs — builds the Karmi Laven marketing recipient list. It NEVER sends anything.
//
// Pure function (for the sender Mert / Komuta run):
//   buildRecipients({ subscribers, suppressed, internal, consentFrom, consentTo, secret, base })
//     subscribers: [{ email, created_at }]          (public.karmi_subscribers)
//     suppressed:  ['<sha256 hex>', ...]            (public.marketing_suppression.email_sha256)
//     internal:    ['a@b.com', '@melbehome.co.uk']  exact addresses, or '@domain' for a whole domain
//     consentFrom: created_at >= consentFrom (ISO date/time, optional)
//     consentTo:   created_at <  consentTo   (ISO date/time, EXCLUSIVE, optional)
//   → { recipients: [{ email, hash, unsubscribeUrl, headers, footerHtml, footerText }], counts }
//     counts = { total, after_consent_window, after_suppression, after_internal } (duplicates by hash removed first)
//
// Dry-run CLI (prints counts only, never an address):
//   node scripts/campaign-recipients.mjs --consent-from 2026-07-01 --consent-to 2026-08-05 --internal a@x.com,@melbehome.co.uk
//   env: OPS_SUPABASE_URL, OPS_SUPABASE_SERVICE_KEY (read-only GETs), and KARMI_UNSUB_SECRET exactly as set in Vercel
//   (if Vercel has KARMI_UNSUB_SECRET, the sender must have the same value, or the links will not verify).
import { pathToFileURL } from 'node:url';
import { emailHash, unsubUrl, listUnsubscribeHeaders, unsubFooterHtml, unsubFooterText, unsubSecret, UNSUB_BASE } from '../api/_unsub.js';

function toTime(v, name) {
  if (v === undefined || v === null || v === '') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error(`${name}: not a date/time: ${v}`);
  return t;
}

export function isInternal(email, internal = []) {
  const e = String(email).trim().toLowerCase();
  return internal.some((x) => {
    const i = String(x).trim().toLowerCase();
    if (!i) return false;
    return i.startsWith('@') ? e.endsWith(i) : e === i;
  });
}

export function buildRecipients({ subscribers = [], suppressed = [], internal = [], consentFrom, consentTo, secret, base = UNSUB_BASE } = {}) {
  if (!secret || !secret.length) throw new Error('unsubscribe secret not configured');
  const from = toTime(consentFrom, 'consentFrom');
  const to = toTime(consentTo, 'consentTo');
  const sup = new Set(suppressed.map((s) => String(s).toLowerCase()));

  const seen = new Set();
  const all = [];
  for (const s of subscribers) {
    const email = String(s.email ?? '').trim().toLowerCase();
    if (!email) continue;
    const hash = emailHash(email);
    if (seen.has(hash)) continue;
    seen.add(hash);
    all.push({ email, hash, created_at: s.created_at });
  }
  const inWindow = all.filter((r) => {
    if (from === null && to === null) return true;
    const t = Date.parse(r.created_at);
    if (Number.isNaN(t)) return false; // unknown sign-up date → outside any window
    return (from === null || t >= from) && (to === null || t < to);
  });
  const notSuppressed = inWindow.filter((r) => !sup.has(r.hash));
  const final = notSuppressed.filter((r) => !isInternal(r.email, internal));

  const recipients = final.map(({ email, hash }) => {
    const url = unsubUrl(email, secret, base);
    return { email, hash, unsubscribeUrl: url, headers: listUnsubscribeHeaders(email, secret, base), footerHtml: unsubFooterHtml(url), footerText: unsubFooterText(url) };
  });
  return {
    recipients,
    counts: { total: all.length, after_consent_window: inWindow.length, after_suppression: notSuppressed.length, after_internal: final.length },
  };
}

/** Read-only fetch of subscribers + suppression hashes (service role REST GETs). */
export async function loadLists({ base, key, fetchImpl = (...a) => fetch(...a) }) {
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Range-Unit': 'items' };
  const get = async (path) => {
    const r = await fetchImpl(`${base}/rest/v1/${path}`, { headers: h });
    if (!r.ok) throw new Error(`read ${path.split('?')[0]} failed: HTTP ${r.status}`);
    return r.json();
  };
  const subscribers = await get('karmi_subscribers?select=email,created_at&limit=10000');
  const suppressed = (await get('marketing_suppression?select=email_sha256&limit=10000')).map((r) => r.email_sha256);
  return { subscribers, suppressed };
}

export function parseArgs(argv) {
  const o = { internal: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--consent-from') { o.consentFrom = v; i++; }
    else if (a === '--consent-to') { o.consentTo = v; i++; }
    else if (a === '--internal') { o.internal.push(...String(v || '').split(',').filter(Boolean)); i++; }
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

export function formatCounts(counts, o = {}) {
  return [
    `DRY RUN — nothing sent, no addresses printed`,
    `consent window: ${o.consentFrom || '(any)'} <= created_at < ${o.consentTo || '(any)'}`,
    `internal exclusions given: ${(o.internal || []).length}`,
    `total subscribers (unique):  ${counts.total}`,
    `after consent window:        ${counts.after_consent_window}`,
    `after suppression:           ${counts.after_suppression}`,
    `after internal exclusion:    ${counts.after_internal}   <- would receive the email`,
  ].join('\n');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log('node scripts/campaign-recipients.mjs [--consent-from ISO] [--consent-to ISO (exclusive)] [--internal a@x.com,@domain]'); return; }
  const base = process.env.OPS_SUPABASE_URL, key = process.env.OPS_SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error('set OPS_SUPABASE_URL and OPS_SUPABASE_SERVICE_KEY');
  const lists = await loadLists({ base, key });
  const { counts } = buildRecipients({ ...lists, ...o, secret: unsubSecret(process.env) });
  console.log(formatCounts(counts, o));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('error:', e.message); process.exit(1); });
}
