/**
 * Checkout protection: bots, floods and duplicate receipts.
 *
 * Bots were calling POST /initialize with made-up names, emails and numbers.
 * Every call created a customer and an abandoned transaction in Paystack, so
 * the dashboard filled with junk. Nothing was ever paid or unlocked (prices
 * and payment checks are server-side, see index.js), but the noise hides real
 * customers and costs Paystack goodwill. Four layers, cheapest first:
 *
 *   1. Origin + honeypot   a request must come from our pages, and the hidden
 *                          `website` field, which people never see, must be empty.
 *   2. Turnstile           Cloudflare's bot check (invisible for most people).
 *                          Switched on by setting the TURNSTILE_SECRET secret.
 *   3. Limits              per IP, per email, per WhatsApp number and overall,
 *                          kept in the PayGuard Durable Object below.
 *   4. Real email domain   the email's domain must exist and accept mail (MX),
 *                          checked over DNS-over-HTTPS.
 *
 * Only then does the Worker call Paystack. The Durable Object also records each
 * order's status, so a receipt is emailed once per payment, however many times
 * /verify or the webhook fire for it.
 *
 * Privacy: PayGuard stores no names, emails or numbers. Limits are counted
 * against SHA-256 hashes, and order records hold the product, status and times.
 * Counters expire after their window; order records after ORDER_DAYS.
 */

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DOH = 'https://cloudflare-dns.com/dns-query';
const TURNSTILE_HOSTS = ['thetechhut.co', 'www.thetechhut.co', '127.0.0.1', 'localhost'];
const ORDER_DAYS = 400;
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** How many checkout starts are allowed. A real buyer retrying a failed M-Pesa
 *  prompt a few times stays well inside these; a script does not. */
export const LIMITS = {
  ipBurst:   { limit: 5,   window: 10 * MIN },
  ipDay:     { limit: 20,  window: DAY },
  emailDay:  { limit: 6,   window: DAY },
  phoneDay:  { limit: 6,   window: DAY },
  allHour:   { limit: 200, window: HOUR },   // a spread-out attack trips this
  verifyIp:  { limit: 40,  window: 10 * MIN },
};

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cloudflare Turnstile. Off (always true) until TURNSTILE_SECRET is set. */
export async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch(TURNSTILE_VERIFY, { method: 'POST', body: form });
    const d = await r.json();
    if (d.success !== true) return false;
    if (d.action && d.action !== 'checkout') return false;
    if (d.hostname && !TURNSTILE_HOSTS.includes(d.hostname)) return false;
    return true;
  } catch (e) {
    return false;                 // with the check switched on, no answer means no
  }
}

/** Does the email's domain exist and take mail? Unknown (DNS down, slow) counts as yes:
 *  a real buyer must never be turned away because a lookup timed out. */
const domainCache = new Map();
async function dns(name, type) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch(DOH + '?name=' + encodeURIComponent(name) + '&type=' + type,
      { headers: { Accept: 'application/dns-json' }, signal: ctrl.signal });
    const d = await r.json();
    return typeof d.Status === 'number' ? d : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
export async function emailDomainOk(email) {
  const domain = String(email || '').split('@')[1];
  if (!domain) return false;
  const key = domain.toLowerCase();
  if (domainCache.has(key)) return domainCache.get(key);
  let ok = true;
  const mx = await dns(key, 'MX');
  if (mx) {
    if (mx.Status === 3) ok = false;                                    // no such domain
    else if (mx.Status === 0) {
      const recs = (mx.Answer || []).filter((a) => a.type === 15);
      if (recs.length && recs.every((a) => /^\s*0\s+\.?\s*$/.test(a.data))) ok = false;   // "null MX": takes no mail
      else if (!recs.length) {
        const a = await dns(key, 'A');                                  // mail can fall back to the A record
        if (a && a.Status === 0 && !(a.Answer || []).some((x) => x.type === 1)) ok = false;
        if (a && a.Status === 3) ok = false;
      }
    }
  }
  if (domainCache.size > 500) domainCache.clear();
  domainCache.set(key, ok);
  return ok;
}

/* ---------------------------------------------------- the Durable Object */

/**
 * One instance ('guard') holds every counter and order record. Its storage is
 * the plain key-value API, the same as GameStats, so tests can fake it.
 *
 *   POST {op:'hit',   keys:[{k, limit, window}]} -> {ok, retryAfter?}  checks all, then counts all
 *   POST {op:'order', ref, product}              -> {ok}                records a started checkout
 *   POST {op:'paid',  ref, product, via}         -> {first}             true only the first time
 */
export class PayGuard {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(req) {
    let b = {};
    try { b = await req.json(); } catch (e) { return Response.json({ error: 'bad request' }, { status: 400 }); }
    const now = Date.now();
    if (b.op === 'hit') return Response.json(await this.hit(b.keys || [], now));
    if (b.op === 'order') {
      const k = 'o:' + b.ref;
      if (!(await this.storage.get(k))) await this.storage.put(k, { product: b.product, status: 'started', at: now });
      await this.schedule(now);
      return Response.json({ ok: true });
    }
    if (b.op === 'paid') {
      const k = 'o:' + b.ref;
      const o = (await this.storage.get(k)) || { product: b.product, at: now };
      const first = !o.receiptAt;
      if (first) await this.storage.put(k, { ...o, status: 'paid', paidAt: o.paidAt || now, receiptAt: now, via: b.via });
      return Response.json({ first });
    }
    return Response.json({ error: 'unknown op' }, { status: 400 });
  }

  async hit(keys, now) {
    const rows = keys.map((x) => {
      const bucket = Math.floor(now / x.window);
      return { ...x, key: 'c:' + x.k + ':' + bucket, ends: (bucket + 1) * x.window };
    });
    let retryAfter = 0;
    for (const r of rows) {
      const n = (await this.storage.get(r.key)) || 0;
      if (n >= r.limit) retryAfter = Math.max(retryAfter, Math.ceil((r.ends - now) / 1000));
    }
    if (retryAfter) return { ok: false, retryAfter };
    const put = {};
    for (const r of rows) put[r.key] = ((await this.storage.get(r.key)) || 0) + 1;
    // remember when each counter can go, for the clean-up alarm
    for (const r of rows) put['x:' + r.ends + ':' + r.key] = 1;
    await this.storage.put(put);
    await this.schedule(now);
    return { ok: true };
  }

  async schedule(now) {
    if (typeof this.storage.getAlarm !== 'function') return;
    if (!(await this.storage.getAlarm())) await this.storage.setAlarm(now + HOUR);
  }

  /** Hourly: drop expired counters, and order records older than ORDER_DAYS. */
  async alarm() {
    const now = Date.now();
    const gone = [];
    for (const [k] of await this.storage.list({ prefix: 'x:', end: 'x:' + now })) {
      gone.push(k, k.slice(k.indexOf(':', 2) + 1));
    }
    const old = now - ORDER_DAYS * DAY;
    for (const [k, o] of await this.storage.list({ prefix: 'o:' })) if (o && o.at < old) gone.push(k);
    for (let i = 0; i < gone.length; i += 128) await this.storage.delete(gone.slice(i, i + 128));
    const left = await this.storage.list({ prefix: 'x:', limit: 1 });
    if (left.size) await this.storage.setAlarm(now + HOUR);
  }
}

/** Talk to the guard. With no binding (tests, or before the first deploy with
 *  it) or if it errors, checkout carries on: limits must never block a sale. */
export async function guard(env, body) {
  if (!env.PAY_GUARD) return null;
  try {
    const stub = env.PAY_GUARD.get(env.PAY_GUARD.idFromName('guard'));
    const r = await stub.fetch('https://guard/', { method: 'POST', body: JSON.stringify(body) });
    return await r.json();
  } catch (e) {
    return null;
  }
}
