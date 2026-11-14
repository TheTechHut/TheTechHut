/**
 * Tests for the events list (src/events.js): the Luma feed and its cache,
 * admin-only sign-in links, and posting, editing and deleting events.   npm test
 */
import worker, { Events } from '../src/index.js';
import { cleanEvent, lumaEvents, LUMA_TTL, LUMA_USER } from '../src/events.js';
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
    put: async (k, v) => { store.set(k, structuredClone(v)); },
    delete: async (k) => { for (const x of [].concat(k)) store.delete(x); },
    list: async ({ prefix }) => new Map([...store].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
  };
}
function ns() {
  const obj = new Events({ storage: fakeStorage() });
  return { idFromName: (n) => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
}
const SITE = 'https://thetechhut.co';
const SECRET = 'test-secret-0123456789';
const luma = (id, name, start, extra = {}) => ({ api_id: id, event: { api_id: id, name, start_at: start, end_at: '', timezone: 'Africa/Nairobi',
  location_type: 'meet', url: 'slug' + id, cover_url: 'https://images.lumacdn.com/' + id + '.png', visibility: 'public', geo_address_info: null, ...extra } });
let mails = [], lumaCalls = [], lumaFeed = { future: [], past: [] }, lumaDown = false;
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u.startsWith('https://api.brevo.com')) { mails.push(JSON.parse(init.body)); return new Response('{"messageId":"x"}', { status: 201 }); }
  if (u.startsWith('https://cloudflare-dns.com')) return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: '10 mx.example.com.' }] }));
  if (u.startsWith('https://api.luma.com/')) {
    lumaCalls.push(u);
    if (lumaDown) return new Response('no', { status: 503 });
    return Response.json({ entries: lumaFeed[new URL(u).searchParams.get('period')], has_more: false });
  }
  throw new Error('unexpected fetch ' + u);
};

const env = (extra = {}) => ({ EVENTS: ns(), MARKET_SECRET: SECRET, BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'hi@thetechhut.co', ...extra });
const post = (path, body) => new Request('https://api.test' + path, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify(body) });
const call = async (e, path, body) => { const r = await worker.fetch(post(path, body), e); return { status: r.status, body: await r.json() }; };
const list = async (e) => (await (await worker.fetch(new Request('https://api.test/events/list', { headers: { Origin: SITE } }), e)).json());
async function signIn(e, email = 'info@thetechhut.co') {
  mails = [];
  const r = await call(e, '/events/login', { email });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const link = mails[0].htmlContent.match(/#login=([A-Za-z0-9._-]+)/)[1];
  const s = await call(e, '/events/session', { t: link });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return { ...s.body, link };
}
const EVENT = { title: 'Build Night: ship a project', start: '2026-12-05T18:00:00+03:00', end: '2026-12-05T21:00:00+03:00',
  location: 'iHub, Nairobi', url: 'https://luma.com/buildnight', cover: 'https://images.lumacdn.com/x.png', price: 'Free', desc: 'Bring a laptop.' };

console.log('luma');
await t('maps Luma entries and skips private or broken ones', () => {
  const out = lumaEvents([
    luma('evt-1', 'ASK ME ANYTHING ABOUT TECH', '2025-12-17T11:00:00.000Z'),
    luma('evt-2', 'Demo Day', '2025-10-11T16:00:00.000Z', { location_type: 'offline', geo_address_info: { city_state: 'Nairobi, Nairobi County' } }),
    luma('evt-3', 'Private', '2025-10-11T16:00:00.000Z', { visibility: 'private' }),
    { api_id: 'x' }, null,
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].id, out[0].source, out[0].location, out[0].url], ['luma-evt-1', 'luma', 'Online', 'https://luma.com/slugevt-1']);
  assert.equal(out[1].location, 'Nairobi, Nairobi County');
});
await t('list fetches upcoming and past from Luma once, then serves the cache', async () => {
  const e = env(); lumaCalls = []; lumaDown = false;
  lumaFeed = { future: [luma('evt-f', 'Next meetup', '2027-01-10T15:00:00.000Z')], past: [luma('evt-p', 'Old meetup', '2025-08-29T17:00:00.000Z')] };
  const a = await list(e);
  assert.deepEqual(a.events.map((x) => x.title), ['Next meetup', 'Old meetup'], 'newest first');
  assert.equal(lumaCalls.length, 2);
  assert.ok(lumaCalls.every((u) => u.includes('user_api_id=' + LUMA_USER)));
  await list(e);
  assert.equal(lumaCalls.length, 2, 'second read comes from the cache');
  assert.ok(LUMA_TTL >= 60 * 60 * 1000);
});
await t('a Luma outage still returns posted events, and an empty Luma list', async () => {
  const e = env(); lumaDown = true; lumaFeed = { future: [], past: [] };
  const s = await signIn(e);
  await call(e, '/events/save', { session: s.session, event: EVENT });
  const a = await list(e);
  assert.deepEqual(a.events.map((x) => x.title), [EVENT.title]);
  lumaDown = false;
});

console.log('sign-in');
await t('only an admin address is sent a link; others get the same reply and no email', async () => {
  const e = env(); mails = [];
  const r = await call(e, '/events/login', { email: 'someone@example.com' });
  assert.deepEqual([r.status, r.body.ok, mails.length], [200, true, 0]);
  const s = await signIn(e, 'Info@TheTechHut.co');
  assert.equal(s.email, 'info@thetechhut.co');
  assert.ok(mails[0].htmlContent.includes('https://thetechhut.co/events/#login='));
  assert.equal((await call(e, '/events/session', { t: s.link })).status, 400, 'a used link is refused');
});
await t('EVENTS_ADMINS replaces the default admin', async () => {
  const e = env({ EVENTS_ADMINS: 'a@x.co, B@y.co' }); mails = [];
  await call(e, '/events/login', { email: 'info@thetechhut.co' });
  assert.equal(mails.length, 0);
  assert.equal((await signIn(e, 'b@y.co')).email, 'b@y.co');
});
await t('marketplace tokens and non-admin sessions cannot post', async () => {
  const e = env(); const x = Date.now() + 60000;
  for (const tok of [
    await sign({ k: 's', u: 'user1', x }, SECRET),                      // a marketplace session
    await sign({ k: 'es', e: 'someone@example.com', x }, SECRET),        // right kind, not an admin
    await sign({ k: 'es', e: 'info@thetechhut.co', x }, 'other-secret'), // forged
    await sign({ k: 'es', e: 'info@thetechhut.co', x: Date.now() - 1 }, SECRET),
  ]) assert.equal((await call(e, '/events/save', { session: tok, event: EVENT })).status, 401);
  assert.equal((await call(e, '/events/session', { t: await sign({ k: 'l', e: 'info@thetechhut.co', n: 'n', x }, SECRET) })).status, 400, 'a marketplace link is not an events link');
  assert.equal((await call(e, '/events/delete', { id: 'evaaaaaaaaaa' })).status, 401);
});

console.log('posting');
await t('cleanEvent validates the fields', () => {
  assert.ok(cleanEvent(EVENT).event);
  assert.match(cleanEvent({ ...EVENT, title: 'Hi' }).error, /title/);
  assert.match(cleanEvent({ ...EVENT, start: 'tomorrow' }).error, /date/);
  assert.match(cleanEvent({ ...EVENT, end: '2026-12-05T17:00:00+03:00' }).error, /end time/);
  assert.match(cleanEvent({ ...EVENT, location: '' }).error, /where/);
  assert.match(cleanEvent({ ...EVENT, url: 'javascript:alert(1)' }).error, /link/);
  assert.match(cleanEvent({ ...EVENT, url: 'http://luma.com/x' }).error, /link/);
  assert.equal(cleanEvent({ ...EVENT, cover: 'http://x.co/a.png' }).event.cover, '', 'a non-https poster is dropped');
});
await t('an admin adds, edits and deletes an event', async () => {
  const e = env(); lumaFeed = { future: [], past: [] };
  const s = await signIn(e);
  const bad = await call(e, '/events/save', { session: s.session, event: { ...EVENT, title: '' } });
  assert.equal(bad.status, 400);
  const a = await call(e, '/events/save', { session: s.session, event: EVENT });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(a.body.event.id, /^ev[a-z2-9]{10}$/);
  assert.deepEqual([a.body.event.source, a.body.event.by], ['hut', 'info@thetechhut.co']);
  const b = await call(e, '/events/save', { session: s.session, id: a.body.event.id, event: { ...EVENT, title: 'Build Night, moved' } });
  assert.equal(b.body.event.id, a.body.event.id);
  assert.equal(b.body.event.created, a.body.event.created);
  let l = await list(e);
  assert.deepEqual(l.events.map((x) => x.title), ['Build Night, moved']);
  assert.equal((await call(e, '/events/save', { session: s.session, id: 'evzzzzzzzzzz', event: EVENT })).status, 400, 'unknown id');
  await call(e, '/events/delete', { session: s.session, id: a.body.event.id });
  l = await list(e);
  assert.equal(l.events.length, 0);
});
await t('a posted event with the same link replaces the Luma copy', async () => {
  const e = env();
  lumaFeed = { future: [luma('evt-d', 'Luma title', '2026-12-05T15:00:00.000Z', { url: 'buildnight' })], past: [] };
  const s = await signIn(e);
  await call(e, '/events/save', { session: s.session, event: EVENT });
  const l = await list(e);
  assert.deepEqual(l.events.map((x) => [x.title, x.source]), [[EVENT.title, 'hut']]);
});
await t('off without the binding or the secret', async () => {
  const r = await worker.fetch(new Request('https://api.test/events/list', { headers: { Origin: SITE } }), { MARKET_SECRET: SECRET });
  assert.equal(r.status, 503);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
