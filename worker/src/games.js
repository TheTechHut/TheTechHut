/**
 * Live player count and total visits for thetechhut.co/games/.
 *
 * One Durable Object (GameStats, named "games") holds both numbers, so every
 * visitor sees the same count wherever Cloudflare serves them from.
 *
 *   POST /games/ping   { sid, visit? }  -> { live, visits }
 *   POST /games/leave  { sid }          -> { live, visits }   (sent by sendBeacon on pagehide)
 *
 * sid is a random id the page keeps in sessionStorage, so one tab is one
 * visitor however many games it opens. The page pings every 30 seconds while
 * it is visible; "live" is the number of ids heard from in the last 75.
 * visit:true is sent with the first ping of a tab's session and adds one to
 * the total. Nothing about the visitor is stored: live ids are held in memory
 * only, and the only thing written to storage is the visit count.
 *
 * Bodies are sent as text/plain so the browser skips the CORS preflight,
 * which halves the requests a heartbeat costs.
 */

export const LIVE_MS = 75 * 1000;
const HOUR = 60 * 60 * 1000;
const VISITS_PER_IP_PER_HOUR = 30;   // a whole office on one IP still counts; a script looping does not
const MAX_LIVE = 50000;              // memory guard

export class GameStats {
  constructor(state) {
    this.state = state;
    this.seen = new Map();      // sid -> last ping (ms)
    this.counted = new Set();   // sids whose visit is already counted
    this.perIp = new Map();     // ip -> { start, n }, new visits from that IP this hour
    this.visits = null;
  }

  prune(now) {
    for (const [sid, t] of this.seen) if (now - t > LIVE_MS) this.seen.delete(sid);
    if (this.perIp.size > 10000) for (const [ip, w] of this.perIp) if (now - w.start > HOUR) this.perIp.delete(ip);
    if (this.counted.size > 100000) this.counted.clear();
  }

  async fetch(req) {
    const now = Date.now();
    let b = {};
    try { b = await req.json(); } catch (e) { /* empty body */ }
    if (this.visits === null) this.visits = (await this.state.storage.get('visits')) || 0;

    const sid = typeof b.sid === 'string' ? b.sid : '';
    if (b.op === 'leave') {
      this.seen.delete(sid);
    } else if (b.op === 'ping' && sid) {
      if (b.visit && !this.counted.has(sid)) {
        let w = this.perIp.get(b.ip || '');
        if (!w || now - w.start > HOUR) w = { start: now, n: 0 };
        if (w.n < VISITS_PER_IP_PER_HOUR) {
          w.n++;
          this.visits++;
          this.counted.add(sid);
          await this.state.storage.put('visits', this.visits);
        }
        this.perIp.set(b.ip || '', w);
      }
      if (this.seen.has(sid) || this.seen.size < MAX_LIVE) this.seen.set(sid, now);
    }
    this.prune(now);
    return new Response(JSON.stringify({ live: this.seen.size, visits: this.visits }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

const SID = /^[A-Za-z0-9_-]{16,64}$/;

export async function handleGames(req, env, url, origin, { json, allowedOrigins }) {
  // Only count visitors to our own pages.
  if (!allowedOrigins.includes(origin)) return json({ error: 'forbidden' }, 403, origin);
  if (!env.GAME_STATS) return json({ error: 'not configured' }, 503, origin);

  let body = {};
  try { body = JSON.parse((await req.text()) || '{}'); } catch (e) { return json({ error: 'bad json' }, 400, origin); }
  const sid = typeof body.sid === 'string' ? body.sid : '';
  if (!SID.test(sid)) return json({ error: 'bad sid' }, 400, origin);

  const op = url.pathname === '/games/leave' ? 'leave' : 'ping';
  const stub = env.GAME_STATS.get(env.GAME_STATS.idFromName('games'));
  const r = await stub.fetch('https://game-stats/' + op, {
    method: 'POST',
    body: JSON.stringify({ op, sid, visit: body.visit === true, ip: req.headers.get('CF-Connecting-IP') || '' }),
  });
  const data = await r.json();
  return json({ live: data.live, visits: data.visits }, 200, origin);
}
