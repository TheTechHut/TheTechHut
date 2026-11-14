/**
 * Community events: the list on /events/, read from two places.
 *
 *   1. Luma. The Tech Hut hosts on luma.com/user/TheTechHut, and Luma's public
 *      profile API lists those events with no key. The Durable Object fetches
 *      upcoming and past events and keeps them for LUMA_TTL, so the page never
 *      waits on Luma and a Luma outage only means a slightly stale list.
 *   2. Events posted by the team on the page itself. Sign-in reuses the
 *      marketplace's magic links (market.js sign/unsign, same MARKET_SECRET,
 *      but its own token kinds, so a marketplace session cannot post events).
 *      Only addresses in EVENTS_ADMINS (default info@thetechhut.co) are sent
 *      a link; anyone else gets the same "check your inbox" reply and no
 *      email, so the form does not reveal who the admins are.
 *
 * Routes (handled by handleEvents, mounted at /events/ in index.js):
 *   GET  /events/list        everything, upcoming first; cached 5 min at the edge
 *   POST /events/login       { email, website? }  send a sign-in link
 *   POST /events/session     { t }                link token -> session
 *   POST /events/save        { session, event }   add or update (id to update)
 *   POST /events/delete      { session, id }
 *
 * Secrets: MARKET_SECRET (shared with the marketplace), BREVO_API_KEY,
 * BREVO_SENDER_EMAIL. Optional var: EVENTS_ADMINS, comma-separated emails.
 */
import { sign, unsign } from './market.js';
import { LIMITS, guard, emailDomainOk, sha256Hex } from './payguard.js';

const SITE = 'https://thetechhut.co';
const PAGE = SITE + '/events/';
const BREVO = 'https://api.brevo.com/v3';
const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const LINK_TTL = 20 * MIN;
const SESSION_TTL = 60 * DAY;

export const LUMA_USER = 'usr-Fg72wli77pCKHmM';     // luma.com/user/TheTechHut
const LUMA_API = 'https://api.luma.com/user/profile/events-hosting';
export const LUMA_TTL = 6 * 60 * MIN;

export const adminEmails = (env) =>
  String(env.EVENTS_ADMINS || 'info@thetechhut.co').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

/* ------------------------------------------------------------------ input */

function text(s, max) {
  if (typeof s !== 'string') return '';
  return s.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
const httpsUrl = (s) => (typeof s === 'string' && /^https:\/\/[^\s"'<>]{5,500}$/.test(s.trim()) ? s.trim() : '');
const isoDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !isNaN(Date.parse(s)) ? s : '');

export function cleanEvent(b) {
  const out = {
    title: text(b.title, 120).replace(/\n/g, ' '),
    desc: text(b.desc, 2000),
    start: isoDate(b.start), end: isoDate(b.end),
    location: text(b.location, 160).replace(/\n/g, ' '),
    url: httpsUrl(b.url), cover: httpsUrl(b.cover),
    price: text(b.price, 40).replace(/\n/g, ' '),
  };
  if (out.title.length < 5) return { error: 'Give the event a title of at least 5 characters.' };
  if (!out.start) return { error: 'Set the date and start time.' };
  if (out.end && Date.parse(out.end) <= Date.parse(out.start)) return { error: 'The end time is before the start.' };
  if (!out.location) return { error: 'Say where it happens: Online, or the venue.' };
  if (!out.url) return { error: 'Add the https:// link where people register or join.' };
  return { event: out };
}

/* ------------------------------------------------------------------- Luma */

/** Luma profile API entries -> our event shape (exported for the tests). */
export function lumaEvents(entries) {
  const out = [];
  for (const it of entries || []) {
    const e = it && it.event;
    if (!e || !e.name || !e.start_at || e.visibility !== 'public') continue;
    const place = e.geo_address_info && (e.geo_address_info.city_state || e.geo_address_info.address)
      ? (e.geo_address_info.city_state || e.geo_address_info.address) : (e.location_type ? 'Online' : '');
    out.push({
      id: 'luma-' + e.api_id, source: 'luma',
      title: String(e.name).slice(0, 120), desc: '',
      start: e.start_at, end: e.end_at || '', timezone: e.timezone || 'Africa/Nairobi',
      location: String(place).slice(0, 160), url: 'https://luma.com/' + e.url,
      cover: typeof e.cover_url === 'string' && e.cover_url.startsWith('https://') ? e.cover_url : '',
      price: '',
    });
  }
  return out;
}

async function lumaFetch() {
  const got = [];
  for (const period of ['future', 'past']) {
    const r = await fetch(LUMA_API + '?pagination_limit=50&period=' + period + '&user_api_id=' + LUMA_USER,
      { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('luma ' + r.status);
    got.push(...lumaEvents((await r.json()).entries));
  }
  return got;
}

/* ---------------------------------------------------------- Durable Object */

export class Events {
  constructor(state, env) { this.state = state; this.env = env || {}; }

  async fetch(req) {
    const st = this.state.storage;
    const b = await req.json().catch(() => ({}));
    const now = Date.now();
    const ok = (o) => Response.json(o);

    switch (b.op) {
      case 'list': {
        let luma = (await st.get('luma')) || { at: 0, events: [] };
        if (now - luma.at > LUMA_TTL) {
          try { luma = { at: now, events: await lumaFetch() }; await st.put('luma', luma); }
          catch (e) { luma.at = now - LUMA_TTL + 15 * MIN; await st.put('luma', luma); }   // stale is fine; retry in 15 min
        }
        const own = [...(await st.list({ prefix: 'e:' })).values()];
        const seen = new Set(own.map((e) => e.url));
        const all = own.concat(luma.events.filter((e) => !seen.has(e.url)));   // a posted copy of a Luma event wins
        all.sort((a, b2) => Date.parse(b2.start) - Date.parse(a.start));
        return ok({ events: all, updated: luma.at });
      }
      case 'save': {
        const id = typeof b.id === 'string' && /^ev[a-z2-9]{10}$/.test(b.id) ? b.id : null;
        if (id && !(await st.get('e:' + id))) return ok({ error: 'That event is gone. Reload the page.' });
        const prev = id ? await st.get('e:' + id) : null;
        const ev = { ...b.event, id: id || 'ev' + rid(10), source: 'hut', timezone: 'Africa/Nairobi',
          created: prev ? prev.created : now, updated: now, by: b.email };
        await st.put('e:' + ev.id, ev);
        return ok({ event: ev });
      }
      case 'delete': {
        await st.delete('e:' + String(b.id || ''));
        return ok({ ok: true });
      }
      case 'nonce': {              // one sign-in per link, like the marketplace
        if (await st.get('n:' + b.n)) return ok({ error: 'used' });
        await st.put('n:' + b.n, now);
        return ok({ ok: true });
      }
      default: return ok({ error: 'bad op' });
    }
  }
}

const rid = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join(''); };
const call = async (env, body) =>
  (await env.EVENTS.get(env.EVENTS.idFromName('v1')).fetch('https://do/', { method: 'POST', body: JSON.stringify(body) })).json();

async function session(env, token, now) {
  const p = await unsign(token, env.MARKET_SECRET, 'es', now);
  return p && adminEmails(env).includes(p.e) ? p.e : null;
}

export function eventsLoginEmail(link) {
  const html = '<div style="font-family:\'Source Sans 3\',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
    + '<p style="font-family:Georgia,serif;font-weight:700;font-size:22px;margin:0 0 18px">The Tech Hut<span style="color:#06D6A0">.</span></p>'
    + '<p style="margin:0 0 6px;font-family:Menlo,monospace;font-size:12px;letter-spacing:1px;color:#046B52">EVENTS</p>'
    + '<p style="font-size:17px">Press the button to sign in and post events on thetechhut.co.</p>'
    + '<p style="margin:24px 0"><a href="' + link + '" style="background:#073B4C;color:#fff;padding:13px 22px;border-radius:3px;text-decoration:none;font-weight:700">Sign in to post events</a></p>'
    + '<p style="font-size:13px;color:#5B6B7B">The link works once, for 20 minutes. If you did not ask for it, ignore this email: nothing happens.</p></div>';
  const text = 'Sign in to post events on thetechhut.co (works once, for 20 minutes):\n\n' + link + '\n\nIf you did not ask for it, ignore this email.\n';
  return { subject: 'Your sign-in link for The Tech Hut events page', html, text };
}

/** Returns a Response for /events/*, or null. */
export async function handleEvents(req, env, url, origin, deps) {
  const { json, allowedOrigins } = deps;
  if (!url.pathname.startsWith('/events/')) return null;
  const route = url.pathname.slice(8);
  const now = Date.now();
  if (!env.EVENTS || !env.MARKET_SECRET) return json({ error: 'The events list is switching on. Try again soon.' }, 503, origin);

  if (req.method === 'GET' && route === 'list') {
    const r = await call(env, { op: 'list' });
    return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', ...deps.cors(origin) } });
  }
  if (req.method !== 'POST') return json({ error: 'not found' }, 404, origin);
  const b = await req.json().catch(() => ({}));
  const ip = req.headers.get('CF-Connecting-IP') || '';

  if (route === 'login') {
    if (!allowedOrigins.includes(origin)) return json({ error: 'forbidden' }, 403, origin);
    if (typeof b.website === 'string' && b.website.trim()) return json({ ok: true }, 200, origin);   // honeypot
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return json({ error: 'Enter a valid email address.' }, 400, origin);
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return json({ error: 'Sign-in emails are switching on. Try again soon.' }, 503, origin);
    const g = await guard(env, { op: 'hit', keys: [
      { k: 'evb:' + ip, limit: LIMITS.ipBurst.limit, window: LIMITS.ipBurst.window },
      { k: 'eve:' + (await sha256Hex(email)), limit: LIMITS.emailDay.limit, window: LIMITS.emailDay.window },
    ] });
    if (g && g.ok === false) return json({ error: 'Too many sign-in emails. Wait a few minutes and try again.' }, 429, origin);
    // Not an admin: same answer, no email, so the form never confirms who runs the page.
    if (!adminEmails(env).includes(email)) return json({ ok: true }, 200, origin);
    if (!(await emailDomainOk(email))) return json({ ok: true }, 200, origin);
    const t = await sign({ k: 'el', e: email, n: rid(16), x: now + LINK_TTL }, env.MARKET_SECRET);
    const mail = eventsLoginEmail(PAGE + '#login=' + t);
    const r = await fetch(BREVO + '/smtp/email', {
      method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: env.BREVO_SENDER_NAME || 'The Tech Hut', email: env.BREVO_SENDER_EMAIL }, to: [{ email }],
        subject: mail.subject, htmlContent: mail.html, textContent: mail.text, tags: ['events-login'] }),
    });
    if (!r.ok) return json({ error: 'Could not send the email. Try again in a minute.' }, 502, origin);
    return json({ ok: true }, 200, origin);
  }

  if (route === 'session') {
    const p = await unsign(b.t, env.MARKET_SECRET, 'el', now);
    if (!p || !adminEmails(env).includes(p.e)) return json({ error: 'That sign-in link has expired or is not valid. Ask for a new one.' }, 400, origin);
    const r = await call(env, { op: 'nonce', n: p.n });
    if (r.error) return json({ error: 'That sign-in link was already used. Ask for a new one.' }, 400, origin);
    return json({ session: await sign({ k: 'es', e: p.e, x: now + SESSION_TTL }, env.MARKET_SECRET), email: p.e }, 200, origin);
  }

  const email = b.session ? await session(env, b.session, now) : null;
  if (!email) return json({ error: 'Sign in first.' }, 401, origin);

  if (route === 'save') {
    const c = cleanEvent(b.event || {});
    if (c.error) return json({ error: c.error }, 400, origin);
    const r = await call(env, { op: 'save', id: b.id, event: c.event, email });
    return json(r, r.error ? 400 : 200, origin);
  }
  if (route === 'delete') {
    await call(env, { op: 'delete', id: String(b.id || '') });
    return json({ ok: true }, 200, origin);
  }
  return json({ error: 'not found' }, 404, origin);
}
