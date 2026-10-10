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
 *   GET  /health
 *
 * Secrets (wrangler secret put <NAME> — never commit these)
 *   PAYSTACK_SECRET_KEY   sk_test_… while testing, sk_live_… when you go live
 *   REMOTE_LIST_TOKEN     the token from scripts/remote_token.txt
 *   RESEND_API_KEY        optional; without it the page still reveals the link
 */

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
  'bundle':        { name: 'The Job Hunt Bundle',         kes: 1500, delivers: 'remote-list' },
  'early-monthly': { name: 'Early Access — one month',    kes: 250,  delivers: 'whatsapp'    },
  'early-quarter': { name: 'Early Access — three months', kes: 600,  delivers: 'whatsapp'    },
  'early-annual':  { name: 'Early Access — one year',     kes: 2000, delivers: 'whatsapp'    },
  'cv-blueprint':  { name: 'The CV Blueprint',            kes: 250,  delivers: 'whatsapp'    },
  'communities':   { name: 'African Tech Community Database', kes: 250, delivers: 'whatsapp' },
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

function deliveryFor(product, env) {
  const p = PRODUCTS[product];
  if (!p) return null;
  if (p.delivers === 'remote-list' && env.REMOTE_LIST_TOKEN) {
    return {
      kind: 'link',
      label: 'Your Remote-From-Kenya List',
      url: SITE + '/remote/list/#' + env.REMOTE_LIST_TOKEN,
      note: 'Bookmark this. It is rebuilt every morning, so it stays current.',
    };
  }
  return {
    kind: 'whatsapp',
    label: 'We will be in touch on WhatsApp',
    url: 'https://wa.me/254115017058?text=' +
      encodeURIComponent('I just paid for ' + p.name + '. Reference: '),
    note: 'Message us with your reference and we will set you up right away.',
  };
}

async function sendReceipt(env, to, product, delivery, reference) {
  if (!env.RESEND_API_KEY) return false;      // optional: the page still shows the link
  const p = PRODUCTS[product];
  const body = {
    from: 'The Tech Hut <info@thetechhut.co>',
    to: [to],
    subject: p.name + ' — your access',
    text: [
      'Thanks for buying ' + p.name + '.',
      '',
      delivery.kind === 'link' ? delivery.label + ': ' + delivery.url : delivery.note,
      '',
      'Payment reference: ' + reference,
      'Questions: info@thetechhut.co or +254 115 017 058',
      '',
      'The Tech Hut',
    ].join('\n'),
  };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch (e) {
    return false;                              // never fail a paid order over email
  }
}

/* ----------------------------------------------------------------- routes */

async function initialize(req, env, origin) {
  const b = await req.json().catch(() => ({}));
  const p = PRODUCTS[b.product];
  if (!p) return json({ error: 'unknown product' }, 400, origin);
  if (!validEmail(b.email)) return json({ error: 'a valid email is required' }, 400, origin);
  const whatsapp = normalizeWhatsApp(b.whatsapp);
  if (!whatsapp) return json({ error: 'a valid WhatsApp number is required' }, 400, origin);

  const res = await paystack('/transaction/initialize', env.PAYSTACK_SECRET_KEY, {
    method: 'POST',
    body: JSON.stringify({
      email: b.email,
      amount: p.kes * SUBUNIT,               // server-side price, always
      currency: CURRENCY,
      channels: ['card', 'mobile_money', 'bank_transfer'],
      metadata: {
        product: b.product,
        product_name: p.name,
        customer_name: (b.name || '').toString().slice(0, 80),
        whatsapp,
        // custom_fields are what the Paystack dashboard shows on each transaction
        custom_fields: [
          { display_name: 'WhatsApp', variable_name: 'whatsapp', value: whatsapp },
          { display_name: 'Name', variable_name: 'customer_name', value: (b.name || '').toString().slice(0, 80) },
        ],
        cancel_action: SITE,
      },
    }),
  });

  if (!res.ok || !res.body.status) {
    return json({ error: 'could not start the payment', detail: res.body.message || null }, 502, origin);
  }
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
  const emailed = await sendReceipt(env, d.customer && d.customer.email, product, delivery, ref);

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

  if (event.event === 'charge.success') {
    const d = event.data || {};
    const product = (d.metadata && d.metadata.product) || null;
    const p = PRODUCTS[product];
    if (p && d.currency === CURRENCY && Number(d.amount) >= p.kes * SUBUNIT) {
      const delivery = deliveryFor(product, env);
      await sendReceipt(env, d.customer && d.customer.email, product, delivery, d.reference);
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
    if (url.pathname === '/health') return json({ ok: true, products: Object.keys(PRODUCTS) }, 200, origin);
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
