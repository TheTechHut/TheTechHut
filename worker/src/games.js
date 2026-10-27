/**
 * The games arcade: live counts, visits and play-time leaderboards for
 * thetechhut.co/games/.
 *
 * One Durable Object (GameStats, named "games") holds everything, so every
 * visitor sees the same numbers wherever Cloudflare serves them from.
 *
 *   POST /games/ping   { sid, visit?, slug?, pid?, sig?, name? } -> { live, visits, me?, nameOk? }
 *   POST /games/leave  { sid }                                   -> { live, visits }
 *   GET  /games/board                                            -> this week's leaderboards
 *   POST /games/login  { credential }                            -> { pid, sig, name }  (Sign in with Google)
 *   POST /games/forget { pid, sig? }                             -> { ok }               (leave the boards)
 *
 * How play time is counted
 *   The game player page (/games/play/?g=<slug>) pings every 30 seconds while
 *   it is on screen. Each ping adds the time since that tab's last ping for
 *   the same game, capped at 35 seconds, so a tab left in the background or
 *   a closed laptop adds nothing. A player's time is counted once however
 *   many tabs they open, and one IP address can earn time in at most six
 *   tabs at once. Boards reset every Monday at 00:00 Nairobi time.
 *
 * Who is on the boards
 *   Nobody, unless they choose to be. A visitor either picks a nickname (a
 *   random player id is kept in their browser) or signs in with Google. For
 *   Google players we keep a scrambled id derived from Google's account id,
 *   never the email or name, and show a tick next to the nickname they chose.
 *
 * What is stored
 *   Visit total; per game: play time and plays (this week and all time); per
 *   named player: nickname, play time per game this week, best session and the
 *   days played. Live tab ids are held in memory only. Writes are batched and
 *   flushed once a minute, which keeps the Durable Object inside the free plan.
 *
 * Bodies are sent as text/plain so the browser skips the CORS preflight.
 */

import { GAME_SLUGS } from './game-slugs.js';

export const LIVE_MS = 75 * 1000;
export const MAX_STEP_MS = 35 * 1000;          // most time one ping can add
const HOUR = 60 * 60 * 1000;
const VISITS_PER_IP_PER_HOUR = 30;
const ACCRUING_TABS_PER_IP = 6;
const MAX_LIVE = 50000;
const FLUSH_MS = 60 * 1000;
const TOP_SESSIONS = 10;
const SLUGS = new Set(GAME_SLUGS);

/** ISO week in Nairobi time (UTC+3, no daylight saving), e.g. "2026-W44". */
export function weekOf(ms) {
  const d = new Date(ms + 3 * HOUR);
  const day = (d.getUTCDay() + 6) % 7;                 // Monday = 0
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((thu - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return thu.getUTCFullYear() + '-W' + String(wk).padStart(2, '0');
}
const dayOf = ms => new Date(ms + 3 * HOUR).getUTCDay();   // 0 = Sunday, Nairobi time

// A short list of words that keep a nickname off a public board. Matching is on
// the nickname with spaces, dots and digits removed, so "f.u.c.k" is caught too.
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'porn', 'pussy', 'dick', 'bitch', 'whore',
  'slut', 'hitler', 'nazi', 'kuma', 'malaya', 'msenge', 'shoga', 'mavi', 'matako', 'mkundu', 'admin', 'thetechhut'];

export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 20) return null;
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(n)) return null;
  const flat = n.toLowerCase().replace(/[\s._'\-0-9]/g, '');
  if (!flat || BLOCKED.some(w => flat.includes(w))) return null;
  return n;
}

const r1 = x => Math.round(x * 10) / 10;
function shortHash(str) {                                     // FNV-1a, enough to tell sessions apart
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export class GameStats {
  constructor(state) {
    this.state = state;
    this.seen = new Map();      // sid -> { t, slug, ip, pid }
    this.counted = new Set();   // sids whose visit is counted
    this.played = new Set();    // "sid|slug" already counted as a play
    this.perIp = new Map();     // ip -> { start, n } visits this hour
    this.pidLast = new Map();   // pid -> last time play time was credited
    this.ipTabs = new Map();    // ip -> Map(sid -> last credit), tabs earning time
    this.sessions = new Map();  // "sid|slug" -> { pid, n, v, slug, s }
    this.visits = null;
    this.week = null;
    this.gw = {}; this.ga = {}; this.top = []; this.pw = new Map();
    this.dirty = { visits: false, gw: false, ga: false, top: false, pids: new Set() };
  }

  async load(now) {
    const st = this.state.storage;
    if (this.visits === null) {
      this.visits = (await st.get('visits')) || 0;
      this.ga = (await st.get('ga')) || {};
    }
    const wk = weekOf(now);
    if (wk === this.week) return;
    if (this.week) await this.flush();                // close the old week first
    this.week = wk;
    // Keep 12 months of weekly player records (see the privacy policy).
    const old = await st.list({ prefix: 'pw:', end: 'pw:' + weekOf(now - 365 * 86400000) });
    if (old.size) await st.delete([...old.keys()]);
    this.gw = (await st.get('gw:' + wk)) || {};
    this.top = (await st.get('top:' + wk)) || [];
    this.pw = new Map();
    const rows = await st.list({ prefix: 'pw:' + wk + ':' });
    for (const [k, v] of rows) this.pw.set(k.slice(('pw:' + wk + ':').length), v);
    this.sessions.clear(); this.played.clear(); this.pidLast.clear();
  }

  markDirty(key, pid) {
    if (pid) this.dirty.pids.add(pid); else this.dirty[key] = true;
    if (!this.alarmSet) { this.alarmSet = true; this.state.storage.setAlarm(Date.now() + FLUSH_MS); }
  }

  async flush() {
    const st = this.state.storage, d = this.dirty, wk = this.week, puts = {};
    if (d.visits) puts.visits = this.visits;
    if (d.ga) puts.ga = this.ga;
    if (d.gw && wk) puts['gw:' + wk] = this.gw;
    if (d.top && wk) puts['top:' + wk] = this.top;
    for (const pid of d.pids) { const p = this.pw.get(pid); if (p && wk) puts['pw:' + wk + ':' + pid] = p; }
    this.dirty = { visits: false, gw: false, ga: false, top: false, pids: new Set() };
    if (Object.keys(puts).length) await st.put(puts);
  }

  async alarm() { this.alarmSet = false; await this.flush(); }

  prune(now) {
    for (const [sid, s] of this.seen) if (now - s.t > LIVE_MS) this.seen.delete(sid);
    if (this.perIp.size > 10000) for (const [ip, w] of this.perIp) if (now - w.start > HOUR) this.perIp.delete(ip);
    if (this.counted.size > 100000) this.counted.clear();
    if (this.played.size > 100000) this.played.clear();
    if (this.ipTabs.size > 10000) for (const [ip, m] of this.ipTabs) { for (const [id, at] of m) if (now - at > LIVE_MS) m.delete(id); if (!m.size) this.ipTabs.delete(ip); }
    if (this.sessions.size > 20000) for (const [k] of this.sessions) { if (!this.seen.has(k.split('|')[0])) this.sessions.delete(k); }
  }

  liveBySlug() {
    const out = {};
    for (const s of this.seen.values()) if (s.slug) out[s.slug] = (out[s.slug] || 0) + 1;
    return out;
  }

  me(pid) {
    const p = this.pw.get(pid);
    if (!p) return null;
    const ranked = [...this.pw.values()].filter(x => x.s >= 1).sort((a, b) => b.s - a.s);
    return { name: p.n, verified: !!p.v, secs: Math.round(p.s), games: Object.keys(p.g).length, best: Math.round(p.b || 0),
             days: (p.d || []).length, rank: ranked.indexOf(p) + 1 || null, players: ranked.length,
             played: Object.keys(p.g) };
  }

  credit(now, sid, slug, ip, who) {
    const prev = this.seen.get(sid);
    const key = sid + '|' + slug;
    if (!this.played.has(key)) {                                  // a new play of this game in this tab
      this.played.add(key);
      for (const g of [this.gw, this.ga]) { g[slug] = g[slug] || { s: 0, p: 0 }; g[slug].p++; }
      this.markDirty('gw'); this.markDirty('ga');
    }
    if (!prev || prev.slug !== slug) return;                     // time starts with the second ping
    // At most six tabs per IP earn time at once; the first six to start keep their place.
    let tabs = this.ipTabs.get(ip);
    if (!tabs) { tabs = new Map(); this.ipTabs.set(ip, tabs); }
    for (const [id, at] of tabs) if (now - at > LIVE_MS) tabs.delete(id);
    if (!tabs.has(sid) && tabs.size >= ACCRUING_TABS_PER_IP) return;
    tabs.set(sid, now);
    const dt = Math.min(now - prev.t, MAX_STEP_MS) / 1000;
    if (dt <= 0) return;
    this.gw[slug].s += dt; this.ga[slug].s += dt;

    const sess = this.sessions.get(key) || { s: 0, slug };
    sess.s += dt;
    if (who) { sess.pid = who.pid; sess.n = who.name; sess.v = who.v; }
    this.sessions.set(key, sess);
    this.updateTop(key, sess);

    if (who) {
      const pdt = Math.min(dt, (now - (this.pidLast.get(who.pid) || 0)) / 1000);   // many tabs count once
      this.pidLast.set(who.pid, now);
      const p = this.pw.get(who.pid) || { n: who.name, v: who.v, s: 0, g: {}, b: 0, d: [] };
      p.n = who.name; p.v = who.v;
      if (pdt > 0) {
        p.s = r1(p.s + pdt);
        p.g[slug] = r1((p.g[slug] || 0) + pdt);
        p.b = Math.max(p.b || 0, r1(sess.s));
        const day = dayOf(now);
        if (!p.d.includes(day)) p.d.push(day);
      }
      this.pw.set(who.pid, p);
      this.markDirty(null, who.pid);
    }
  }

  updateTop(key, sess) {
    if (!sess.pid) return;                                       // only named players on the session board
    const id = shortHash(key);                                   // not the tab id itself
    const i = this.top.findIndex(t => t.k === id);
    const row = { k: id, p: sess.pid, n: sess.n, v: !!sess.v, slug: sess.slug, s: r1(sess.s) };
    if (i >= 0) this.top[i] = row;
    else if (this.top.length < TOP_SESSIONS || row.s > this.top[this.top.length - 1].s) this.top.push(row);
    else return;
    this.top.sort((a, b) => b.s - a.s);
    this.top = this.top.slice(0, TOP_SESSIONS);
    this.markDirty('top');
  }

  board() {
    const live = this.liveBySlug();
    const games = Object.entries(this.gw).map(([slug, g]) => ({ slug, secs: Math.round(g.s), plays: g.p, live: live[slug] || 0 }))
      .sort((a, b) => b.secs - a.secs || b.plays - a.plays);
    const allTime = Object.entries(this.ga).map(([slug, g]) => ({ slug, secs: Math.round(g.s), plays: g.p }))
      .sort((a, b) => b.secs - a.secs).slice(0, 10);
    const players = [...this.pw.values()].filter(p => p.s >= 1).sort((a, b) => b.s - a.s).slice(0, 20)
      .map(p => ({ name: p.n, verified: !!p.v, secs: Math.round(p.s),
                   top: Object.entries(p.g).sort((a, b) => b[1] - a[1])[0]?.[0] || null }));
    const sessions = this.top.map(t => ({ name: t.n, verified: t.v, slug: t.slug, secs: Math.round(t.s) }));
    return { week: this.week, live: this.seen.size, visits: this.visits, liveBySlug: live, games, allTime, players, sessions };
  }

  async fetch(req) {
    const now = Date.now();
    let b = {};
    try { b = await req.json(); } catch (e) { /* GET */ }
    await this.load(now);
    const op = b.op || new URL(req.url).pathname.slice(1);
    const sid = typeof b.sid === 'string' ? b.sid : '';
    const out = {};

    if (op === 'board') {
      this.prune(now);
      return Response.json(this.board());
    }
    if (op === 'forget') {
      if (b.pid) {
        // Every week's record for this player, not only this week's.
        const mine = [...(await this.state.storage.list({ prefix: 'pw:' })).keys()].filter(k => k.endsWith(':' + b.pid));
        if (mine.length) await this.state.storage.delete(mine);
        this.pw.delete(b.pid); this.dirty.pids.delete(b.pid);
        this.top = this.top.filter(t => t.p !== b.pid);
        for (const s of this.sessions.values()) if (s.pid === b.pid) s.pid = null;
        this.pidLast.delete(b.pid);
        this.markDirty('top');
      }
      return Response.json({ ok: true });
    }
    if (op === 'leave') {
      this.seen.delete(sid);
    } else if (op === 'ping' && sid) {
      if (b.visit && !this.counted.has(sid)) {
        let w = this.perIp.get(b.ip || '');
        if (!w || now - w.start > HOUR) w = { start: now, n: 0 };
        if (w.n < VISITS_PER_IP_PER_HOUR) { w.n++; this.visits++; this.counted.add(sid); this.markDirty('visits'); }
        this.perIp.set(b.ip || '', w);
      }
      const slug = SLUGS.has(b.slug) ? b.slug : null;
      const who = b.who || null;
      if (slug) this.credit(now, sid, slug, b.ip || '', who);
      if (this.seen.has(sid) || this.seen.size < MAX_LIVE) this.seen.set(sid, { t: now, slug, ip: b.ip || '', pid: who && who.pid });
      if (who) out.me = this.me(who.pid) || { name: who.name, verified: !!who.v, secs: 0, games: 0, best: 0, days: 0, rank: null, players: this.pw.size, played: [] };
      if (slug) out.playing = this.liveBySlug()[slug] || 1;
    }
    this.prune(now);
    return Response.json({ live: this.seen.size, visits: this.visits, ...out });
  }
}

/* ------------------------------------------------------------------ worker side */

const SID = /^[A-Za-z0-9_-]{16,64}$/;
const NICK_PID = /^n_[A-Za-z0-9_-]{20,40}$/;
const GOOGLE_PID = /^g_[A-Za-z0-9_-]{22}$/;
const enc = new TextEncoder();

function b64url(buf) {
  let s = ''; const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg))).slice(0, 32);
}

let JWKS = null, JWKS_AT = 0;
async function googleKeys() {
  if (JWKS && Date.now() - JWKS_AT < 6 * HOUR) return JWKS;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('jwks');
  JWKS = (await r.json()).keys || []; JWKS_AT = Date.now();
  return JWKS;
}
export function _resetJwksCache() { JWKS = null; JWKS_AT = 0; }

/** Verify a Google Identity Services ID token; returns its payload or null. */
export async function verifyGoogleToken(token, clientId) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))); payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))); }
  catch (e) { return null; }
  if (header.alg !== 'RS256') return null;
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  if (payload.aud !== clientId) return null;
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') return null;
  if (!(payload.exp * 1000 > Date.now())) return null;
  if (!payload.sub) return null;
  return payload;
}

async function identity(body, env) {
  const name = cleanName(body.name);
  const pid = typeof body.pid === 'string' ? body.pid : '';
  if (!pid) return { who: null };
  if (!name) return { who: null, nameOk: false };
  if (NICK_PID.test(pid)) return { who: { pid, name, v: false } };
  if (GOOGLE_PID.test(pid) && env.GAMES_SECRET && body.sig === await hmac(env.GAMES_SECRET, pid)) return { who: { pid, name, v: true } };
  return { who: null, badId: true };
}

const stubOf = env => env.GAME_STATS.get(env.GAME_STATS.idFromName('games'));

export async function handleGames(req, env, url, origin, { json, allowedOrigins }) {
  if (!env.GAME_STATS) return json({ error: 'not configured' }, 503, origin);

  // The leaderboards are public and cached for 20 seconds at the edge.
  if (req.method === 'GET' && url.pathname === '/games/board') {
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const ck = new Request('https://game-stats/board');
    if (cache) { const hit = await cache.match(ck); if (hit) return json(await hit.json(), 200, origin); }
    const data = await (await stubOf(env).fetch('https://game-stats/board')).json();
    if (cache) await cache.put(ck, new Response(JSON.stringify(data), { headers: { 'Cache-Control': 'max-age=20' } }));
    return json(data, 200, origin);
  }

  if (!allowedOrigins.includes(origin)) return json({ error: 'forbidden' }, 403, origin);
  let body = {};
  try { body = JSON.parse((await req.text()) || '{}'); } catch (e) { return json({ error: 'bad json' }, 400, origin); }

  if (url.pathname === '/games/login') {
    if (!env.GOOGLE_CLIENT_ID || !env.GAMES_SECRET) return json({ error: 'google sign-in not configured' }, 503, origin);
    let p = null;
    try { p = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID); } catch (e) { return json({ error: 'could not check sign-in' }, 502, origin); }
    if (!p) return json({ error: 'sign-in not valid' }, 401, origin);
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(env.GAMES_SECRET + ':' + p.sub));
    const pid = 'g_' + b64url(digest).slice(0, 22);
    const suggest = cleanName(p.given_name || '') || '';
    return json({ pid, sig: await hmac(env.GAMES_SECRET, pid), name: suggest }, 200, origin);
  }

  if (url.pathname === '/games/forget') {
    const pid = typeof body.pid === 'string' ? body.pid : '';
    const ok = NICK_PID.test(pid) || (GOOGLE_PID.test(pid) && env.GAMES_SECRET && body.sig === await hmac(env.GAMES_SECRET, pid));
    if (!ok) return json({ error: 'bad id' }, 400, origin);
    await stubOf(env).fetch('https://game-stats/forget', { method: 'POST', body: JSON.stringify({ op: 'forget', pid }) });
    return json({ ok: true }, 200, origin);
  }

  const sid = typeof body.sid === 'string' ? body.sid : '';
  if (!SID.test(sid)) return json({ error: 'bad sid' }, 400, origin);
  const op = url.pathname === '/games/leave' ? 'leave' : 'ping';
  const id = op === 'ping' ? await identity(body, env) : { who: null };
  const slug = typeof body.slug === 'string' ? body.slug : null;
  const r = await stubOf(env).fetch('https://game-stats/' + op, {
    method: 'POST',
    body: JSON.stringify({ op, sid, visit: body.visit === true, slug, who: id.who, ip: req.headers.get('CF-Connecting-IP') || '' }),
  });
  const data = await r.json();
  if (id.nameOk === false) data.nameOk = false;
  if (id.badId) data.badId = true;
  return json(data, 200, origin);
}
