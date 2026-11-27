/**
 * The site dashboard: thetechhut.co/admin/ (a private page; robots and an
 * X-Robots-Tag keep it out of search).
 *
 * Sign-in is an email link, like the events page: only addresses in
 * SITE_ADMINS (default: EVENTS_ADMINS, default info@thetechhut.co) are sent
 * one, and anyone else gets the same "check your inbox" answer. Tokens are
 * signed with MARKET_SECRET under their own kinds ('al' link, 'as' session),
 * so a marketplace or events session is never an admin session.
 *
 * Routes (POST, JSON, `session` in the body except for login/session):
 *   /admin/login         { email }                   -> { ok }       email a sign-in link
 *   /admin/session       { t }                       -> { session, email }
 *   /admin/overview      { session }                 -> { market, payments, newsletter, events, games, config }
 *   /admin/prompt        { session, id, action }     -> { ok }       hide | restore | clear (reports)
 *   /admin/resend        { session, uid, pid, who }  -> { ok }       resend a purchase email (buyer | seller)
 *   /admin/event-delete  { session, id }             -> { ok }       remove an event posted on /events/
 *
 * Every section of the overview is read separately, so one failing source
 * (Paystack, Brevo, Luma) shows as an error on its card and the rest load.
 * Site freshness (data files, GitHub Actions, scheduled articles) is read by
 * the page itself from public URLs and needs nothing here.
 */
import { sign, unsign, adminMarket, adminPromptAction, resendPurchaseEmail, sendAnnouncement, announcementStatus, COMMISSION_PERCENT } from './market.js';
import { LIMITS, guard, emailDomainOk, sha256Hex } from './payguard.js';

const SITE = 'https://thetechhut.co';
const PAGE = SITE + '/admin/';
const BREVO = 'https://api.brevo.com/v3';
const PAYSTACK = 'https://api.paystack.co';
const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const LINK_TTL = 20 * MIN;
export const SESSION_TTL = 7 * DAY;

export const siteAdmins = (env) =>
  String(env.SITE_ADMINS || env.EVENTS_ADMINS || 'info@thetechhut.co').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const rid = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join(''); };
const events = (env, body) => env.EVENTS.get(env.EVENTS.idFromName('v1')).fetch('https://do/', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
const settled = async (fn) => { try { return await fn(); } catch (e) { return { error: String((e && e.message) || e).slice(0, 200) }; } };

export function adminLoginEmail(link) {
  const html = '<div style="font-family:\'Source Sans 3\',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
    + '<p style="font-family:Georgia,serif;font-weight:700;font-size:22px;margin:0 0 18px">The Tech Hut<span style="color:#06D6A0">.</span></p>'
    + '<p style="margin:0 0 6px;font-family:Menlo,monospace;font-size:12px;letter-spacing:1px;color:#046B52">SITE DASHBOARD</p>'
    + '<p style="font-size:17px">Press the button to open the site dashboard.</p>'
    + '<p style="margin:24px 0"><a href="' + link + '" style="background:#073B4C;color:#fff;padding:13px 22px;border-radius:3px;text-decoration:none;font-weight:700">Open the dashboard</a></p>'
    + '<p style="font-size:13px;color:#5B6B7B">The link works once, for 20 minutes, and keeps you signed in on that browser for 7 days. If you did not ask for it, someone typed your address on the dashboard: ignore this email and nothing happens.</p></div>';
  const text = 'Open The Tech Hut site dashboard (works once, for 20 minutes):\n\n' + link + '\n\nIf you did not ask for it, ignore this email.\n';
  return { subject: 'Your sign-in link for The Tech Hut dashboard', html, text };
}

/* ------------------------------------------------------------- sections */

function marketSummary(m, now) {
  if (m.error) return m;
  const sales = m.purchases.slice().sort((a, b) => b.at - a.at);
  const since = (d) => (x) => x >= now - d * DAY;
  const revenue = sales.reduce((s, x) => s + x.amount, 0);
  const sellers = {};
  for (const p of m.prompts) {
    if (!p.sales) continue;
    const k = p.seller || '?';
    sellers[k] = sellers[k] || { email: p.seller, name: p.sellerName, sales: 0, revenue: 0, prompts: 0 };
    sellers[k].prompts++;
  }
  for (const s of sales) {
    if (!s.seller || !sellers[s.seller]) continue;
    sellers[s.seller].sales++; sellers[s.seller].revenue += s.amount;
  }
  return {
    totals: {
      members: m.members.length,
      members7: m.members.filter((u) => since(7)(u.created)).length,
      members30: m.members.filter((u) => since(30)(u.created)).length,
      sellers: m.members.filter((u) => u.payout).length,
      prompts: m.prompts.filter((p) => !p.hidden).length,
      paidPrompts: m.prompts.filter((p) => !p.hidden && p.price > 0).length,
      hidden: m.prompts.filter((p) => p.hidden).length,
      reported: m.prompts.filter((p) => p.reports > 0).length,
      sales: sales.length, sales30: sales.filter((s) => since(30)(s.at)).length,
      revenue, revenue30: sales.filter((s) => since(30)(s.at)).reduce((t, x) => t + x.amount, 0),
      commission: Math.round(revenue * COMMISSION_PERCENT) / 100,
      unmailed: sales.filter((s) => !s.mailed || !s.sellerMailed).length,
    },
    members: m.members.sort((a, b) => b.created - a.created).slice(0, 200),
    prompts: m.prompts.sort((a, b) => (b.reports - a.reports) || (b.created - a.created)),
    sales: sales.slice(0, 200),
    topSellers: Object.values(sellers).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}

async function payments(env, now) {
  if (!env.PAYSTACK_SECRET_KEY) return { error: 'PAYSTACK_SECRET_KEY is not set' };
  const get = async (path) => {
    const r = await fetch(PAYSTACK + path, { headers: { Authorization: 'Bearer ' + env.PAYSTACK_SECRET_KEY } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status === false) throw new Error(j.message || 'Paystack HTTP ' + r.status);
    return j.data;
  };
  const from = new Date(now - 30 * DAY).toISOString();
  const [totals, recent] = await Promise.all([get('/transaction/totals'), get('/transaction?status=success&perPage=100&from=' + encodeURIComponent(from))]);
  const label = (t) => { const m = t.metadata || {}; return m.kind === 'market' ? 'Prompt marketplace' : (m.product || 'other'); };
  const byProduct = {};
  for (const t of recent || []) {
    const k = label(t);
    byProduct[k] = byProduct[k] || { product: k, count: 0, kes: 0 };
    byProduct[k].count++; byProduct[k].kes += (t.amount || 0) / 100;
  }
  const kes = (arr) => ((arr || []).find((x) => x.currency === 'KES') || { amount: 0 }).amount / 100;
  return {
    mode: String(env.PAYSTACK_SECRET_KEY).startsWith('sk_live') ? 'live' : 'test',
    allTime: { transactions: totals.total_transactions || 0, kes: kes(totals.total_volume_by_currency), pendingKes: kes(totals.pending_transfers_by_currency) },
    last30: { count: (recent || []).length, kes: (recent || []).reduce((s, t) => s + (t.amount || 0) / 100, 0), capped: (recent || []).length >= 100 },
    byProduct: Object.values(byProduct).sort((a, b) => b.kes - a.kes),
    recent: (recent || []).slice(0, 25).map((t) => ({ ref: t.reference, kes: (t.amount || 0) / 100, at: t.paid_at || t.created_at,
      email: t.customer && t.customer.email, product: label(t), channel: t.channel })),
  };
}

async function newsletter(env) {
  if (!env.BREVO_API_KEY) return { error: 'BREVO_API_KEY is not set' };
  const lists = [['CV Pack', env.BREVO_LIST_ID], ['Daily Savannah', env.BREVO_LIST_ID_DAILY], ['Daily job alert', env.BREVO_LIST_ID_JOBS]];
  const out = await Promise.all(lists.map(async ([name, id]) => {
    if (!id) return { name, error: 'list id not set' };
    const r = await fetch(BREVO + '/contacts/lists/' + encodeURIComponent(id), { headers: { 'api-key': env.BREVO_API_KEY, Accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { name, error: j.message || 'Brevo HTTP ' + r.status };
    return { name, id: Number(id), subscribers: j.uniqueSubscribers != null ? j.uniqueSubscribers : j.totalSubscribers, blacklisted: j.totalBlacklisted || 0 };
  }));
  return { lists: out, total: out.reduce((s, l) => s + (l.subscribers || 0), 0) };
}

async function eventsSummary(env, now) {
  if (!env.EVENTS) return { error: 'EVENTS is not bound' };
  const r = await events(env, { op: 'list' });
  const all = r.events || [];
  const upcoming = all.filter((e) => Date.parse(e.end || e.start) >= now);
  return { upcoming: upcoming.length, past: all.length - upcoming.length, lumaUpdated: r.updated,
    next: upcoming.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 5).map((e) => ({ title: e.title, start: e.start, url: e.url, source: e.source })),
    posted: all.filter((e) => e.source === 'hut').map((e) => ({ id: e.id, title: e.title, start: e.start, by: e.by })) };
}

async function games(env) {
  if (!env.GAME_STATS) return { error: 'GAME_STATS is not bound' };
  const b = await (await env.GAME_STATS.get(env.GAME_STATS.idFromName('games')).fetch('https://game-stats/board')).json();
  const wk = (b.games || []).map((g) => ({ slug: g.slug, plays: g.plays || 0, minutes: Math.round((g.secs || 0) / 60), live: g.live || 0 }));
  return { live: b.live || 0, visits: b.visits || 0, week: b.week, players: (b.players || []).length,
    topPlayers: (b.players || []).slice(0, 5).map((p) => ({ name: p.name, minutes: Math.round((p.secs || 0) / 60), top: p.top })),
    games: wk.slice(0, 10),
    allTime: (b.allTime || []).map((g) => ({ slug: g.slug, plays: g.plays || 0, minutes: Math.round((g.secs || 0) / 60) })) };
}

function config(env) {
  const set = (k) => !!env[k];
  return { paystack: set('PAYSTACK_SECRET_KEY'), market: !!(env.MARKET && env.MARKET_SECRET), events: !!(env.EVENTS && env.MARKET_SECRET),
    brevo: set('BREVO_API_KEY') && set('BREVO_SENDER_EMAIL'), turnstile: set('TURNSTILE_SECRET'), remoteList: set('REMOTE_LIST_KEY'),
    communities: set('COMMUNITIES_URL'), earlyAccess: set('EARLY_ACCESS_INVITE'), gamesSignIn: set('GAMES_SECRET') && !!env.GOOGLE_CLIENT_ID,
    admins: siteAdmins(env).length };
}

/* --------------------------------------------------------------- routes */

/** Returns a Response for /admin/*, or null. */
export async function handleAdmin(req, env, url, origin, deps) {
  const { json, allowedOrigins } = deps;
  if (!url.pathname.startsWith('/admin/')) return null;
  const route = url.pathname.slice(7);
  const now = Date.now();
  if (req.method !== 'POST') return json({ error: 'not found' }, 404, origin);
  if (!allowedOrigins.includes(origin)) return json({ error: 'forbidden' }, 403, origin);
  if (!env.MARKET_SECRET || !env.EVENTS) return json({ error: 'The dashboard needs MARKET_SECRET and the EVENTS object.' }, 503, origin);
  const b = await req.json().catch(() => ({}));
  const ip = req.headers.get('CF-Connecting-IP') || '';

  if (route === 'login') {
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return json({ error: 'Enter a valid email address.' }, 400, origin);
    const g = await guard(env, { op: 'hit', keys: [
      { k: 'adb:' + ip, limit: LIMITS.ipBurst.limit, window: LIMITS.ipBurst.window },
      { k: 'ade:' + (await sha256Hex(email)), limit: LIMITS.emailDay.limit, window: LIMITS.emailDay.window },
    ] });
    if (g && g.ok === false) return json({ error: 'Too many sign-in emails. Wait a few minutes and try again.' }, 429, origin);
    // Not an admin: the same answer and no email, so the page never confirms who the admins are.
    if (!siteAdmins(env).includes(email) || !(await emailDomainOk(email))) return json({ ok: true }, 200, origin);
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return json({ error: 'Sign-in emails need BREVO_API_KEY and BREVO_SENDER_EMAIL.' }, 503, origin);
    const t = await sign({ k: 'al', e: email, n: rid(16), x: now + LINK_TTL }, env.MARKET_SECRET);
    const mail = adminLoginEmail(PAGE + '#login=' + t);
    const r = await fetch(BREVO + '/smtp/email', {
      method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: env.BREVO_SENDER_NAME || 'The Tech Hut', email: env.BREVO_SENDER_EMAIL }, to: [{ email }],
        subject: mail.subject, htmlContent: mail.html, textContent: mail.text, tags: ['admin-login'] }),
    });
    if (!r.ok) return json({ error: 'Could not send the email. Try again in a minute.' }, 502, origin);
    return json({ ok: true }, 200, origin);
  }

  if (route === 'session') {
    const p = await unsign(b.t, env.MARKET_SECRET, 'al', now);
    if (!p || !siteAdmins(env).includes(p.e)) return json({ error: 'That sign-in link has expired or is not valid. Ask for a new one.' }, 400, origin);
    const r = await events(env, { op: 'nonce', n: 'admin:' + p.n });
    if (r.error) return json({ error: 'That sign-in link was already used. Ask for a new one.' }, 400, origin);
    return json({ session: await sign({ k: 'as', e: p.e, x: now + SESSION_TTL }, env.MARKET_SECRET), email: p.e }, 200, origin);
  }

  // Everything below needs an admin session, checked against the admin list every time,
  // so removing someone from SITE_ADMINS locks them out at once.
  const s = await unsign(b.session, env.MARKET_SECRET, 'as', now);
  if (!s || !siteAdmins(env).includes(s.e)) return json({ error: 'signin' }, 401, origin);

  if (route === 'overview') {
    const [market, pay, news, ev, gm] = await Promise.all([
      settled(async () => (env.MARKET ? marketSummary(await adminMarket(env), now) : { error: 'MARKET is not bound' })),
      settled(() => payments(env, now)), settled(() => newsletter(env)), settled(() => eventsSummary(env, now)), settled(() => games(env)),
    ]);
    return json({ at: now, admin: s.e, market, payments: pay, newsletter: news, events: ev, games: gm, config: config(env) }, 200, origin);
  }
  if (route === 'prompt') {
    if (!['hide', 'restore', 'clear'].includes(b.action)) return json({ error: 'Unknown action.' }, 400, origin);
    const r = await adminPromptAction(env, String(b.id || ''), b.action);
    return json(r, r.error ? 404 : 200, origin);
  }
  if (route === 'resend') {
    const okSent = await resendPurchaseEmail(env, String(b.uid || ''), String(b.pid || ''), b.who === 'seller' ? 'seller' : 'buyer');
    return okSent ? json({ ok: true }, 200, origin) : json({ error: 'Could not send it. Check that Brevo is set up and the purchase exists.' }, 502, origin);
  }
  if (route === 'announce') {
    // Test first (only to the signed-in admin), then send in batches; the page repeats until none remain.
    const aid = String(b.aid || '');
    if (b.status) return json({ announcements: await announcementStatus(env) }, 200, origin);
    const r = await sendAnnouncement(env, aid, b.test ? { testTo: s.e } : { batch: 25 });
    return json(r, r.error ? 400 : 200, origin);
  }
  if (route === 'event-delete') {
    const id = String(b.id || '');
    if (!/^ev[a-z2-9]{10}$/.test(id)) return json({ error: 'Only events posted on the site can be removed here; Luma events are managed on Luma.' }, 400, origin);
    await events(env, { op: 'delete', id });
    return json({ ok: true }, 200, origin);
  }
  return json({ error: 'not found' }, 404, origin);
}
