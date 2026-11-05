/**
 * Tests for checkout protection (src/payguard.js): origin and honeypot,
 * Turnstile, limits, the email-domain check, and one receipt per payment.
 * The Durable Object runs in memory; every outside call is stubbed:  npm test
 */
import worker, { PayGuard } from '../src/index.js';
import { LIMITS } from '../src/payguard.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); fail++; }
}

function fakeGuard() {
  const store = new Map();
  const storage = {
    store,
    get: async (k) => store.get(k),
    put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    delete: async (k) => { for (const x of [].concat(k)) store.delete(x); },
    list: async ({ prefix, end, limit }) => {
      let rows = [...store].filter(([k]) => k.startsWith(prefix) && (!end || k < end)).sort(([a], [b]) => (a < b ? -1 : 1));
      if (limit) rows = rows.slice(0, limit);
      return new Map(rows);
    },
    getAlarm: async () => null,
    setAlarm: async () => {},
  };
  const obj = new PayGuard({ storage });
  return { obj, store, idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
}

const realFetch = globalThis.fetch;
let calls = [];
// Paystack, Turnstile, DNS and Resend, all answered here.
function stub({ turnstile = true, mx = 'ok', paystackVerify } = {}) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('challenges.cloudflare.com')) {
      return Response.json({ success: turnstile, action: 'checkout', hostname: 'thetechhut.co' });
    }
    if (u.includes('cloudflare-dns.com')) {
      if (mx === 'nxdomain') return Response.json({ Status: 3 });
      if (mx === 'none') return Response.json({ Status: 0, Answer: [] });
      return Response.json({ Status: 0, Answer: [{ type: 15, data: '10 mx.example.com.' }] });
    }
    if (u.includes('/transaction/initialize')) {
      return Response.json({ status: true, data: { access_code: 'ac_' + calls.length, reference: 'ref_' + calls.length } });
    }
    if (u.includes('/transaction/verify/')) return Response.json(paystackVerify);
    if (u.includes('api.resend.com')) return Response.json({ id: 'x' });
    return new Response('not stubbed', { status: 500 });
  };
}
const restore = () => { globalThis.fetch = realFetch; };

const post = (path, body, { origin = 'https://thetechhut.co', ip = '1.2.3.4', headers = {} } = {}) =>
  new Request('https://api.test' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const call = async (env, path, body, opts) => {
  const r = await worker.fetch(post(path, body, opts), env);
  return { status: r.status, body: await r.json() };
};
const buyer = (n = 1, over = {}) => ({
  product: 'remote-list', email: 'buyer' + n + '@example.com', whatsapp: '07' + String(10000000 + n).slice(-8), name: 'Wanjiru', turnstile: 'tok_' + 'x'.repeat(20), ...over,
});
const baseEnv = () => ({ PAYSTACK_SECRET_KEY: 'sk_test_fake', REMOTE_LIST_KEY: 'Kfake_key_for_tests_only_0123456789abcdefgh', PAY_GUARD: fakeGuard() });
const paystackCalls = () => calls.filter((u) => u.includes('api.paystack.co')).length;

console.log('\nonly our pages, and only people');
await t('a checkout from another origin is refused before Paystack is called', async () => {
  stub(); const env = baseEnv();
  const r = await call(env, '/initialize', buyer(), { origin: 'https://evil.example' });
  restore();
  assert.equal(r.status, 403); assert.equal(paystackCalls(), 0);
});
await t('a filled honeypot is refused', async () => {
  stub(); const env = baseEnv();
  const r = await call(env, '/initialize', buyer(1, { website: 'http://spam' }));
  restore();
  assert.equal(r.status, 400); assert.equal(paystackCalls(), 0);
});
await t('a link or markup in the name is refused', async () => {
  stub(); const env = baseEnv();
  const r = await call(env, '/initialize', buyer(1, { name: 'win money http://x.y' }));
  restore();
  assert.equal(r.status, 400); assert.equal(paystackCalls(), 0);
});

console.log('\nTurnstile');
await t('without TURNSTILE_SECRET the check is off', async () => {
  stub({ turnstile: false }); const env = baseEnv();
  const r = await call(env, '/initialize', buyer(1, { turnstile: undefined }));
  restore();
  assert.equal(r.status, 200); assert.ok(!calls.some((u) => u.includes('challenges.cloudflare.com')));
});
await t('with TURNSTILE_SECRET a missing token is refused', async () => {
  stub(); const env = { ...baseEnv(), TURNSTILE_SECRET: 'ts' };
  const r = await call(env, '/initialize', buyer(1, { turnstile: '' }));
  restore();
  assert.equal(r.status, 403); assert.equal(r.body.reason, 'turnstile'); assert.equal(paystackCalls(), 0);
});
await t('with TURNSTILE_SECRET a failed token is refused', async () => {
  stub({ turnstile: false }); const env = { ...baseEnv(), TURNSTILE_SECRET: 'ts' };
  const r = await call(env, '/initialize', buyer());
  restore();
  assert.equal(r.status, 403); assert.equal(paystackCalls(), 0);
});
await t('with TURNSTILE_SECRET a good token goes through', async () => {
  stub(); const env = { ...baseEnv(), TURNSTILE_SECRET: 'ts' };
  const r = await call(env, '/initialize', buyer());
  restore();
  assert.equal(r.status, 200); assert.ok(r.body.access_code);
});

console.log('\nlimits');
await t(`one IP gets ${LIMITS.ipBurst.limit} checkouts in ten minutes, then 429`, async () => {
  stub(); const env = baseEnv();
  for (let i = 1; i <= LIMITS.ipBurst.limit; i++) assert.equal((await call(env, '/initialize', buyer(i))).status, 200);
  const r = await call(env, '/initialize', buyer(99));
  restore();
  assert.equal(r.status, 429); assert.equal(r.body.reason, 'rate');
  assert.equal(paystackCalls(), LIMITS.ipBurst.limit);
});
await t(`one email gets ${LIMITS.emailDay.limit} checkouts a day, from any IP`, async () => {
  stub(); const env = baseEnv();
  for (let i = 1; i <= LIMITS.emailDay.limit; i++) {
    assert.equal((await call(env, '/initialize', buyer(1, { whatsapp: '07' + String(20000000 + i).slice(-8) }), { ip: '10.0.0.' + i })).status, 200);
  }
  const r = await call(env, '/initialize', buyer(1, { whatsapp: '0799999999', email: 'BUYER1@example.com ' }), { ip: '10.0.1.1' });
  restore();
  assert.equal(r.status, 429);
});
await t('a refused attempt does not use up the allowance', async () => {
  stub(); const env = baseEnv();
  for (let i = 1; i <= LIMITS.ipBurst.limit; i++) await call(env, '/initialize', buyer(i));
  await call(env, '/initialize', buyer(50));
  await call(env, '/initialize', buyer(51));
  const counted = [...env.PAY_GUARD.store].filter(([k]) => k.startsWith('c:ipb:')).map(([, v]) => v);
  restore();
  assert.deepEqual(counted, [LIMITS.ipBurst.limit]);
});
await t('the guard stores hashes, not emails or numbers', async () => {
  stub(); const env = baseEnv();
  await call(env, '/initialize', buyer(7));
  restore();
  const dump = JSON.stringify([...env.PAY_GUARD.store]);
  assert.ok(!dump.includes('buyer7@example.com')); assert.ok(!dump.includes('254710000007')); assert.ok(!dump.includes('Wanjiru'));
});
await t('with no guard bound, checkout still works (limits never block a sale)', async () => {
  stub(); const env = { ...baseEnv(), PAY_GUARD: undefined };
  const r = await call(env, '/initialize', buyer());
  restore();
  assert.equal(r.status, 200);
});

console.log('\nthe email has to be able to receive mail');
await t('a domain that does not exist is refused', async () => {
  stub({ mx: 'nxdomain' }); const env = baseEnv();
  const r = await call(env, '/initialize', buyer(1, { email: 'x@no-such-domain-' + Date.now() + '.com' }));
  restore();
  assert.equal(r.status, 400); assert.equal(r.body.reason, 'email'); assert.equal(paystackCalls(), 0);
});
await t('a real domain goes through', async () => {
  stub(); const env = baseEnv();
  const r = await call(env, '/initialize', buyer(1, { email: 'x@real-domain-' + Date.now() + '.com' }));
  restore();
  assert.equal(r.status, 200);
});

console.log('\none receipt per payment');
const paidPayload = { status: true, data: { status: 'success', currency: 'KES', amount: 50000, reference: 'ref_paid_1', customer: { email: 'b@example.com' }, metadata: { product: 'remote-list' } } };
await t('verify twice and the webhook once send one receipt', async () => {
  stub({ paystackVerify: paidPayload }); const env = { ...baseEnv(), RESEND_API_KEY: 're_fake' };
  const a = await call(env, '/verify', { reference: 'ref_paid_1' });
  const b = await call(env, '/verify', { reference: 'ref_paid_1' });
  const raw = JSON.stringify({ event: 'charge.success', data: paidPayload.data });
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('sk_test_fake'), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const w = await worker.fetch(post('/webhook', raw, { headers: { 'x-paystack-signature': sig } }), env);
  restore();
  assert.equal(a.body.paid, true); assert.equal(b.body.paid, true);
  assert.equal(b.body.delivery.url, a.body.delivery.url);      // still delivered on a reload
  assert.equal(w.status, 200);
  assert.equal(calls.filter((u) => u.includes('api.resend.com')).length, 1);
});
await t('verify is rate limited per IP', async () => {
  stub({ paystackVerify: paidPayload }); const env = baseEnv();
  for (let i = 0; i < LIMITS.verifyIp.limit; i++) await call(env, '/verify', { reference: 'ref_paid_' + i });
  const r = await call(env, '/verify', { reference: 'ref_paid_x' });
  restore();
  assert.equal(r.status, 429);
});

console.log('\nclean-up');
await t('the hourly alarm drops expired counters and keeps live ones', async () => {
  stub(); const env = baseEnv();
  await call(env, '/initialize', buyer());
  const before = env.PAY_GUARD.store.size;
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 24 * 3600 * 1000;      // two days on: every window has ended
  await env.PAY_GUARD.obj.alarm();
  Date.now = realNow;
  restore();
  const left = [...env.PAY_GUARD.store.keys()];
  assert.ok(before > 2);
  assert.ok(left.every((k) => k.startsWith('o:')), 'only the order record is left: ' + left.join(', '));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
