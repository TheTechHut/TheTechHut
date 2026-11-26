/**
 * Tests for edgeCached (src/market.js): public JSON kept in Cloudflare's edge
 * cache on the custom domain, with CORS added per request.
 *   npm test
 */
import { edgeCached } from '../src/market.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); fail++; }
}
const store = new Map();
globalThis.caches = { default: {
  match: async (req) => store.has(req.url) ? store.get(req.url).clone() : undefined,
  put: async (req, res) => { store.set(req.url, res.clone()); },
} };
const deps = {
  cors: (o) => ({ 'Access-Control-Allow-Origin': o }),
  json: (b, s, o) => new Response(JSON.stringify(b), { status: s, headers: { 'Access-Control-Allow-Origin': o } }),
};
let made = 0;
const produce = async () => { made++; return JSON.stringify({ n: made }); };
const req = { method: 'GET' };

await t('first request produces and stores', async () => {
  const r = await edgeCached(req, new URL('https://api.thetechhut.co/market/prompts'), 'https://thetechhut.co', deps, 60, produce);
  assert.strictEqual(r.headers.get('X-Edge-Cache'), 'MISS');
  assert.deepStrictEqual(await r.json(), { n: 1 });
});
await t('second request is served from the cache, with this caller\'s CORS', async () => {
  const r = await edgeCached(req, new URL('https://api.thetechhut.co/market/prompts'), 'https://www.thetechhut.co', deps, 60, produce);
  assert.strictEqual(r.headers.get('X-Edge-Cache'), 'HIT');
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), 'https://www.thetechhut.co');
  assert.deepStrictEqual(await r.json(), { n: 1 });
  assert.strictEqual(made, 1);
});
await t('the cached copy carries no CORS header of its own', async () => {
  assert.strictEqual(store.get('https://api.thetechhut.co/market/prompts').headers.get('Access-Control-Allow-Origin'), null);
});
await t('fresh skips the cache and replaces it for everyone', async () => {
  const r = await edgeCached(req, new URL('https://api.thetechhut.co/market/prompts?fresh=123'), 'https://thetechhut.co', deps, 60, produce);
  assert.deepStrictEqual(await r.json(), { n: 2 });
  const again = await edgeCached(req, new URL('https://api.thetechhut.co/market/prompts'), 'https://thetechhut.co', deps, 60, produce);
  assert.deepStrictEqual(await again.json(), { n: 2 });
});
await t('not found is answered and never cached', async () => {
  const r = await edgeCached(req, new URL('https://api.thetechhut.co/market/prompt?id=zzzzzz'), 'https://thetechhut.co', deps, 60,
    async () => null, () => deps.json({ error: 'gone' }, 404, 'https://thetechhut.co'));
  assert.strictEqual(r.status, 404);
  assert.ok(!store.has('https://api.thetechhut.co/market/prompt?id=zzzzzz'));
});
await t('without the Cache API (workers.dev) it just produces', async () => {
  const saved = globalThis.caches; globalThis.caches = undefined;
  try {
    const r = await edgeCached(req, new URL('https://x.workers.dev/market/prompts'), 'https://thetechhut.co', deps, 60, produce);
    assert.strictEqual(r.headers.get('X-Edge-Cache'), 'MISS');
  } finally { globalThis.caches = saved; }
});
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
