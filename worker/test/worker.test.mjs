/**
 * Tests for the parts that lose money if they are wrong.
 *
 * Runs against the real Worker module with fetch() stubbed, so no network and
 * no Paystack account needed:  npm test
 */
import worker from '../src/index.js';
import assert from 'node:assert';

const SECRET = 'sk_test_fake_for_tests';
const env = {
  PAYSTACK_SECRET_KEY: SECRET,
  REMOTE_LIST_TOKEN: 'fake_token_for_tests_only',
  // RESEND_API_KEY deliberately unset: receipts must be optional
};

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

const realFetch = globalThis.fetch;
function stubPaystack(handler) { globalThis.fetch = handler; }
function restore() { globalThis.fetch = realFetch; }

const post = (path, body, headers = {}) => new Request('https://api.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://thetechhut.co', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

async function hmac512Hex(key, message) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const verifyPayload = (over = {}) => ({
  status: true,
  data: {
    status: 'success', currency: 'KES', amount: 50000, reference: 'ref_abc123',
    customer: { email: 'buyer@example.com' },
    metadata: { product: 'remote-list' },
    ...over,
  },
});

console.log('\nprice is set by the server, never the client');
await t('initialize sends the catalogue price, ignoring any amount the client sends', async () => {
  let sentBody = null;
  stubPaystack(async (url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ status: true, data: { access_code: 'ac_1', reference: 'ref_1' } }), { status: 200 });
  });
  const r = await worker.fetch(post('/initialize', {
    product: 'bundle', email: 'a@b.com', whatsapp: '0712 345 678', amount: 1, kes: 1, price: 1,
  }), env);
  restore();
  assert.equal(r.status, 200);
  assert.equal(sentBody.amount, 150000, 'bundle must be KES 1,500 in subunits');
  assert.equal(sentBody.currency, 'KES');
});

await t('initialize rejects an unknown product', async () => {
  const r = await worker.fetch(post('/initialize', { product: 'free-stuff', email: 'a@b.com' }), env);
  assert.equal(r.status, 400);
});

await t('initialize rejects a malformed email', async () => {
  const r = await worker.fetch(post('/initialize', { product: 'bundle', email: 'nope' }), env);
  assert.equal(r.status, 400);
});

console.log('\nthe WhatsApp number is required, normalised, and travels with the payment');
await t('initialize refuses a missing or junk WhatsApp number', async () => {
  for (const w of [undefined, '', 'abc', '12345', '+254 71', '0612345678', '<script>']) {
    const r = await worker.fetch(post('/initialize', { product: 'bundle', email: 'a@b.com', whatsapp: w }), env);
    assert.equal(r.status, 400, 'should reject ' + JSON.stringify(w));
  }
});

await t('Kenyan local formats are normalised to +254 and stored on the transaction', async () => {
  const cases = { '0712345678': '+254712345678', '0112 345 678': '+254112345678', '712345678': '+254712345678',
                  '254712345678': '+254712345678', '+254 712-345-678': '+254712345678', '+256 772 123456': '+256772123456' };
  for (const [input, want] of Object.entries(cases)) {
    let sent = null;
    stubPaystack(async (url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ status: true, data: { access_code: 'ac_1', reference: 'ref_1' } }), { status: 200 });
    });
    const r = await worker.fetch(post('/initialize', { product: 'early-monthly', email: 'a@b.com', whatsapp: input }), env);
    restore();
    assert.equal(r.status, 200, input);
    assert.equal(sent.metadata.whatsapp, want, input);
    const f = sent.metadata.custom_fields.find((x) => x.variable_name === 'whatsapp');
    assert.equal(f.value, want, 'dashboard custom field for ' + input);
  }
});

console.log('\nverify refuses anything that is not a real, full payment');
await t('a successful full-price payment is accepted and returns the link', async () => {
  stubPaystack(async () => new Response(JSON.stringify(verifyPayload()), { status: 200 }));
  const r = await worker.fetch(post('/verify', { reference: 'ref_abc123' }), env);
  const b = await r.json(); restore();
  assert.equal(b.paid, true);
  assert.equal(b.amount, 500);
  assert.equal(b.delivery.kind, 'link');
  assert.ok(b.delivery.url.endsWith('#fake_token_for_tests_only'), 'token must come from env, not the client');
  assert.equal(b.emailed, false, 'no RESEND_API_KEY set, so no email — but the sale still completes');
});

await t('underpayment is refused (the KES 1 attack)', async () => {
  stubPaystack(async () => new Response(JSON.stringify(verifyPayload({ amount: 100 })), { status: 200 }));
  const b = await (await worker.fetch(post('/verify', { reference: 'ref_abc123' }), env)).json();
  restore();
  assert.equal(b.paid, false);
  assert.equal(b.reason, 'underpaid');
});

await t('a failed transaction is refused', async () => {
  stubPaystack(async () => new Response(JSON.stringify(verifyPayload({ status: 'abandoned' })), { status: 200 }));
  const b = await (await worker.fetch(post('/verify', { reference: 'ref_abc123' }), env)).json();
  restore();
  assert.equal(b.paid, false);
});

await t('payment in another currency is refused', async () => {
  stubPaystack(async () => new Response(JSON.stringify(verifyPayload({ currency: 'NGN', amount: 50000 })), { status: 200 }));
  const b = await (await worker.fetch(post('/verify', { reference: 'ref_abc123' }), env)).json();
  restore();
  assert.equal(b.paid, false);
  assert.equal(b.reason, 'wrong currency');
});

await t('a reference with no product in its metadata is refused', async () => {
  stubPaystack(async () => new Response(JSON.stringify(verifyPayload({ metadata: {} })), { status: 200 }));
  const b = await (await worker.fetch(post('/verify', { reference: 'ref_abc123' }), env)).json();
  restore();
  assert.equal(b.paid, false);
});

await t('a junk reference never reaches Paystack', async () => {
  let called = false;
  stubPaystack(async () => { called = true; return new Response('{}', { status: 200 }); });
  const r = await worker.fetch(post('/verify', { reference: '../../etc/passwd' }), env);
  restore();
  assert.equal(r.status, 400);
  assert.equal(called, false);
});

console.log('\nwebhook trusts the signature and nothing else');
await t('a correctly signed charge.success is accepted', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: verifyPayload().data });
  const sig = await hmac512Hex(SECRET, body);
  const r = await worker.fetch(post('/webhook', body, { 'x-paystack-signature': sig }), env);
  assert.equal(r.status, 200);
});

await t('a forged signature is rejected', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: verifyPayload().data });
  const r = await worker.fetch(post('/webhook', body, { 'x-paystack-signature': 'f'.repeat(128) }), env);
  assert.equal(r.status, 401);
});

await t('an unsigned webhook is rejected', async () => {
  const body = JSON.stringify({ event: 'charge.success', data: {} });
  const r = await worker.fetch(post('/webhook', body), env);
  assert.equal(r.status, 401);
});

await t('a signature for different content is rejected', async () => {
  const sig = await hmac512Hex(SECRET, JSON.stringify({ event: 'charge.success', data: { amount: 1 } }));
  const body = JSON.stringify({ event: 'charge.success', data: verifyPayload().data });
  const r = await worker.fetch(post('/webhook', body, { 'x-paystack-signature': sig }), env);
  assert.equal(r.status, 401);
});

console.log('\ncors and configuration');
await t('an unknown origin is answered as the canonical site, not echoed back', async () => {
  const r = await worker.fetch(new Request('https://api.test/health', {
    headers: { Origin: 'https://evil.example' },
  }), env);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://thetechhut.co');
});

await t('a missing secret key fails closed', async () => {
  const r = await worker.fetch(post('/initialize', { product: 'bundle', email: 'a@b.com', whatsapp: '0712345678' }), {});
  assert.equal(r.status, 500);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
