/**
 * CV Pack signup: double opt-in through Brevo. fetch() is stubbed, so no
 * network and no Brevo account are needed:  npm test
 */
import worker from '../src/index.js';
import { signToken, verifyToken } from '../src/newsletter.js';
import assert from 'node:assert';

const env = {
  BREVO_API_KEY: 'xkeysib-fake',
  BREVO_LIST_ID: '7',
  BREVO_SENDER_EMAIL: 'hello@thetechhut.co',
  SUBSCRIBE_SECRET: 'a-long-random-test-secret',
  // PAYSTACK_SECRET_KEY deliberately unset: signup must not need it
};

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}
const realFetch = globalThis.fetch;
const restore = () => { globalThis.fetch = realFetch; };

const post = (path, body) => new Request('https://api.test' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://thetechhut.co' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** records every Brevo call; `handler(path, body)` can override the answer */
function stubBrevo(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace('https://api.brevo.com/v3', '');
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body, headers: init && init.headers });
    const r = handler ? handler(path, body, calls.length) : null;
    if (r) return r;
    return new Response(path === '/contacts' ? JSON.stringify({ id: 1 }) : JSON.stringify({ messageId: '<x>' }), { status: path === '/contacts' ? 201 : 201 });
  };
  return calls;
}

const tokenFrom = (calls) => {
  const html = calls.find((c) => c.path === '/smtp/email').body.htmlContent;
  const m = html.match(/#t=([^"]+)"/);
  return m && m[1];
};

console.log('\nsubscribe');
await t('sends one confirmation email and adds nobody to the list yet', async () => {
  const calls = stubBrevo();
  const r = await worker.fetch(post('/subscribe', { email: 'Jane@Example.com', name: 'Jane', role: 'backend' }), env);
  restore();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].path, '/smtp/email');
  assert.strictEqual(calls[0].body.to[0].email, 'jane@example.com');
  assert.strictEqual(calls[0].headers['api-key'], 'xkeysib-fake');
  assert.ok(calls[0].body.htmlContent.includes('https://thetechhut.co/cv-pack/welcome/#t='));
  assert.ok(!calls.some((c) => c.path === '/contacts'), 'no list add before confirmation');
});

await t('the confirmation link is in the #fragment, never a server-visible query string', async () => {
  const calls = stubBrevo();
  await worker.fetch(post('/subscribe', { email: 'a@b.co' }), env);
  restore();
  const html = calls[0].body.htmlContent;
  assert.ok(html.includes('/cv-pack/welcome/#t='));
  assert.ok(!html.includes('?t='));
});

await t('rejects a bad email without calling Brevo', async () => {
  const calls = stubBrevo();
  const r = await worker.fetch(post('/subscribe', { email: 'not-an-email' }), env);
  restore();
  assert.strictEqual(r.status, 400);
  assert.strictEqual(calls.length, 0);
});

await t('honeypot: a filled hidden field looks like success but sends nothing', async () => {
  const calls = stubBrevo();
  const r = await worker.fetch(post('/subscribe', { email: 'bot@example.com', website: 'http://spam' }), env);
  restore();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls.length, 0);
});

await t('answers 503, not a crash, when Brevo is not configured yet', async () => {
  const calls = stubBrevo();
  const r = await worker.fetch(post('/subscribe', { email: 'a@b.co' }), { ...env, BREVO_API_KEY: '' });
  restore();
  assert.strictEqual(r.status, 503);
  assert.strictEqual(calls.length, 0);
});

await t('does not need the Paystack secret to be set', async () => {
  const calls = stubBrevo();
  const r = await worker.fetch(post('/subscribe', { email: 'a@b.co' }), env);
  restore();
  assert.notStrictEqual(r.status, 500);
});

await t('a Brevo failure is reported, so the page can say it did not go through', async () => {
  stubBrevo(() => new Response('{"message":"nope"}', { status: 401 }));
  const r = await worker.fetch(post('/subscribe', { email: 'a@b.co' }), env);
  restore();
  assert.strictEqual(r.status, 502);
});

await t('markup in the name cannot reach the email HTML', async () => {
  const calls = stubBrevo();
  await worker.fetch(post('/subscribe', { email: 'a@b.co', name: '<script>alert(1)</script>Jo' }), env);
  restore();
  assert.ok(!calls[0].body.htmlContent.includes('<script>'));
});

console.log('\nconfirm');
await t('a valid token adds the contact to the list, re-enables an unsubscribed one, and sends the welcome', async () => {
  let calls = stubBrevo();
  await worker.fetch(post('/subscribe', { email: 'jane@example.com', name: 'Jane', role: 'backend' }), env);
  const token = tokenFrom(calls);
  restore();

  calls = stubBrevo();
  const r = await worker.fetch(post('/confirm', { t: token }), env);
  restore();
  assert.strictEqual(r.status, 200);
  const add = calls.find((c) => c.path === '/contacts');
  assert.deepStrictEqual(add.body.listIds, [7]);
  assert.strictEqual(add.body.email, 'jane@example.com');
  assert.strictEqual(add.body.updateEnabled, true);
  assert.strictEqual(add.body.emailBlacklisted, false);
  assert.strictEqual(add.body.attributes.FIRSTNAME, 'Jane');
  assert.strictEqual(add.body.attributes.ROLE, 'backend');
  const welcome = calls.find((c) => c.path === '/smtp/email');
  assert.ok(welcome.body.htmlContent.includes('Six rules'));
  assert.ok(welcome.body.textContent.includes('One column. Always.'));
});

await t('a tampered token is refused', async () => {
  const token = await signToken({ e: 'a@b.co', n: '', r: '', s: 'cv-pack', x: Date.now() + 1e6 }, env.SUBSCRIBE_SECRET);
  const bad = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
  const calls = stubBrevo();
  const r = await worker.fetch(post('/confirm', { t: bad }), env);
  restore();
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await r.json()).error, 'invalid');
  assert.strictEqual(calls.length, 0);
});

await t('a token signed with a different secret is refused', async () => {
  const token = await signToken({ e: 'a@b.co', n: '', r: '', s: 'cv-pack', x: Date.now() + 1e6 }, 'someone-elses-secret');
  const calls = stubBrevo();
  const r = await worker.fetch(post('/confirm', { t: token }), env);
  restore();
  assert.strictEqual(r.status, 400);
  assert.strictEqual(calls.length, 0);
});

await t('an expired token is refused with a distinct reason', async () => {
  const token = await signToken({ e: 'a@b.co', n: '', r: '', s: 'cv-pack', x: Date.now() - 1000 }, env.SUBSCRIBE_SECRET);
  const calls = stubBrevo();
  const r = await worker.fetch(post('/confirm', { t: token }), env);
  restore();
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await r.json()).error, 'expired');
  assert.strictEqual(calls.length, 0);
});

await t('garbage and missing tokens are refused', async () => {
  const calls = stubBrevo();
  for (const t of ['', 'abc', '....', undefined, null, 12345]) {
    const r = await worker.fetch(post('/confirm', { t }), env);
    assert.strictEqual(r.status, 400, 'token ' + String(t));
  }
  restore();
  assert.strictEqual(calls.length, 0);
});

await t('if the custom attributes do not exist in Brevo, the contact is still added', async () => {
  let calls = stubBrevo();
  await worker.fetch(post('/subscribe', { email: 'jane@example.com', name: 'Jane', role: 'backend' }), env);
  const token = tokenFrom(calls);
  restore();

  let contactCalls = 0;
  calls = stubBrevo((path) => {
    if (path === '/contacts') {
      contactCalls++;
      if (contactCalls === 1) return new Response('{"code":"invalid_parameter","message":"Invalid attribute ROLE"}', { status: 400 });
    }
    return null;
  });
  const r = await worker.fetch(post('/confirm', { t: token }), env);
  restore();
  assert.strictEqual(r.status, 200);
  const adds = calls.filter((c) => c.path === '/contacts');
  assert.strictEqual(adds.length, 2);
  assert.deepStrictEqual(Object.keys(adds[1].body.attributes), ['FIRSTNAME']);
});

await t('if saving to Brevo fails the page is told, and no welcome is sent', async () => {
  let calls = stubBrevo();
  await worker.fetch(post('/subscribe', { email: 'jane@example.com' }), env);
  const token = tokenFrom(calls);
  restore();
  calls = stubBrevo((path) => (path === '/contacts' ? new Response('{}', { status: 500 }) : null));
  const r = await worker.fetch(post('/confirm', { t: token }), env);
  restore();
  assert.strictEqual(r.status, 502);
  assert.ok(!calls.some((c) => c.path === '/smtp/email'));
});

await t('a failed welcome email does not undo a successful signup', async () => {
  let calls = stubBrevo();
  await worker.fetch(post('/subscribe', { email: 'jane@example.com' }), env);
  const token = tokenFrom(calls);
  restore();
  stubBrevo((path) => (path === '/smtp/email' ? new Response('{}', { status: 500 }) : null));
  const r = await worker.fetch(post('/confirm', { t: token }), env);
  restore();
  assert.strictEqual(r.status, 200);
});

console.log('\ntokens');
await t('verifyToken round-trips', async () => {
  const token = await signToken({ e: 'a@b.co', x: 2000 }, 's');
  const ok = await verifyToken(token, 's', 1000, (a, b) => a === b);
  assert.ok(ok.ok);
  assert.strictEqual(ok.payload.e, 'a@b.co');
});

await t('/health reports whether the signup is configured, without leaking values', async () => {
  const r1 = await worker.fetch(new Request('https://api.test/health'), env);
  const b1 = await r1.json();
  const r2 = await worker.fetch(new Request('https://api.test/health'), {});
  const b2 = await r2.json();
  assert.strictEqual(b1.newsletter, true);
  assert.strictEqual(b2.newsletter, false);
  assert.ok(!JSON.stringify(b1).includes('xkeysib'));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
