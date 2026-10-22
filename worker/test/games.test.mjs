/**
 * Tests for the games page counter (src/games.js), run against the real
 * Worker with an in-memory stand-in for the Durable Object:  npm test
 */
import worker, { GameStats } from '../src/index.js';
import { LIVE_MS } from '../src/games.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

function fakeNamespace() {
  const store = new Map();
  const obj = new GameStats({ storage: { get: async k => store.get(k), put: async (k, v) => { store.set(k, v); } } });
  return {
    obj, store,
    idFromName: n => n,
    get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }),
  };
}

const sid = n => ('sid' + n).padEnd(24, 'x');
const req = (path, body, { origin = 'https://thetechhut.co', ip = '1.2.3.4' } = {}) =>
  new Request('https://api.test' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: origin, 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const call = async (env, path, body, opts) => {
  const r = await worker.fetch(req(path, body, opts), env);
  return { status: r.status, body: await r.json(), headers: r.headers };
};

console.log('\ngames counter');

await t('first ping of a session counts a visit and a live player', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  const r = await call(env, '/games/ping', { sid: sid(1), visit: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { live: 1, visits: 1 });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://thetechhut.co');
});

await t('heartbeats keep the player live without adding visits', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  const r = await call(env, '/games/ping', { sid: sid(1) });
  assert.deepEqual(r.body, { live: 1, visits: 1 });
});

await t('a repeated visit:true from the same tab is counted once', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  const r = await call(env, '/games/ping', { sid: sid(1), visit: true });
  assert.equal(r.body.visits, 1);
});

await t('two tabs are two live players and two visits', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  const r = await call(env, '/games/ping', { sid: sid(2), visit: true });
  assert.deepEqual(r.body, { live: 2, visits: 2 });
});

await t('leave removes the player at once', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  const r = await call(env, '/games/leave', { sid: sid(1) });
  assert.deepEqual(r.body, { live: 0, visits: 1 });
});

await t('a player who stops pinging drops out after the live window', async () => {
  const ns = fakeNamespace(), env = { GAME_STATS: ns };
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  ns.obj.seen.set(sid(1), Date.now() - LIVE_MS - 1000);
  const r = await call(env, '/games/ping', { sid: sid(2) });
  assert.equal(r.body.live, 1);
});

await t('the visit total survives the object being restarted', async () => {
  const ns = fakeNamespace(), env = { GAME_STATS: ns };
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  const fresh = new GameStats({ storage: { get: async k => ns.store.get(k), put: async (k, v) => ns.store.set(k, v) } });
  const r = await fresh.fetch(new Request('https://x/ping', { method: 'POST', body: JSON.stringify({ op: 'ping', sid: sid(9), visit: true, ip: '9.9.9.9' }) }));
  assert.equal((await r.json()).visits, 2);
});

await t('one IP cannot add more than 30 visits an hour', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  let r;
  for (let i = 0; i < 40; i++) r = await call(env, '/games/ping', { sid: sid(i), visit: true });
  assert.equal(r.body.visits, 30);
  r = await call(env, '/games/ping', { sid: sid(99), visit: true }, { ip: '5.6.7.8' });
  assert.equal(r.body.visits, 31);
});

await t('pings from other sites are refused', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  const r = await call(env, '/games/ping', { sid: sid(1), visit: true }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(env.GAME_STATS.obj.visits, null);
});

await t('a malformed id or body is rejected', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  assert.equal((await call(env, '/games/ping', { sid: 'short' })).status, 400);
  assert.equal((await call(env, '/games/ping', { sid: 'x'.repeat(20) + '<script>' })).status, 400);
  assert.equal((await call(env, '/games/ping', 'not json')).status, 400);
});

await t('without the Durable Object binding it answers 503, not a crash', async () => {
  const r = await call({}, '/games/ping', { sid: sid(1) });
  assert.equal(r.status, 503);
});

await t('the counter works without the Paystack key being set', async () => {
  const env = { GAME_STATS: fakeNamespace() };   // no PAYSTACK_SECRET_KEY
  assert.equal((await call(env, '/games/ping', { sid: sid(1), visit: true })).status, 200);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
