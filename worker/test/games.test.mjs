/**
 * Tests for the games arcade (src/games.js): live counts, visits, play-time
 * leaderboards, nicknames and Sign in with Google. Runs against the real
 * Worker with an in-memory stand-in for the Durable Object:  npm test
 */
import worker, { GameStats } from '../src/index.js';
import { LIVE_MS, MAX_STEP_MS, weekOf, cleanName, _resetJwksCache } from '../src/games.js';
import { GAME_SLUGS } from '../src/game-slugs.js';
import assert from 'node:assert';
import { createRequire } from 'node:module';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); fail++; }
}

function fakeStorage(store = new Map()) {
  return {
    store,
    get: async k => store.get(k),
    put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
    delete: async k => { for (const x of [].concat(k)) store.delete(x); },
    list: async ({ prefix, end }) => new Map([...store].filter(([k]) => k.startsWith(prefix) && (!end || k < end))),
    setAlarm: () => {},
  };
}
function fakeNamespace(store) {
  const storage = fakeStorage(store);
  const obj = new GameStats({ storage });
  return { obj, store: storage.store, idFromName: n => n, get: () => ({ fetch: (u, init) => obj.fetch(new Request(u, init)) }) };
}

// A clock we can move, so play time can be tested without waiting.
const realNow = Date.now;
let clock = Date.UTC(2026, 9, 27, 9, 0, 0);
Date.now = () => clock;
const tick = s => { clock += s * 1000; };

const sid = n => ('sid' + n).padEnd(24, 'x');
const nick = n => ('n_' + n).padEnd(26, 'z');
const req = (path, body, { origin = 'https://thetechhut.co', ip = '1.2.3.4', method = 'POST' } = {}) =>
  new Request('https://api.test' + path, method === 'GET' ? { headers: { Origin: origin } } : {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: origin, 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const call = async (env, path, body, opts) => {
  const r = await worker.fetch(req(path, body, opts), env);
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const board = async env => (await call(env, '/games/board', null, { method: 'GET' })).body;
// Play `secs` seconds of a game in one tab, pinging every 30s like the player page.
async function play(env, s, slug, secs, extra = {}, ip) {
  await call(env, '/games/ping', { sid: s, slug, ...extra }, { ip });
  for (let done = 0; done < secs; done += 30) { tick(Math.min(30, secs - done)); await call(env, '/games/ping', { sid: s, slug, ...extra }, { ip }); }
}

console.log('\nlive count and visits');

await t('first ping of a session counts a visit and a live player', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  const r = await call(env, '/games/ping', { sid: sid(1), visit: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.live, 1); assert.equal(r.body.visits, 1);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://thetechhut.co');
});

await t('heartbeats and repeated visit flags from one tab count one visit', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  const r = await call(env, '/games/ping', { sid: sid(1) });
  assert.equal(r.body.live, 1); assert.equal(r.body.visits, 1);
});

await t('leave removes the player at once; silence drops them after the live window', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  await call(env, '/games/ping', { sid: sid(2), visit: true });
  assert.equal((await call(env, '/games/leave', { sid: sid(1) })).body.live, 1);
  tick(LIVE_MS / 1000 + 1);
  assert.equal((await call(env, '/games/ping', { sid: sid(3) })).body.live, 1);
});

await t('the visit total is written on the next flush and survives a restart', async () => {
  const ns = fakeNamespace(), env = { GAME_STATS: ns };
  await call(env, '/games/ping', { sid: sid(1), visit: true });
  await ns.obj.alarm();
  const fresh = new GameStats({ storage: fakeStorage(ns.store) });
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

await t('pings from other sites are refused; bad ids and bodies are rejected', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  assert.equal((await call(env, '/games/ping', { sid: sid(1) }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(env, '/games/ping', { sid: 'short' })).status, 400);
  assert.equal((await call(env, '/games/ping', 'not json')).status, 400);
  assert.equal((await call({}, '/games/ping', { sid: sid(1) })).status, 503);
});

console.log('\nplay time');

await t('a game earns time between pings and a play on first ping', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await play(env, sid(1), 'doom', 120);
  const b = await board(env);
  assert.equal(b.games[0].slug, 'doom'); assert.equal(b.games[0].secs, 120); assert.equal(b.games[0].plays, 1);
  assert.equal(b.liveBySlug.doom, 1);
});

await t('a long gap between pings adds at most 35 seconds', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await call(env, '/games/ping', { sid: sid(1), slug: 'doom' });
  tick(600);
  await call(env, '/games/ping', { sid: sid(1), slug: 'doom' });
  assert.equal((await board(env)).games[0].secs, MAX_STEP_MS / 1000);
});

await t('switching game in a tab starts a new play, not borrowed time', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await play(env, sid(1), 'doom', 60);
  tick(20);
  await call(env, '/games/ping', { sid: sid(1), slug: 'tetris' });
  const g = Object.fromEntries((await board(env)).games.map(x => [x.slug, x]));
  assert.equal(g.doom.secs, 60); assert.equal(g.tetris.secs, 0); assert.equal(g.tetris.plays, 1);
});

await t('unknown game slugs earn nothing', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await play(env, sid(1), 'not-a-game', 60);
  assert.deepEqual((await board(env)).games, []);
});

await t('one IP earns time in at most six tabs at once', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  for (let i = 0; i < 10; i++) await call(env, '/games/ping', { sid: sid(i), slug: 'doom' });
  tick(30);
  for (let i = 0; i < 10; i++) await call(env, '/games/ping', { sid: sid(i), slug: 'doom' });
  assert.equal((await board(env)).games[0].secs, 6 * 30);
});

console.log('\nplayers and nicknames');

await t('anonymous players add to game totals but never to the player boards', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await play(env, sid(1), 'doom', 90);
  const b = await board(env);
  assert.equal(b.players.length, 0); assert.equal(b.sessions.length, 0); assert.equal(b.games[0].secs, 90);
});

await t('a nickname player gets ranked time, a best session and their own stats', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await play(env, sid(1), 'doom', 300, { pid: nick('a'), name: 'Wanjiku' });
  await play(env, sid(2), 'tetris', 60, { pid: nick('b'), name: 'Otieno' });
  const r = await call(env, '/games/ping', { sid: sid(5), pid: nick('a'), name: 'Wanjiku' });   // no game: adds no time
  assert.equal(r.body.me.rank, 1); assert.equal(r.body.me.secs, 300); assert.equal(r.body.me.best, 300);
  const b = await board(env);
  assert.deepEqual(b.players.map(p => [p.name, p.secs, p.top, p.verified]), [['Wanjiku', 300, 'doom', false], ['Otieno', 60, 'tetris', false]]);
  assert.equal(b.sessions[0].name, 'Wanjiku'); assert.equal(b.sessions[0].secs, 300);
  assert.ok(!('k' in b.sessions[0]) && !('p' in b.sessions[0]), 'no ids on the public board');
});

await t('each sitting gets its own row on the longest-sittings board', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await play(env, 'a'.repeat(20) + '01', 'doom', 90, { pid: nick('a'), name: 'Wanjiku' }, '1.1.1.1');
  await play(env, 'a'.repeat(20) + '02', 'tetris', 60, { pid: nick('b'), name: 'Otieno' }, '2.2.2.2');
  assert.deepEqual((await board(env)).sessions.map(s => [s.name, s.slug, s.secs]), [['Wanjiku', 'doom', 90], ['Otieno', 'tetris', 60]]);
});

await t('two tabs from one player count once', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  const who = { pid: nick('a'), name: 'Wanjiku' };
  await call(env, '/games/ping', { sid: sid(1), slug: 'doom', ...who });
  await call(env, '/games/ping', { sid: sid(2), slug: 'tetris', ...who });
  for (let i = 0; i < 4; i++) { tick(30); await call(env, '/games/ping', { sid: sid(1), slug: 'doom', ...who }); await call(env, '/games/ping', { sid: sid(2), slug: 'tetris', ...who }); }
  const p = (await board(env)).players[0];
  assert.equal(p.secs, 120);
});

await t('rude or malformed nicknames keep the player off the boards', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  const r = await call(env, '/games/ping', { sid: sid(1), slug: 'doom', pid: nick('a'), name: 'F.u.c.k you' });
  assert.equal(r.body.nameOk, false);
  assert.equal(cleanName('<script>'), null); assert.equal(cleanName('a'), null); assert.equal(cleanName('x'.repeat(21)), null);
  assert.equal(cleanName('  Kip   Kiprop '), 'Kip Kiprop'); assert.equal(cleanName('Zoë_254'), 'Zoë_254');
});

await t('a forged Google-style id is not trusted', async () => {
  const env = { GAME_STATS: fakeNamespace(), GAMES_SECRET: 's3cret' };
  const r = await call(env, '/games/ping', { sid: sid(1), slug: 'doom', pid: 'g_' + 'a'.repeat(22), sig: 'nope', name: 'Faker' });
  assert.equal(r.body.badId, true); assert.equal(r.body.me, undefined);
});

await t('leaving deletes every week of a player\'s records', async () => {
  const ns = fakeNamespace(), env = { GAME_STATS: ns };
  await play(env, sid(1), 'doom', 60, { pid: nick('a'), name: 'Wanjiku' });
  await ns.obj.alarm();
  tick(7 * 86400);
  await play(env, sid(2), 'doom', 60, { pid: nick('a'), name: 'Wanjiku' });
  await ns.obj.alarm();
  assert.equal([...ns.store.keys()].filter(k => k.endsWith(nick('a'))).length, 2);
  await call(env, '/games/forget', { pid: nick('a') });
  await ns.obj.alarm();
  assert.equal([...ns.store.keys()].filter(k => k.endsWith(nick('a'))).length, 0);
});

await t('player records older than a year are deleted when a week turns', async () => {
  const ns = fakeNamespace(), env = { GAME_STATS: ns };
  ns.store.set('pw:2025-W40:' + nick('old'), { n: 'Old', s: 10, g: {}, d: [] });
  ns.store.set('pw:2026-W02:' + nick('kept'), { n: 'Kept', s: 10, g: {}, d: [] });
  await board(env);
  assert.ok(!ns.store.has('pw:2025-W40:' + nick('old'))); assert.ok(ns.store.has('pw:2026-W02:' + nick('kept')));
});

await t('forget removes a player from the boards', async () => {
  const env = { GAME_STATS: fakeNamespace() };
  await play(env, sid(1), 'doom', 120, { pid: nick('a'), name: 'Wanjiku' });
  assert.equal((await call(env, '/games/forget', { pid: nick('a') })).body.ok, true);
  const b = await board(env);
  assert.equal(b.players.length, 0); assert.equal(b.sessions.length, 0); assert.equal(b.games[0].secs, 120);
});

console.log('\nweeks and storage');

await t('weeks run Monday to Sunday in Nairobi time', async () => {
  assert.equal(weekOf(Date.UTC(2026, 9, 25, 20, 59)), '2026-W43');   // Sun 23:59 EAT
  assert.equal(weekOf(Date.UTC(2026, 9, 25, 21, 0)), '2026-W44');    // Mon 00:00 EAT
  assert.equal(weekOf(Date.UTC(2027, 0, 1, 12)), '2026-W53');
});

await t('a new week starts empty boards and keeps all-time totals', async () => {
  const ns = fakeNamespace(), env = { GAME_STATS: ns };
  await play(env, sid(1), 'doom', 60, { pid: nick('a'), name: 'Wanjiku' });
  const wk = weekOf(Date.now());
  tick(7 * 86400);
  const b = await board(env);
  assert.equal(b.games.length, 0); assert.equal(b.players.length, 0);
  assert.equal(b.allTime[0].slug, 'doom'); assert.equal(b.allTime[0].secs, 60);
  assert.ok(ns.store.has('pw:' + wk + ':' + nick('a')), 'last week was saved when the week turned');
});

await t('boards survive a restart once flushed', async () => {
  const ns = fakeNamespace(), env = { GAME_STATS: ns };
  await play(env, sid(1), 'doom', 90, { pid: nick('a'), name: 'Wanjiku' });
  await ns.obj.alarm();
  const fresh = fakeNamespace(ns.store);
  const b = await board({ GAME_STATS: fresh });
  assert.equal(b.games[0].secs, 90); assert.equal(b.players[0].name, 'Wanjiku'); assert.equal(b.sessions[0].secs, 90);
});

await t('the Worker\'s game list matches the directory', async () => {
  const require = createRequire(import.meta.url);
  const site = require('../../assets/js/games-data.js').GAMES.map(g => g.slug);
  assert.deepEqual([...GAME_SLUGS].sort(), [...site].sort());
});

console.log('\nSign in with Google');

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = s => Buffer.from(s).toString('base64url');
async function token(claims) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'client-123', sub: '1100', exp: Math.floor(clock / 1000) + 600, given_name: 'Amina', ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + Buffer.from(sig).toString('base64url');
}
const realFetch = globalThis.fetch;
globalThis.fetch = async u => (String(u).includes('googleapis.com/oauth2/v3/certs')
  ? new Response(JSON.stringify({ keys: [jwk] })) : realFetch(u));
_resetJwksCache();
const genv = () => ({ GAME_STATS: fakeNamespace(), GOOGLE_CLIENT_ID: 'client-123', GAMES_SECRET: 's3cret' });

await t('a valid Google token gives a stable signed player id and a name suggestion', async () => {
  const env = genv();
  const a = await call(env, '/games/login', { credential: await token({}) });
  const b = await call(env, '/games/login', { credential: await token({}) });
  assert.equal(a.status, 200); assert.match(a.body.pid, /^g_/); assert.equal(a.body.pid, b.body.pid);
  assert.equal(a.body.name, 'Amina');
  assert.ok(!JSON.stringify(a.body).includes('1100'), 'Google account id is never returned');
  await play(env, sid(1), 'doom', 60, { pid: a.body.pid, sig: a.body.sig, name: 'Amina' });
  const p = (await board(env)).players[0];
  assert.equal(p.verified, true); assert.equal(p.secs, 60);
});

await t('tokens for another app, expired or tampered tokens are refused', async () => {
  const env = genv();
  assert.equal((await call(env, '/games/login', { credential: await token({ aud: 'someone-else' }) })).status, 401);
  assert.equal((await call(env, '/games/login', { credential: await token({ exp: Math.floor(clock / 1000) - 5 }) })).status, 401);
  const tok = await token({}); const [h, , s] = tok.split('.');
  const forged = h + '.' + b64u(JSON.stringify({ iss: 'accounts.google.com', aud: 'client-123', sub: '999', exp: Math.floor(clock / 1000) + 600 })) + '.' + s;
  assert.equal((await call(env, '/games/login', { credential: forged })).status, 401);
  assert.equal((await call(env, '/games/login', { credential: 'junk' })).status, 401);
});

await t('without the client id and secret, Google sign-in is switched off', async () => {
  assert.equal((await call({ GAME_STATS: fakeNamespace() }, '/games/login', { credential: 'x' })).status, 503);
});

globalThis.fetch = realFetch;
Date.now = realNow;
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
