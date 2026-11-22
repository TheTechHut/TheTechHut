/**
 * Tests for the site dashboard (src/admin.js): admin-only sign-in, sessions
 * that are not marketplace sessions, the overview, and the moderation actions.
 *   npm test
 */
import worker, { Market } from '../src/index.js';
import { Events } from '../src/events.js';
import { sign } from '../src/market.js';
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
function ns(Cls) {
  const obj = new Cls({ storage: fakeStorage() });
  return { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
}
const SITE = 'https://thetechhut.co';
let mails = [], paid = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u === 'https://api.brevo.com/v3/smtp/email') { mails.push(JSON.parse(init.body)); return new Response('{"messageId":"x"}', { status: 201 }); }
  if (u.startsWith('https://api.brevo.com/v3/contacts/lists/')) { const id = u.split('/').pop(); return Response.json({ id: Number(id), name: 'L' + id, uniqueSubscribers: Number(id) * 10, totalBlacklisted: 1 }); }
  if (u.startsWith('https://cloudflare-dns.com')) return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: '10 mx.example.com.' }] }));
  if (u.startsWith('https://api.luma.com')) return Response.json({ entries: [] });
  if (u.startsWith('https://api.paystack.co')) {
    const path = u.slice('https://api.paystack.co'.length);
    if (path.startsWith('/subaccount')) return Response.json({ status: true, data: { subaccount_code: 'ACCT_1', settlement_bank: 'Test Bank', account_name: 'X' } });
    if (path.startsWith('/transaction/verify/')) return Response.json({ status: true, data: paid.verify });
    if (path === '/transaction/totals') return Response.json({ status: true, data: { total_transactions: 7, total_volume_by_currency: [{ currency: 'KES', amount: 450000 }], pending_transfers_by_currency: [{ currency: 'KES', amount: 0 }] } });
    if (path.startsWith('/transaction?')) return Response.json({ status: true, data: [
      { reference: 'a', amount: 50000, paid_at: '2026-11-20T10:00:00Z', customer: { email: 'x@y.co' }, metadata: { product: 'remote-list' }, channel: 'mobile_money' },
      { reference: 'b', amount: 50000, paid_at: '2026-11-21T10:00:00Z', customer: { email: 'z@y.co' }, metadata: { product: 'remote-list' }, channel: 'card' },
      { reference: 'c', amount: 30000, paid_at: '2026-11-21T11:00:00Z', customer: { email: 'b@y.co' }, metadata: { kind: 'market', pid: 'p' }, channel: 'card' },
    ] });
  }
  throw new Error('unexpected fetch ' + u);
};
const env = (over = {}) => ({ MARKET: ns(Market), EVENTS: ns(Events), MARKET_SECRET: 'test-secret-0123456789', PAYSTACK_SECRET_KEY: 'sk_test_x',
  BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'hi@thetechhut.co', BREVO_LIST_ID: '3', BREVO_LIST_ID_DAILY: '5', SITE_ADMINS: 'boss@thetechhut.co, ops@thetechhut.co', ...over });
const req = (path, body, origin = SITE) => new Request('https://api.test' + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify(body) });
const call = async (e, path, body, origin) => { const r = await worker.fetch(req(path, body, origin), e); return { status: r.status, body: await r.json() }; };
async function adminSession(e, email = 'boss@thetechhut.co') {
  mails = [];
  assert.equal((await call(e, '/admin/login', { email })).status, 200);
  const link = mails[0].htmlContent.match(/\/admin\/#login=([A-Za-z0-9._-]+)/)[1];
  const s = await call(e, '/admin/session', { t: link });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return { session: s.body.session, link };
}
async function marketSignIn(e, email) {
  mails = [];
  await call(e, '/market/login', { email });
  const link = mails[0].htmlContent.match(/#login=([A-Za-z0-9._-]+)/)[1];
  return (await call(e, '/market/session', { t: link })).body;
}
const PROMPT = { title: 'Cover letter that sounds like you', desc: 'Turns a job ad and your CV into a short, specific cover letter.', cat: 'career', model: 'any',
  preview: 'You are a hiring manager...', body: 'You are a hiring manager at {company}. Read the job ad and my CV below and write a 200-word cover letter.' };

console.log('sign-in');
await t('only listed admins are emailed a link, and everyone gets the same answer', async () => {
  const e = env(); mails = [];
  const r = await call(e, '/admin/login', { email: 'stranger@example.com' });
  assert.equal(r.status, 200); assert.equal(mails.length, 0);
  const a = await adminSession(e, 'OPS@thetechhut.co'.toLowerCase());
  assert.ok(a.session);
  assert.ok(mails[0].htmlContent.includes('https://thetechhut.co/admin/#login='));
});
await t('a link works once; a marketplace session is not an admin session', async () => {
  const e = env();
  const { link } = await adminSession(e);
  assert.equal((await call(e, '/admin/session', { t: link })).status, 400);
  const m = await marketSignIn(e, 'boss@thetechhut.co');
  assert.equal((await call(e, '/admin/overview', { session: m.session })).status, 401);
  assert.equal((await call(e, '/admin/overview', {})).status, 401);
});
await t('removing someone from SITE_ADMINS locks them out at once', async () => {
  const e = env();
  const { session } = await adminSession(e, 'ops@thetechhut.co');
  e.SITE_ADMINS = 'boss@thetechhut.co';
  assert.equal((await call(e, '/admin/overview', { session })).status, 401);
});
await t('other sites cannot call the dashboard', async () => {
  const e = env();
  assert.equal((await call(e, '/admin/login', { email: 'boss@thetechhut.co' }, 'https://evil.example')).status, 403);
});
await t('without SITE_ADMINS it falls back to the events admins', async () => {
  const e = env({ SITE_ADMINS: undefined, EVENTS_ADMINS: 'events@thetechhut.co' }); mails = [];
  await call(e, '/admin/login', { email: 'events@thetechhut.co' });
  assert.equal(mails.length, 1);
});

console.log('\noverview');
async function withSale(e) {
  const seller = await marketSignIn(e, 'seller@example.com');
  await call(e, '/market/payout', { session: seller.session, bank: '01', account: '0123456789' });
  const s = await call(e, '/market/save', { session: seller.session, ...PROMPT, price: 300 });
  const buyer = await marketSignIn(e, 'buyer@example.com');
  paid.verify = { status: 'success', currency: 'KES', amount: 30000, reference: 'ref_0001', metadata: { kind: 'market', pid: s.body.prompt.id, uid: buyer.user.id } };
  await call(e, '/market/verify', { reference: 'ref_0001' });
  return { pid: s.body.prompt.id, buyer, seller };
}
await t('the overview has the marketplace, payments, lists and config, and survives a missing source', async () => {
  const e = env(); await withSale(e);
  const { session } = await adminSession(e);
  const r = await call(e, '/admin/overview', { session });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = r.body.market;
  assert.equal(m.totals.members, 2); assert.equal(m.totals.sales, 1); assert.equal(m.totals.revenue, 300); assert.equal(m.totals.commission, 30);
  assert.equal(m.totals.sellers, 1); assert.equal(m.totals.unmailed, 0);
  assert.equal(m.sales[0].buyer, 'buyer@example.com'); assert.equal(m.topSellers[0].email, 'seller@example.com');
  assert.equal(r.body.payments.allTime.kes, 4500); assert.equal(r.body.payments.mode, 'test');
  assert.deepEqual(r.body.payments.byProduct.map((x) => [x.product, x.count, x.kes]), [['remote-list', 2, 1000], ['Prompt marketplace', 1, 300]]);
  assert.deepEqual(r.body.newsletter.lists.map((l) => l.subscribers ?? l.error), [30, 50, 'list id not set']);
  assert.equal(r.body.newsletter.total, 80);
  assert.ok(r.body.games.error, 'GAME_STATS unbound shows as an error, not a failure');
  assert.equal(r.body.events.upcoming, 0);
  assert.equal(r.body.config.paystack, true);
  assert.equal(JSON.stringify(r.body).includes('sk_test_x'), false, 'no secrets in the overview');
});

console.log('\nactions');
await t('hide and restore any prompt, and clear its reports', async () => {
  const e = env(); const { pid } = await withSale(e);
  const { session } = await adminSession(e);
  const list = async () => (await (await worker.fetch(new Request('https://api.test/market/prompts'), e)).json()).prompts.length;
  await call(e, '/market/report', { id: pid });
  assert.equal((await call(e, '/admin/prompt', { session, id: pid, action: 'hide' })).status, 200);
  assert.equal(await list(), 0);
  const r = await call(e, '/admin/prompt', { session, id: pid, action: 'restore' });
  assert.equal(r.body.reports, 0); assert.equal(await list(), 1);
  assert.equal((await call(e, '/admin/prompt', { session, id: pid, action: 'nuke' })).status, 400);
  assert.equal((await call(e, '/admin/prompt', { session, id: 'nosuchprompt', action: 'hide' })).status, 404);
});
await t('resend a purchase email to the buyer or the seller', async () => {
  const e = env(); const { pid, buyer } = await withSale(e);
  const { session } = await adminSession(e); mails = [];
  assert.equal((await call(e, '/admin/resend', { session, uid: buyer.user.id, pid, who: 'buyer' })).status, 200);
  assert.equal(mails[0].to[0].email, 'buyer@example.com'); assert.ok(mails[0].textContent.includes(PROMPT.body));
  assert.equal((await call(e, '/admin/resend', { session, uid: buyer.user.id, pid, who: 'seller' })).status, 200);
  assert.equal(mails[1].to[0].email, 'seller@example.com');
  assert.equal((await call(e, '/admin/resend', { session, uid: 'nobody', pid, who: 'buyer' })).status, 502);
});
await t('posted events can be removed; Luma ids are refused', async () => {
  const e = env();
  const { session } = await adminSession(e);
  assert.equal((await call(e, '/admin/event-delete', { session, id: 'luma-evt-123' })).status, 400);
  assert.equal((await call(e, '/admin/event-delete', { session, id: 'evabcdefghjk' })).status, 200);
});

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
