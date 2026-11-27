/**
 * Tests for prompt media (src/market.js): example images uploaded to R2 and
 * served from /market/media/, and a YouTube link, both shown with the prompt.
 *   npm test
 */
import worker, { Market } from '../src/index.js';
import { sniffImage, cleanMedia, youtubeId, MEDIA_MAX } from '../src/market.js';
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
function fakeR2() {
  const m = new Map();
  return {
    m,
    put: async (k, v, o) => { m.set(k, { bytes: new Uint8Array(v), o }); },
    head: async (k) => (m.has(k) ? { key: k } : null),
    get: async (k) => (m.has(k) ? { body: m.get(k).bytes, httpEtag: '"e"' } : null),
    delete: async (k) => { for (const x of [].concat(k)) m.delete(x); },
  };
}
const SITE = 'https://thetechhut.co';
let mails = [];
globalThis.caches = undefined;
globalThis.fetch = async (u, init = {}) => {
  u = String(u);
  if (u.startsWith('https://api.brevo.com')) { mails.push(JSON.parse(init.body)); return new Response('{"messageId":"x"}', { status: 201 }); }
  if (u.startsWith('https://cloudflare-dns.com')) return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: '10 mx.example.com.' }] }));
  throw new Error('unexpected fetch ' + u);
};
const env = () => ({ MARKET: ns(), MEDIA: fakeR2(), MARKET_SECRET: 'test-secret-0123456789', PAYSTACK_SECRET_KEY: 'sk_test_x', BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'hi@thetechhut.co' });
const post = (path, body) => new Request('https://api.test' + path, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify(body) });
const call = async (e, path, body) => { const r = await worker.fetch(post(path, body), e); return { status: r.status, body: await r.json() }; };
async function signIn(e, email) {
  mails = [];
  await call(e, '/market/login', { email });
  const link = mails[0].htmlContent.match(/#login=([A-Za-z0-9._-]+)/)[1];
  return (await call(e, '/market/session', { t: link })).body;
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2]);
async function upload(e, session, bytes, origin = SITE, name = 'x.png') {
  const fd = new FormData();
  fd.set('session', session || '');
  fd.set('file', new Blob([bytes]), name);
  const r = await worker.fetch(new Request('https://api.test/market/upload', { method: 'POST', headers: { Origin: origin }, body: fd }), e);
  return { status: r.status, body: await r.json() };
}
const PROMPT = { title: 'Story shorts in a cartoon style', desc: 'Turns any story into an animated short drawn in code.', cat: 'video', model: 'claude',
  preview: 'Turn any story...', body: 'You are an animation director. Ask me for the story, the length and the voice, then build it.' };

console.log('helpers');
await t('images are recognised by their bytes, not their name', async () => {
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(JPG), 'jpg');
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a......')), null);
});
await t('YouTube links in every common shape give the video id', async () => {
  for (const s of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ']) assert.equal(youtubeId(s), 'dQw4w9WgXcQ', s);
  for (const s of ['https://vimeo.com/123', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://youtube.com/watch?v=short', '']) assert.equal(youtubeId(s), '', s);
});
await t('only the seller\'s own, well-formed keys are kept, at most three', async () => {
  const k = (u, n) => 'm/' + u + '/' + n.repeat(16) + '.png';
  const list = [k('abcdefgh', 'a'), k('zzzzzzzz', 'b'), '../../etc', k('abcdefgh', 'a'), k('abcdefgh', 'c'), k('abcdefgh', 'd'), k('abcdefgh', 'e')];
  assert.deepEqual(cleanMedia(list, 'abcdefgh'), [k('abcdefgh', 'a'), k('abcdefgh', 'c'), k('abcdefgh', 'd')]);
  assert.equal(MEDIA_MAX, 3);
});

console.log('upload, save and serve');
await t('a signed-in seller uploads an image, saves it with a YouTube link, and everyone sees both', async () => {
  const e = env();
  const a = await signIn(e, 'seller@example.com');
  const up = await upload(e, a.session, PNG);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.ok(up.body.key.startsWith('m/' + a.user.id + '/') && up.body.key.endsWith('.png'));
  const s = await call(e, '/market/save', { session: a.session, ...PROMPT, media: [up.body.key], youtube: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const one = await (await worker.fetch(new Request('https://api.test/market/prompt?id=' + s.body.prompt.id, { headers: { Origin: SITE } }), e)).json();
  assert.deepEqual(one.prompt.media, [up.body.key]);
  assert.equal(one.prompt.yt, 'dQw4w9WgXcQ');
  const img = await worker.fetch(new Request('https://api.test/market/media/' + up.body.key), e);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('Content-Type'), 'image/png');
  assert.equal(img.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.ok(/immutable/.test(img.headers.get('Cache-Control')));
});
await t('uploads need a session, an allowed site and a real image', async () => {
  const e = env();
  const a = await signIn(e, 'seller@example.com');
  assert.equal((await upload(e, 'junk', PNG)).status, 401);
  assert.equal((await upload(e, a.session, PNG, 'https://evil.example')).status, 403);
  assert.equal((await upload(e, a.session, new TextEncoder().encode('<svg onload=alert(1)>'), SITE, 'x.png')).status, 415);
  assert.equal((await upload(e, a.session, new Uint8Array(3 * 1024 * 1024 + 10).fill(0xff))).status, 413);
});
await t('another member\'s image, or one never uploaded, is dropped on save', async () => {
  const e = env();
  const a = await signIn(e, 'a@example.com');
  const b = await signIn(e, 'b@example.com');
  const theirs = (await upload(e, b.session, PNG)).body.key;
  const ghost = 'm/' + a.user.id + '/' + 'k'.repeat(16) + '.jpg';
  const s = await call(e, '/market/save', { session: a.session, ...PROMPT, media: [theirs, ghost] });
  assert.deepEqual(s.body.prompt.media, []);
});
await t('a bad YouTube link is refused with a clear message', async () => {
  const e = env();
  const a = await signIn(e, 'seller@example.com');
  const s = await call(e, '/market/save', { session: a.session, ...PROMPT, youtube: 'https://vimeo.com/123' });
  assert.equal(s.status, 400);
  assert.ok(/YouTube/.test(s.body.error));
});
await t('images removed from a prompt, or with an unsold prompt, are deleted from storage', async () => {
  const e = env();
  const a = await signIn(e, 'seller@example.com');
  const k1 = (await upload(e, a.session, PNG)).body.key, k2 = (await upload(e, a.session, JPG)).body.key;
  const s = await call(e, '/market/save', { session: a.session, ...PROMPT, media: [k1, k2] });
  await call(e, '/market/save', { session: a.session, id: s.body.prompt.id, ...PROMPT, media: [k2] });
  assert.ok(!e.MEDIA.m.has(k1) && e.MEDIA.m.has(k2));
  await call(e, '/market/delete', { session: a.session, id: s.body.prompt.id });
  assert.ok(!e.MEDIA.m.has(k2));
});
await t('a missing or malformed media key is a plain 404', async () => {
  const e = env();
  for (const k of ['m/abcdefgh/' + 'a'.repeat(16) + '.png', '../secret', 'm/x/y.svg']) {
    const r = await worker.fetch(new Request('https://api.test/market/media/' + k), e);
    assert.equal(r.status, 404, k);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
