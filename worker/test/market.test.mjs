/**
 * Tests for the prompt marketplace (src/market.js): email sign-in links,
 * sessions, posting prompts, payouts, buying with a Paystack split, and the
 * rules that keep paid prompts paid.   npm test
 */
import worker, { Market } from '../src/index.js';
import { sign, unsign, cleanPrompt, COMMISSION_PERCENT, promptPath } from '../src/market.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); fail++; }
}
function fakeStorage(store = new Map()) {
  return {
    get: async (k) => structuredClone(store.get(k)),
    put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    delete: async (k) => { for (const x of [].concat(k)) store.delete(x); },
    list: async ({ prefix }) => new Map([...store].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
  };
}
function ns() {
  const obj = new Market({ storage: fakeStorage() });
  return { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
}
const SITE = 'https://thetechhut.co';
const realFetch = globalThis.fetch;
let mails = [], paystackCalls = [], paid = {}, brevoDown = false;
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u.startsWith('https://api.brevo.com')) { if (brevoDown) return new Response('{}', { status: 500 }); mails.push(JSON.parse(init.body)); return new Response('{"messageId":"x"}', { status: 201 }); }
  if (u.startsWith('https://cloudflare-dns.com')) return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: '10 mx.example.com.' }] }));
  if (u.startsWith('https://api.paystack.co')) {
    const path = u.slice('https://api.paystack.co'.length);
    const body = init.body ? JSON.parse(init.body) : null;
    paystackCalls.push({ path, method: init.method || 'GET', body });
    if (path.startsWith('/subaccount')) return Response.json({ status: true, data: { subaccount_code: 'ACCT_seller1', settlement_bank: 'Test Bank', account_name: 'JANE SELLER' } });
    if (path === '/transaction/initialize') { paid.last = body; return Response.json({ status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'ref_123456' } }); }
    if (path.startsWith('/transaction/verify/')) return Response.json({ status: true, data: paid.verify });
    if (path.startsWith('/bank')) return Response.json({ status: true, data: [{ code: '01', name: 'Test Bank', active: true }] });
  }
  throw new Error('unexpected fetch ' + u);
};

const env = () => ({ MARKET: ns(), MARKET_SECRET: 'test-secret-0123456789', PAYSTACK_SECRET_KEY: 'sk_test_x', BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'hi@thetechhut.co' });
const post = (path, body, ip = '1.1.1.1') => new Request('https://api.test' + path, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });
const call = async (e, path, body) => { const r = await worker.fetch(post(path, body), e); return { status: r.status, body: await r.json() }; };
async function signIn(e, email) {
  mails = [];
  const r = await call(e, '/market/login', { email });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const link = mails[0].htmlContent.match(/#login=([A-Za-z0-9._-]+)/)[1];
  const s = await call(e, '/market/session', { t: link });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return { ...s.body, link };
}
const PROMPT = { title: 'Cover letter that sounds like you', desc: 'Turns a job ad and your CV into a short, specific cover letter.', cat: 'career', model: 'any',
  preview: 'You are a hiring manager...', body: 'You are a hiring manager at {company}. Read the job ad and my CV below and write a 200-word cover letter.' };

console.log('sign-in');
await t('one email link both creates the account and signs in, and works only once', async () => {
  const e = env();
  const a = await signIn(e, 'Jane@Example.com');
  assert.equal(a.user.email, 'jane@example.com');
  assert.ok(a.session);
  assert.ok(mails[0].htmlContent.includes('https://thetechhut.co/prompt-marketplace/#login='));
  const again = await call(e, '/market/session', { t: a.link });
  assert.equal(again.status, 400, 'a used link is refused');
  const b = await signIn(e, 'jane@example.com');
  assert.equal(b.user.id, a.user.id, 'same email, same account');
});
await t('expired, forged and wrong-kind tokens are refused', async () => {
  const now = Date.now();
  assert.equal(await unsign(await sign({ k: 'l', e: 'a@b.co', n: 'x', x: now - 1 }, 's'), 's', 'l', now), null);
  assert.equal(await unsign(await sign({ k: 'l', e: 'a@b.co', n: 'x', x: now + 1e5 }, 'other'), 's', 'l', now), null);
  const sess = await sign({ k: 's', u: 'abc', x: now + 1e5 }, 's');
  assert.equal(await unsign(sess, 's', 'l', now), null, 'a session is not a sign-in link');
  const e = env();
  assert.equal((await call(e, '/market/me', { session: 'junk' })).status, 401);
});
await t('the honeypot and bad emails send nothing', async () => {
  const e = env(); mails = [];
  assert.equal((await call(e, '/market/login', { email: 'a@b.co', website: 'spam' })).status, 200);
  assert.equal((await call(e, '/market/login', { email: 'not-an-email' })).status, 400);
  assert.equal(mails.length, 0);
});

console.log('\nposting');
await t('free prompts post with no payout set, and anyone can open them', async () => {
  const e = env();
  const { session } = await signIn(e, 'free@example.com');
  const s = await call(e, '/market/save', { session, ...PROMPT, price: 0 });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const list = await (await worker.fetch(new Request('https://api.test/market/prompts', { headers: { Origin: SITE } }), e)).json();
  assert.equal(list.prompts.length, 1);
  assert.equal(list.prompts[0].body, undefined, 'the public list never carries prompt text');
  const open = await call(e, '/market/open', { id: s.body.prompt.id });
  assert.equal(open.status, 200);
  assert.ok(open.body.body.includes('hiring manager'));
});
await t('a paid prompt needs a payout account first, and validates its price', async () => {
  const e = env();
  const { session } = await signIn(e, 'seller@example.com');
  const r = await call(e, '/market/save', { session, ...PROMPT, price: 300 });
  assert.equal(r.body.error, 'payout');
  assert.equal((await call(e, '/market/save', { session, ...PROMPT, price: 10 })).status, 400, 'below the minimum');
  assert.ok(cleanPrompt({ ...PROMPT, title: 'x' }).error);
});
await t('payout setup creates a Paystack subaccount at the 10% commission', async () => {
  const e = env(); paystackCalls = [];
  const { session } = await signIn(e, 'seller@example.com');
  const r = await call(e, '/market/payout', { session, bank: '01', account: '0123 456 789' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const sub = paystackCalls.find((c) => c.path === '/subaccount');
  assert.equal(sub.body.percentage_charge, COMMISSION_PERCENT);
  assert.equal(sub.body.account_number, '0123456789');
  assert.equal(r.body.user.payout.last4, '6789');
  assert.equal(r.body.user.payout.code, undefined, 'the subaccount code stays server-side');
});
await t('only the owner can edit or delete a prompt', async () => {
  const e = env();
  const a = await signIn(e, 'a@example.com'), b = await signIn(e, 'b@example.com');
  const s = await call(e, '/market/save', { session: a.session, ...PROMPT, price: 0 });
  assert.equal((await call(e, '/market/save', { session: b.session, id: s.body.prompt.id, ...PROMPT, price: 0 })).status, 403);
  assert.equal((await call(e, '/market/delete', { session: b.session, id: s.body.prompt.id })).status, 403);
  assert.equal((await call(e, '/market/delete', { session: a.session, id: s.body.prompt.id })).status, 200);
});

console.log('\nbuying');
async function sellerWithPaidPrompt(e) {
  const seller = await signIn(e, 'seller@example.com');
  await call(e, '/market/payout', { session: seller.session, bank: '01', account: '0123456789' });
  const s = await call(e, '/market/save', { session: seller.session, ...PROMPT, price: 300 });
  return { seller, id: s.body.prompt.id };
}
await t('a paid prompt stays locked until bought', async () => {
  const e = env(); const { id } = await sellerWithPaidPrompt(e);
  const buyer = await signIn(e, 'buyer@example.com');
  const r = await call(e, '/market/open', { session: buyer.session, id });
  assert.equal(r.status, 402);
  assert.equal(r.body.body, undefined);
});
await t('buying charges the server price and splits it to the seller\'s subaccount', async () => {
  const e = env(); const { id } = await sellerWithPaidPrompt(e);
  const buyer = await signIn(e, 'buyer@example.com');
  const r = await call(e, '/market/buy', { session: buyer.session, id, price: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(paid.last.amount, 30000, 'KES 300 in cents, whatever the client sent');
  assert.equal(paid.last.subaccount, 'ACCT_seller1');
  assert.equal(paid.last.bearer, 'subaccount');
  assert.equal(paid.last.metadata.kind, 'market');
});
await t('verify unlocks for the buyer only, once, and refuses underpayment', async () => {
  const e = env(); const { id, seller } = await sellerWithPaidPrompt(e);
  const buyer = await signIn(e, 'buyer@example.com');
  paid.verify = { status: 'success', currency: 'KES', amount: 100, reference: 'ref_low', metadata: { kind: 'market', pid: id, uid: buyer.user.id } };
  assert.equal((await call(e, '/market/verify', { reference: 'ref_low', session: buyer.session })).body.paid, false);
  paid.verify = { status: 'success', currency: 'KES', amount: 30000, reference: 'ref_ok', metadata: { kind: 'market', pid: id, uid: buyer.user.id } };
  const stranger = await call(e, '/market/verify', { reference: 'ref_ok' });
  assert.equal(stranger.body.paid, true); assert.equal(stranger.body.body, undefined, 'no prompt text without the buyer\'s session');
  const v = await call(e, '/market/verify', { reference: 'ref_ok', session: buyer.session });
  assert.ok(v.body.body.includes('hiring manager'));
  await call(e, '/market/verify', { reference: 'ref_ok', session: buyer.session });
  const list = await (await worker.fetch(new Request('https://api.test/market/prompts'), e)).json();
  assert.equal(list.prompts[0].sales, 1, 'counted once however often verify runs');
  assert.equal((await call(e, '/market/open', { session: buyer.session, id })).status, 200);
  const me = await call(e, '/market/me', { session: buyer.session });
  assert.equal(me.body.bought.length, 1);
  // a sold prompt the seller removes stays with its buyer
  await call(e, '/market/delete', { session: seller.session, id });
  assert.equal((await call(e, '/market/me', { session: buyer.session })).body.bought.length, 1);
});
await t('you cannot buy your own prompt or a free one', async () => {
  const e = env(); const { id, seller } = await sellerWithPaidPrompt(e);
  assert.equal((await call(e, '/market/buy', { session: seller.session, id })).status, 409);
});

console.log('\nprompt pages');
const get = async (e, path) => { const r = await worker.fetch(new Request('https://api.test' + path, { headers: { Origin: SITE } }), e); return { status: r.status, body: await r.json() }; };
await t('each prompt has its own page and a public view without the prompt text', async () => {
  const e = env();
  const { session } = await signIn(e, 'free@example.com');
  const s = await call(e, '/market/save', { session, ...PROMPT, price: 0 });
  const id = s.body.prompt.id;
  assert.equal(s.body.prompt.path, '/prompt-marketplace/p/' + id + '/cover-letter-that-sounds-like-you/');
  const r = await get(e, '/market/prompt?id=' + id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.prompt.title, PROMPT.title);
  assert.equal(r.body.prompt.body, undefined, 'the page never gets the prompt text from this route');
  assert.equal(r.body.prompt.uid, undefined);
  assert.equal(r.body.prompt.path, promptPath({ id, title: PROMPT.title }));
  assert.equal((await get(e, '/market/prompt?id=nosuchprompt')).status, 404);
  assert.equal((await get(e, '/market/prompt?id=../x')).status, 404);
  await call(e, '/market/delete', { session, id });
  assert.equal((await get(e, '/market/prompt?id=' + id)).status, 404, 'a removed prompt has no page');
});
await t('slugs are safe for any title', async () => {
  assert.equal(promptPath({ id: 'abc234defg', title: 'Écrire un CV: <script> & 100% "better"!' }), '/prompt-marketplace/p/abc234defg/ecrire-un-cv-script-100-better/');
  assert.equal(promptPath({ id: 'abc234defg', title: '!!!' }), '/prompt-marketplace/p/abc234defg/');
});
await t('the sign-in link returns to the prompt page it was asked from, and only to the marketplace', async () => {
  const e = env(); mails = [];
  await call(e, '/market/login', { email: 'n@example.com', next: '/prompt-marketplace/p/abc234defg/cover-letter/' });
  assert.ok(mails[0].htmlContent.includes('https://thetechhut.co/prompt-marketplace/p/abc234defg/cover-letter/#login='));
  mails = [];
  await call(e, '/market/login', { email: 'n2@example.com', next: '//evil.example/' });
  assert.ok(mails[0].htmlContent.includes('https://thetechhut.co/prompt-marketplace/#login='));
});

console.log('\nemailing the prompt');
await t('Paystack returns the buyer to the prompt\'s own page', async () => {
  const e = env(); const { id } = await sellerWithPaidPrompt(e);
  const buyer = await signIn(e, 'buyer@example.com');
  await call(e, '/market/buy', { session: buyer.session, id });
  assert.equal(paid.last.callback_url, 'https://thetechhut.co/prompt-marketplace/p/' + id + '/cover-letter-that-sounds-like-you/');
});
await t('a sale emails the full prompt to the buyer, exactly once', async () => {
  const e = env(); const { id } = await sellerWithPaidPrompt(e);
  const buyer = await signIn(e, 'buyer@example.com');
  paid.verify = { status: 'success', currency: 'KES', amount: 30000, reference: 'ref_mail', metadata: { kind: 'market', pid: id, uid: buyer.user.id } };
  mails = [];
  const v = await call(e, '/market/verify', { reference: 'ref_mail' });   // even with no session, e.g. the webhook or a closed tab
  assert.equal(v.body.mailed, true);
  mails = mails.filter((m) => m.to[0].email === 'buyer@example.com');
  assert.equal(mails.length, 1);
  assert.ok(mails[0].subject.includes(PROMPT.title));
  assert.ok(mails[0].textContent.includes(PROMPT.body), 'the whole prompt is in the email');
  assert.ok(mails[0].htmlContent.includes('{company}'), 'escaped but intact');
  assert.ok(mails[0].htmlContent.includes('ref_mail'));
  await call(e, '/market/verify', { reference: 'ref_mail', session: buyer.session });
  await call(e, '/market/verify', { reference: 'ref_mail' });
  assert.equal(mails.filter((m) => m.to[0].email === 'buyer@example.com').length, 1, 'verify and the webhook again do not resend it');
});
await t('the seller is congratulated on each sale, once, without learning who bought', async () => {
  const e = env(); const { id } = await sellerWithPaidPrompt(e);
  const buyer = await signIn(e, 'buyer@example.com');
  paid.verify = { status: 'success', currency: 'KES', amount: 30000, reference: 'ref_sale', metadata: { kind: 'market', pid: id, uid: buyer.user.id } };
  mails = [];
  await call(e, '/market/verify', { reference: 'ref_sale' });
  const toSeller = mails.filter((m) => m.to[0].email === 'seller@example.com');
  assert.equal(toSeller.length, 1);
  assert.ok(toSeller[0].subject.startsWith('You made a sale'));
  assert.ok(toSeller[0].htmlContent.includes('Congratulations'));
  assert.ok(toSeller[0].htmlContent.includes('KES 270'), '90% of KES 300');
  assert.ok(toSeller[0].htmlContent.includes('your first sale'));
  assert.ok(toSeller[0].htmlContent.includes('ending 6789'));
  assert.ok(!toSeller[0].htmlContent.includes('buyer@example.com') && !toSeller[0].textContent.includes(PROMPT.body), 'no buyer identity, no prompt text');
  await call(e, '/market/verify', { reference: 'ref_sale', session: buyer.session });
  assert.equal(mails.filter((m) => m.to[0].email === 'seller@example.com').length, 1, 'not sent twice');
  const buyer2 = await signIn(e, 'buyer2@example.com'); mails = [];
  paid.verify = { status: 'success', currency: 'KES', amount: 30000, reference: 'ref_sale2', metadata: { kind: 'market', pid: id, uid: buyer2.user.id } };
  await call(e, '/market/verify', { reference: 'ref_sale2' });
  const second = mails.find((m) => m.to[0].email === 'seller@example.com');
  assert.ok(second.htmlContent.includes('sale number 2'));
});
await t('if the email fails, the next settle tries again', async () => {
  const e = env(); const { id } = await sellerWithPaidPrompt(e);
  const buyer = await signIn(e, 'buyer@example.com');
  paid.verify = { status: 'success', currency: 'KES', amount: 30000, reference: 'ref_retry', metadata: { kind: 'market', pid: id, uid: buyer.user.id } };
  mails = []; brevoDown = true;
  const v = await call(e, '/market/verify', { reference: 'ref_retry', session: buyer.session });
  brevoDown = false;
  assert.equal(v.body.paid, true); assert.equal(v.body.mailed, false);
  assert.ok(v.body.body, 'the buyer still sees the prompt on the page');
  const buyerMails = () => mails.filter((m) => m.to[0].email === 'buyer@example.com').length;
  const sellerMails = () => mails.filter((m) => m.to[0].email === 'seller@example.com').length;
  await call(e, '/market/verify', { reference: 'ref_retry' });
  assert.equal(buyerMails(), 1); assert.equal(sellerMails(), 1, 'the seller email is retried too');
  await call(e, '/market/verify', { reference: 'ref_retry' });
  assert.equal(buyerMails(), 1); assert.equal(sellerMails(), 1);
});
await t('prompt text with HTML is escaped in the email', async () => {
  const e = env();
  const seller = await signIn(e, 'seller@example.com');
  await call(e, '/market/payout', { session: seller.session, bank: '01', account: '0123456789' });
  const s = await call(e, '/market/save', { session: seller.session, ...PROMPT, title: 'Tags <b>bold</b> test', body: 'Write <img src=x onerror=alert(1)> as plain text, please, for my page.', price: 100 });
  const buyer = await signIn(e, 'buyer@example.com');
  paid.verify = { status: 'success', currency: 'KES', amount: 10000, reference: 'ref_esc', metadata: { kind: 'market', pid: s.body.prompt.id, uid: buyer.user.id } };
  mails = [];
  await call(e, '/market/verify', { reference: 'ref_esc' });
  assert.equal(mails.length, 2);
  for (const m of mails) assert.ok(!m.htmlContent.includes('<img src=x') && !m.htmlContent.includes('<b>bold'), 'escaped for ' + m.to[0].email);
  assert.ok(mails[0].htmlContent.includes('&lt;img src=x'));
});

console.log('\nwelcome and listing emails');
await t('a new member gets one welcome email after their first sign-in, never again', async () => {
  const e = env();
  const a = await signIn(e, 'new@example.com');
  const welcome = mails.filter((m) => m.tags[0] === 'market-welcome');
  assert.equal(welcome.length, 1);
  assert.deepEqual(welcome[0].to, [{ email: 'new@example.com' }]);
  assert.ok(welcome[0].htmlContent.includes('Welcome to the marketplace, New!'));
  assert.ok(welcome[0].htmlContent.includes('/prompt-marketplace/#sell'));
  await signIn(e, 'new@example.com');
  assert.equal(mails.filter((m) => m.tags[0] === 'market-welcome').length, 0, 'not on the second sign-in');
  assert.ok(a.session);
});
await t('if the welcome email fails, the next sign-in sends it', async () => {
  const e = env();
  mails = [];
  const r = await call(e, '/market/login', { email: 'late@example.com' });
  const link = mails[0].htmlContent.match(/#login=([A-Za-z0-9._-]+)/)[1];
  brevoDown = true;
  assert.equal((await call(e, '/market/session', { t: link })).status, 200, 'sign-in still works');
  brevoDown = false;
  await signIn(e, 'late@example.com');
  assert.equal(mails.filter((m) => m.tags[0] === 'market-welcome').length, 1);
  assert.equal(r.status, 200);
});
await t('posting a new prompt emails its link with share buttons; edits do not', async () => {
  const e = env();
  const { session } = await signIn(e, 'poster@example.com');
  mails = [];
  const s = await call(e, '/market/save', { session, ...PROMPT, price: 0 });
  assert.equal(s.status, 200);
  assert.equal(s.body.created, undefined, 'internal fields stay server-side');
  const url = 'https://thetechhut.co' + s.body.prompt.path;
  assert.equal(mails.length, 1);
  const m = mails[0];
  assert.equal(m.tags[0], 'market-listed');
  assert.deepEqual(m.to, [{ email: 'poster@example.com' }]);
  assert.ok(m.subject.startsWith('Welcome, seller'), 'the first prompt gets the welcome');
  assert.ok(m.htmlContent.includes(url));
  assert.ok(m.htmlContent.includes('https://wa.me/?text=' + encodeURIComponent(PROMPT.title + ' (free): an AI prompt on The Tech Hut marketplace ' + url)));
  assert.ok(m.htmlContent.includes('linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url)));
  assert.ok(m.htmlContent.includes('x.com/intent/post?'));
  mails = [];
  await call(e, '/market/save', { session, id: s.body.prompt.id, ...PROMPT, title: 'Cover letter, edited', price: 0 });
  assert.equal(mails.length, 0, 'an edit sends nothing');
  await call(e, '/market/save', { session, ...PROMPT, title: 'A second prompt for interviews', price: 0 });
  assert.equal(mails.length, 1);
  assert.ok(mails[0].subject.startsWith('Your prompt is live'), 'later prompts get the shorter email');
});
await t('a prompt title with HTML is escaped in the listing email', async () => {
  const e = env();
  const { session } = await signIn(e, 'poster@example.com');
  mails = [];
  await call(e, '/market/save', { session, ...PROMPT, title: 'Prompt <script>x</script> here', price: 0 });
  assert.ok(!mails[0].htmlContent.includes('<script>'));
});

console.log('\nswitches');
await t('without MARKET_SECRET the marketplace answers 503, and other routes are untouched', async () => {
  const e = env(); delete e.MARKET_SECRET;
  assert.equal((await call(e, '/market/login', { email: 'a@b.co' })).status, 503);
});

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
