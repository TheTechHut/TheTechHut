/**
 * The Tech Hut — Paystack backend.
 *
 * A Cloudflare Worker, because thetechhut.co is a static site on Firebase and
 * a static site cannot hold a secret. Paystack gives you two keys: the public
 * one (pk_…) is designed to sit in the page, and the secret one (sk_…) signs
 * every server call. This Worker is the only thing that ever sees the secret.
 *
 * It exists to answer two questions the browser is not allowed to answer:
 *
 *   how much does this product cost?   -> PRODUCTS below, never the client
 *   did this payment actually happen?  -> Paystack's verify endpoint, never
 *                                         the client's success callback
 *
 * Both matter. A page that reads the amount from the DOM lets anyone pay 1
 * shilling for the bundle, and a page that unlocks on its own callback can be
 * unlocked from the console without paying at all.
 *
 * Endpoints
 *   POST /initialize  { product, email, whatsapp, name? }  -> { access_code, reference }
 *   POST /verify      { reference }              -> { paid, product, delivery }
 *   POST /webhook     Paystack signed event      -> 200
 *   POST /subscribe   { email, name?, role? }    -> sends a confirmation email   (newsletter.js)
 *   POST /confirm     { t }                      -> adds to the Brevo list       (newsletter.js)
 *   POST /games/ping  { sid, visit?, slug?, pid?, name? } -> { live, visits, me? } (games.js)
 *   POST /games/leave { sid }                    -> { live, visits }             (games.js)
 *   GET  /games/board                            -> this week's arcade leaderboards (games.js)
 *   POST /games/login { credential }             -> { pid, sig, name }  Sign in with Google (games.js)
 *   POST /games/forget { pid, sig? }             -> { ok }              leave the leaderboards (games.js)
 *   GET  /health
 *
 * Secrets (wrangler secret put <NAME> — never commit these)
 *   PAYSTACK_SECRET_KEY   sk_test_… while testing, sk_live_… when you go live
 *   REMOTE_LIST_KEY       the Remote-From-Kenya List key (43 characters, from
 *                         node scripts/encrypt_remote_list.mjs --new-key). Also a GitHub
 *                         Actions secret: the daily job encrypts the list with it, and
 *                         the buyer's link carries it after #, where it decrypts the list.
 *   RESEND_API_KEY        optional; receipts go through Resend when set, otherwise
 *                         through Brevo (BREVO_API_KEY + BREVO_SENDER_EMAIL, below)
 *   COMMUNITIES_URL       the African Tech Community Database access link,
 *                         https://thetechhut.co/communities/db/#<key> (printed by
 *                         scripts/build_communities.mjs; the key decrypts the list).
 *                         A Notion page link (https://….notion.site/…) also works.
 *                         A secret for the same reason as the invite below.
 *   EARLY_ACCESS_INVITE   the WhatsApp group invite link (https://chat.whatsapp.com/...).
 *                         A secret, NOT a file: this repo is published, and the link
 *                         is only meant to be shown to someone who has paid.
 *   BREVO_API_KEY, BREVO_LIST_ID, BREVO_SENDER_EMAIL, SUBSCRIBE_SECRET
 *                         the CV Pack signup; see newsletter.js
 *   GAMES_SECRET          optional; any long random string. Needed for "Sign in with
 *                         Google" on the games arcade (signs player ids)
 *   TURNSTILE_SECRET      optional; the secret key of the Cloudflare Turnstile widget
 *                         whose site key is in assets/js/pay.js. Set, every checkout
 *                         must pass the bot check (see payguard.js)
 * Vars (wrangler.toml)
 *   GOOGLE_CLIENT_ID      optional; the OAuth web client id for the games arcade
 */

import { handleNewsletter, newsletterConfigured } from './newsletter.js';
import { handleGames } from './games.js';
import { handleMarket, settle as settleMarket } from './market.js';
import { LIMITS, guard, turnstileOk, emailDomainOk, sha256Hex } from './payguard.js';

// Durable Object classes must be exported from the entry module.
export { GameStats } from './games.js';
export { PayGuard } from './payguard.js';
export { Market } from './market.js';

const PAYSTACK = 'https://api.paystack.co';
const SITE = 'https://thetechhut.co';

const ALLOWED_ORIGINS = [SITE, 'https://www.thetechhut.co', 'http://127.0.0.1:8777'];

/**
 * Paystack takes amounts in the currency's SUBUNIT, so KES 500 is 50000.
 *
 * Getting this wrong is wrong by a factor of 100 in one direction or the
 * other, so do not take my word for it: run one real transaction in TEST mode
 * and check the amount Paystack reports back before switching to live keys.
 * The test checklist is in worker/README.md.
 */
const SUBUNIT = 100;
const CURRENCY = 'KES';

/** The single source of truth for what anything costs. The client sends a
 *  product key and nothing else — never a price. */
const PRODUCTS = {
  'remote-list':   { name: 'The Remote-From-Kenya List',  kes: 500,  delivers: 'remote-list' },
  'ats-pass':      { name: 'ATS Pass',                    kes: 1000, delivers: 'whatsapp'    },
  'bundle':        { name: 'The Job Hunt Bundle',         kes: 1500, delivers: 'remote-list', includesEarlyAccess: true },
  'early-monthly': { name: 'Early Access — one month',    kes: 250,  delivers: 'early-group'    },
  'early-quarter': { name: 'Early Access — three months', kes: 600,  delivers: 'early-group'    },
  'early-annual':  { name: 'Early Access — one year',     kes: 2000, delivers: 'early-group'    },
  'cv-blueprint':  { name: 'The CV Blueprint',            kes: 250,  delivers: 'whatsapp'    },
  'communities':   { name: 'African Tech Community Database', kes: 250, delivers: 'communities-db' },
};

/* ------------------------------------------------------------------ utils */

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : SITE;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

/**
 * Normalise a WhatsApp number to +E.164, or return null.
 * Kenyan local forms (0712 345 678, 712345678, 254712345678) are expanded;
 * anything else must already be international (+256..., +234...) so people
 * elsewhere in Africa can still buy.
 */
function normalizeWhatsApp(raw) {
  if (typeof raw !== 'string') return null;
  let n = raw.replace(/[\s().-]/g, '');
  if (/^0[17]\d{8}$/.test(n)) n = '+254' + n.slice(1);          // 0712345678
  else if (/^[17]\d{8}$/.test(n)) n = '+254' + n;                // 712345678
  else if (/^254[17]\d{8}$/.test(n)) n = '+' + n;                // 254712345678
  else if (/^00\d{8,15}$/.test(n)) n = '+' + n.slice(2);          // 00256...
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

function validEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length < 200;
}

async function paystack(path, secret, init) {
  const r = await fetch(PAYSTACK + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + secret,
      'Content-Type': 'application/json',
      ...(init && init.headers),
    },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

/** hex HMAC-SHA512, which is what Paystack signs webhooks with */
async function hmac512Hex(key, message) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** constant-time-ish compare, so a mismatch does not leak where it diverged */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The invite link, but only if it really is a WhatsApp group invite. */
function earlyInvite(env) {
  const u = (env.EARLY_ACCESS_INVITE || '').toString().trim();
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}(\?[\w=&.%-]*)?$/.test(u) ? u : null;
}

/** The database link, but only if it is our members page with its key, or a Notion page. */
export function communitiesUrl(env) {
  const u = (env.COMMUNITIES_URL || '').toString().trim();
  if (/^https:\/\/thetechhut\.co\/communities\/db\/#[A-Za-z0-9_-]{43}$/.test(u)) return u;
  return /^https:\/\/[a-z0-9-]+\.notion\.site\/[A-Za-z0-9%._~-]+(\?[\w=&.%-]*)?$/.test(u) ? u : null;
}

const earlyGroupLink = (url, included) => ({
  kind: 'link',
  label: included ? 'Early Access group (three months included)' : 'Your Early Access group',
  url,
  cta: 'Request to join the group',
  note: 'Tap to request to join, from the WhatsApp number you gave us. We approve you against your payment, usually the same day.',
});

export function deliveryFor(product, env) {
  const p = PRODUCTS[product];
  if (!p) return null;
  const invite = earlyInvite(env);
  if (p.delivers === 'early-group' && invite) return earlyGroupLink(invite, false);
  const db = p.delivers === 'communities-db' ? communitiesUrl(env) : null;
  if (db) {
    return {
      kind: 'link',
      label: 'Your African Tech Community Database',
      url: db,
      cta: 'Open the database',
      note: 'Bookmark it. We check and update the links every two weeks, and this link always opens the latest version.',
    };
  }
  const listKey = (env.REMOTE_LIST_KEY || '').toString().trim();
  if (p.delivers === 'remote-list' && /^[A-Za-z0-9_-]{43}$/.test(listKey)) {
    const d = {
      kind: 'link',
      label: 'Your Remote-From-Kenya List',
      url: SITE + '/remote/list/#' + listKey,
      note: 'Bookmark this. It is rebuilt every morning, so it stays current.',
    };
    if (p.includesEarlyAccess && invite) d.also = [earlyGroupLink(invite, true)];
    return d;
  }
  return {
    kind: 'whatsapp',
    label: 'We will be in touch on WhatsApp',
    url: 'https://wa.me/254115017058?text=' +
      encodeURIComponent('I just paid for ' + p.name + '. Reference: '),
    note: 'Message us with your reference and we will set you up right away.',
  };
}

/** Can this Worker email a receipt at all? Resend first, Brevo otherwise. */
export const receiptsOn = (env) => !!(env.RESEND_API_KEY || (env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL));

const escHtml = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The receipt, as plain text and as HTML, for one paid product. */
export function receiptEmail(product, delivery, reference) {
  const p = PRODUCTS[product];
  const blocks = [delivery, ...(delivery.also || [])];
  const text = [
    'Thanks for buying ' + p.name + '.',
    '',
    ...blocks.flatMap((d) => d.kind === 'link' ? [d.label + ': ' + d.url, d.note || '', ''] : [d.note || '', '']),
    'Payment reference: ' + reference,
    'Questions: info@thetechhut.co or +254 115 017 058',
    '',
    'The Tech Hut',
  ].join('\n');
  const html = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
    + '<p style="font-weight:700;font-size:20px;margin:0 0 20px">The Tech Hut<span style="color:#06D6A0">.</span></p>'
    + '<p>Thanks for buying <b>' + escHtml(p.name) + '</b>.</p>'
    + blocks.map((d) => d.kind === 'link'
      ? '<p style="margin:22px 0 8px"><b>' + escHtml(d.label) + '</b></p>'
        + '<p style="margin:0 0 10px"><a href="' + escHtml(d.url) + '" style="display:inline-block;background:#06D6A0;color:#073B4C;font-weight:700;padding:12px 20px;border-radius:3px;text-decoration:none">'
        + escHtml(d.cta || 'Open') + '</a></p>'
        + '<p style="margin:0 0 6px;font-size:14px;word-break:break-all">' + escHtml(d.url) + '</p>'
        + (d.note ? '<p style="margin:0;font-size:14px;color:#4A5568">' + escHtml(d.note) + '</p>' : '')
      : '<p>' + escHtml(d.note || '') + '</p>').join('')
    + '<p style="margin-top:28px;font-size:13px;color:#5B6B7B">Payment reference: ' + escHtml(reference)
    + '<br>Questions: info@thetechhut.co or +254 115 017 058</p></div>';
  return { subject: p.name + ' — your access', text, html };
}

export async function sendReceipt(env, to, product, delivery, reference) {
  if (!to || !receiptsOn(env)) return false;     // optional: the page still shows the link
  const mail = receiptEmail(product, delivery, reference);
  try {
    let r;
    if (env.RESEND_API_KEY) {
      r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'The Tech Hut <info@thetechhut.co>', to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
    } else {
      r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: (env.BREVO_SENDER_NAME || 'The Tech Hut').trim(), email: env.BREVO_SENDER_EMAIL.trim() },
          to: [{ email: to }],
          subject: mail.subject, textContent: mail.text, htmlContent: mail.html,
          tags: ['receipt', product],
        }),
      });
    }
    return r.ok;
  } catch (e) {
    return false;                              // never fail a paid order over email
  }
}

/* ----------------------------------------------------------------- routes */

const BUSY = 'Too many attempts from here. Wait a few minutes and try again, or message us on WhatsApp.';

async function initialize(req, env, origin) {
  // Layer 1: only our own pages start a checkout, and people leave the hidden field empty.
  if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403, origin);
  const b = await req.json().catch(() => ({}));
  if (typeof b.website === 'string' && b.website.trim() !== '') return json({ error: 'could not start the payment' }, 400, origin);
  const p = PRODUCTS[b.product];
  if (!p) return json({ error: 'unknown product' }, 400, origin);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!validEmail(email)) return json({ error: 'a valid email is required' }, 400, origin);
  const whatsapp = normalizeWhatsApp(b.whatsapp);
  if (!whatsapp) return json({ error: 'a valid WhatsApp number is required' }, 400, origin);
  const name = (b.name || '').toString().replace(/\s+/g, ' ').trim().slice(0, 80);
  if (/https?:|www\.|[<>{}\\]/i.test(name)) return json({ error: 'please enter just your name' }, 400, origin);
  const ip = req.headers.get('CF-Connecting-IP') || '';

  // Layer 2: Cloudflare Turnstile (on once TURNSTILE_SECRET is set).
  if (!(await turnstileOk(env, b.turnstile, ip))) {
    return json({ error: 'verification failed', reason: 'turnstile' }, 403, origin);
  }

  // Layer 3: limits per IP, email, number and overall.
  const [eh, wh] = await Promise.all([sha256Hex(email), sha256Hex(whatsapp)]);
  const g = await guard(env, { op: 'hit', keys: [
    { k: 'ipb:' + ip, ...LIMITS.ipBurst },
    { k: 'ipd:' + ip, ...LIMITS.ipDay },
    { k: 'em:' + eh, ...LIMITS.emailDay },
    { k: 'wa:' + wh, ...LIMITS.phoneDay },
    { k: 'all', ...LIMITS.allHour },
  ].map(({ k, limit, window }) => ({ k, limit, window })) });
  if (g && g.ok === false) {
    return new Response(JSON.stringify({ error: BUSY, reason: 'rate' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(g.retryAfter || 600), ...cors(origin) },
    });
  }

  // Layer 4: the email's domain has to be real and take mail.
  if (!(await emailDomainOk(email))) {
    return json({ error: 'that email address cannot receive mail. Check the part after the @.', reason: 'email' }, 400, origin);
  }

  const res = await paystack('/transaction/initialize', env.PAYSTACK_SECRET_KEY, {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount: p.kes * SUBUNIT,               // server-side price, always
      currency: CURRENCY,
      channels: ['card', 'mobile_money', 'bank_transfer'],
      metadata: {
        product: b.product,
        product_name: p.name,
        customer_name: name,
        whatsapp,
        // custom_fields are what the Paystack dashboard shows on each transaction
        custom_fields: [
          { display_name: 'WhatsApp', variable_name: 'whatsapp', value: whatsapp },
          { display_name: 'Name', variable_name: 'customer_name', value: name },
        ],
        cancel_action: SITE,
      },
    }),
  });

  if (!res.ok || !res.body.status) {
    return json({ error: 'could not start the payment', detail: res.body.message || null }, 502, origin);
  }
  await guard(env, { op: 'order', ref: res.body.data.reference, product: b.product });
  return json({
    access_code: res.body.data.access_code,
    reference: res.body.data.reference,
    amount: p.kes,
    currency: CURRENCY,
    product_name: p.name,
  }, 200, origin);
}

async function verify(req, env, origin) {
  const b = await req.json().catch(() => ({}));
  const ref = (b.reference || '').toString();
  if (!/^[A-Za-z0-9._=-]{6,100}$/.test(ref)) return json({ error: 'bad reference' }, 400, origin);
  const ip = req.headers.get('CF-Connecting-IP') || '';
  const g = await guard(env, { op: 'hit', keys: [{ k: 'vip:' + ip, limit: LIMITS.verifyIp.limit, window: LIMITS.verifyIp.window }] });
  if (g && g.ok === false) return json({ paid: false, reason: 'rate', error: BUSY }, 429, origin);

  const res = await paystack('/transaction/verify/' + encodeURIComponent(ref), env.PAYSTACK_SECRET_KEY);
  if (!res.ok || !res.body.status) return json({ paid: false, reason: 'not found' }, 404, origin);

  const d = res.body.data;
  const product = (d.metadata && d.metadata.product) || null;
  const p = PRODUCTS[product];

  // Three things must all hold. Checking only `status` is the usual mistake:
  // it lets a KES 1 payment unlock a KES 1,500 product.
  if (d.status !== 'success') return json({ paid: false, reason: d.status }, 200, origin);
  if (!p) return json({ paid: false, reason: 'unknown product' }, 200, origin);
  if (d.currency !== CURRENCY) return json({ paid: false, reason: 'wrong currency' }, 200, origin);
  if (Number(d.amount) < p.kes * SUBUNIT) return json({ paid: false, reason: 'underpaid' }, 200, origin);

  const delivery = deliveryFor(product, env);
  // One receipt per payment: the page, a reload and the webhook all land here.
  const once = await guard(env, { op: 'paid', ref, product, via: 'verify' });
  const emailed = !once || once.first
    ? await sendReceipt(env, d.customer && d.customer.email, product, delivery, ref)
    : receiptsOn(env);

  return json({
    paid: true,
    product,
    product_name: p.name,
    amount: Number(d.amount) / SUBUNIT,
    currency: d.currency,
    reference: ref,
    emailed,
    delivery,
  }, 200, origin);
}

/**
 * The webhook is not a nicety. M-Pesa confirmation happens on the customer's
 * phone, and plenty of people close the tab before it lands — so the browser
 * callback never fires and, without this, a real payment leaves no trace on
 * our side.
 */
async function webhook(req, env) {
  const raw = await req.text();
  const sent = req.headers.get('x-paystack-signature') || '';
  const expected = await hmac512Hex(env.PAYSTACK_SECRET_KEY, raw);
  if (!safeEqual(sent, expected)) return new Response('bad signature', { status: 401 });

  let event = {};
  try { event = JSON.parse(raw); } catch (e) { return new Response('bad json', { status: 400 }); }

  if (event.event === 'charge.success' && event.data && event.data.metadata && event.data.metadata.kind === 'market') {
    await settleMarket(env, event.data);   // a prompt-marketplace sale: unlock it for the buyer
  } else if (event.event === 'charge.success') {
    const d = event.data || {};
    const product = (d.metadata && d.metadata.product) || null;
    const p = PRODUCTS[product];
    if (p && d.currency === CURRENCY && Number(d.amount) >= p.kes * SUBUNIT) {
      const once = await guard(env, { op: 'paid', ref: String(d.reference || ''), product, via: 'webhook' });
      if (!once || once.first) {
        const delivery = deliveryFor(product, env);
        await sendReceipt(env, d.customer && d.customer.email, product, delivery, d.reference);
      }
    }
  }
  // Always 200 a signed event, or Paystack retries it for hours.
  return new Response('ok', { status: 200 });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (url.pathname === '/health') return json({ ok: true, products: Object.keys(PRODUCTS), checkoutGuard: !!env.PAY_GUARD, turnstile: !!env.TURNSTILE_SECRET, newsletter: newsletterConfigured(env), newsletterDaily: newsletterConfigured(env, 'daily'), newsletterJobs: newsletterConfigured(env, 'jobs'), market: !!(env.MARKET && env.MARKET_SECRET) }, 200, origin);

    // The CV Pack signup does not touch Paystack, so it must not depend on the
    // Paystack key being set.
    if (req.method === 'POST' && (url.pathname === '/subscribe' || url.pathname === '/confirm')) {
      try {
        return await handleNewsletter(req, env, url, origin, { json, validEmail, safeEqual });
      } catch (e) {
        return json({ error: 'server error' }, 500, origin);
      }
    }
    // The games page counter (live players, total visits). No Paystack involved.
    if ((req.method === 'POST' && ['/games/ping', '/games/leave', '/games/login', '/games/forget'].includes(url.pathname)) ||
        (req.method === 'GET' && url.pathname === '/games/board')) {
      try {
        return await handleGames(req, env, url, origin, { json, allowedOrigins: ALLOWED_ORIGINS });
      } catch (e) {
        return json({ error: 'server error' }, 500, origin);
      }
    }
    // The prompt marketplace (accounts, prompts, split payments). See market.js.
    if (url.pathname.startsWith('/market/')) {
      try {
        return await handleMarket(req, env, url, origin, { json, cors, allowedOrigins: ALLOWED_ORIGINS });
      } catch (e) {
        return json({ error: 'server error' }, 500, origin);
      }
    }
    if (!env.PAYSTACK_SECRET_KEY) return json({ error: 'server not configured' }, 500, origin);

    try {
      if (req.method === 'POST' && url.pathname === '/initialize') return await initialize(req, env, origin);
      if (req.method === 'POST' && url.pathname === '/verify') return await verify(req, env, origin);
      if (req.method === 'POST' && url.pathname === '/webhook') return await webhook(req, env);
    } catch (e) {
      return json({ error: 'server error' }, 500, origin);
    }
    return json({ error: 'not found' }, 404, origin);
  },
};
