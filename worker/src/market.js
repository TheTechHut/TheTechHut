/**
 * The prompt marketplace: thetechhut.co/prompts/
 *
 * Community members post AI prompts, free or paid, and buy each other's.
 *
 * Accounts: email only, no password. POST /market/login emails a one-time
 * sign-in link (valid 20 minutes, usable once); the page swaps it for a
 * signed session token kept in the browser for 60 days. The first sign-in
 * creates the account, so signing up and signing in are the same click.
 *
 * Money: Paystack split payments. A seller adds their payout bank account
 * once; we create a Paystack subaccount for them with percentage_charge 10,
 * so on every sale Paystack sends 90% to the seller and 10% to The Tech Hut,
 * and settles the seller directly. Paystack's fee is taken from the seller's
 * share (bearer: subaccount). We never hold sellers' money.
 *
 * Data: one Durable Object (Market, named "market") with these keys:
 *   u:<uid>          { id, email, name, created, payout?, welcome? }   welcome: 'pending' until the welcome email is sent
 *   e:<email-hash>   uid
 *   p:<pid>          { id, uid, title, desc, cat, model, preview, body, price, created, updated, sales, reports, hidden }
 *   b:<uid>:<pid>    { ref, at, amount, mailed?, sellerMailed? }   a purchase; the flags are set once the
 *                    buyer has been emailed the prompt and the seller congratulated
 *   r:<reference>    { uid, pid }              a Paystack payment already counted
 *   n:<nonce>        expiry                    a sign-in link already used
 *
 * Routes (all JSON, POST unless noted; `session` goes in the body):
 *   POST /market/login    { email, website, next? }    -> { ok }            emails the sign-in link (back to `next`)
 *   POST /market/session  { t }                        -> { session, user } swaps the link for a session
 *   GET  /market/prompts                               -> { prompts }       public list, no prompt bodies
 *   GET  /market/prompt?id=<pid>                       -> { prompt }        one prompt for its own page, no body
 *   POST /market/me       { session }                  -> { user, mine, bought }
 *   POST /market/profile  { session, name }            -> { user }
 *   POST /market/save     { session, id?, title, desc, cat, model, preview, body, price } -> { prompt }
 *   POST /market/delete   { session, id }              -> { ok }
 *   POST /market/open     { session?, id }             -> { body }          free, own or bought prompts only
 *   POST /market/report   { id, reason }               -> { ok }
 *   GET  /market/banks                                 -> { banks }         Paystack's Kenyan settlement banks
 *   POST /market/payout   { session, bank, account }   -> { user }          creates/updates the subaccount
 *   POST /market/buy      { session, id, website }     -> { url, reference }
 *   POST /market/verify   { reference, session }       -> { paid, id, body? }  body only for the buyer
 *
 * Each prompt has its own page, /prompts/p/<pid>/<slug>/ (one static
 * shell, rewritten by Firebase, that reads GET /market/prompt). When a sale
 * settles, settle() emails the buyer the full prompt and congratulates the
 * seller, once each. New members get a welcome email after their first
 * sign-in, and a member who posts a new prompt gets an email with its link
 * and share buttons.
 *
 * Secrets: MARKET_SECRET (signs links and sessions), plus the existing
 * PAYSTACK_SECRET_KEY, BREVO_API_KEY and BREVO_SENDER_EMAIL.
 * Optional var: MARKET_ADMINS, comma-separated emails that may hide any prompt.
 */
import { LIMITS, guard, emailDomainOk, sha256Hex } from './payguard.js';

const SITE = 'https://thetechhut.co';
/** The prompt's own page. The slug is only for people and search engines; the page reads the id. */
export function promptPath(p) {
  const slug = String(p.title || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return '/prompts/p/' + p.id + '/' + (slug ? slug + '/' : '');
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PAYSTACK = 'https://api.paystack.co';
const BREVO = 'https://api.brevo.com/v3';
const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const LINK_TTL = 20 * MIN;
const SESSION_TTL = 60 * DAY;
export const COMMISSION_PERCENT = 10;
export const PRICE_MIN = 50, PRICE_MAX = 20000;     // KES; 0 means free
export const CATS = ['writing', 'coding', 'career', 'marketing', 'data', 'images', 'business', 'learning', 'other'];
export const MODELS = ['any', 'chatgpt', 'claude', 'gemini', 'copilot', 'midjourney', 'other'];
const HIDE_AFTER_REPORTS = 5;

/* ------------------------------------------------------------------ tokens */

const enc = new TextEncoder();
const b64u = (s) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
export async function sign(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  return body + '.' + (await hmacHex(secret, body));
}
/** -> payload, or null if forged, malformed, of the wrong kind or expired */
export async function unsign(token, secret, kind, now) {
  if (typeof token !== 'string' || token.length > 1500) return null;
  const i = token.lastIndexOf('.');
  if (i < 1 || !same(token.slice(i + 1), await hmacHex(secret, token.slice(0, i)))) return null;
  let p; try { p = JSON.parse(unb64u(token.slice(0, i))); } catch (e) { return null; }
  if (!p || p.k !== kind || typeof p.x !== 'number' || now > p.x) return null;
  return p;
}

/* ------------------------------------------------------------------ input */

function text(s, max, multiline) {
  if (typeof s !== 'string') return '';
  let t = s.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  t = multiline ? t.replace(/\n{4,}/g, '\n\n\n').trim() : t.replace(/\s+/g, ' ').trim();
  return t.slice(0, max);
}
export function cleanPrompt(b) {
  const out = {
    title: text(b.title, 90), desc: text(b.desc, 600, true), cat: CATS.includes(b.cat) ? b.cat : 'other',
    model: MODELS.includes(b.model) ? b.model : 'any', preview: text(b.preview, 400, true), body: text(b.body, 12000, true),
    price: Math.round(Number(b.price) || 0),
  };
  if (out.title.length < 5) return { error: 'Give the prompt a title of at least 5 characters.' };
  if (out.desc.length < 20) return { error: 'Describe what the prompt does in at least 20 characters.' };
  if (out.body.length < 30) return { error: 'The prompt itself needs at least 30 characters.' };
  if (out.price !== 0 && (out.price < PRICE_MIN || out.price > PRICE_MAX)) return { error: `Price must be 0 (free) or between KES ${PRICE_MIN} and KES ${PRICE_MAX.toLocaleString('en')}.` };
  return { prompt: out };
}
const publicPrompt = (p, sellers) => ({
  id: p.id, title: p.title, desc: p.desc, cat: p.cat, model: p.model, preview: p.preview, price: p.price,
  sales: p.sales || 0, created: p.created, updated: p.updated || p.created, seller: (sellers[p.uid] && sellers[p.uid].name) || 'Member', mine: false, path: promptPath(p),
});
const ownPrompt = (p) => ({ ...p, reports: undefined, path: promptPath(p) });
const meView = (u) => ({ id: u.id, name: u.name, email: u.email, payout: u.payout ? { bank: u.payout.bank, last4: u.payout.last4, holder: u.payout.holder } : null });
function nameFromEmail(email) {
  const local = email.split('@')[0].replace(/[^a-zA-Z0-9]+/g, ' ').trim();
  const n = local ? local.charAt(0).toUpperCase() + local.slice(1, 18) : 'Member';
  return n;
}
const rid = (n = 12) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join(''); };

/* ---------------------------------------------------------- Durable Object */

export class Market {
  constructor(state, env) { this.state = state; this.env = env || {}; }

  async fetch(req) {
    const st = this.state.storage;
    const b = await req.json().catch(() => ({}));
    const now = Date.now();
    const ok = (o) => Response.json(o);
    const user = async (uid) => (uid ? await st.get('u:' + uid) : null);

    switch (b.op) {
      case 'login': {            // first sign-in creates the account
        if (await st.get('n:' + b.nonce)) return ok({ error: 'used' });
        await st.put('n:' + b.nonce, now + LINK_TTL);
        const eh = await sha256Hex(b.email);
        let uid = await st.get('e:' + eh);
        let u = uid && (await st.get('u:' + uid));
        if (!u) {
          uid = rid();
          u = { id: uid, email: b.email, name: nameFromEmail(b.email), created: now, welcome: 'pending' };
          await st.put({ ['u:' + uid]: u, ['e:' + eh]: uid });
        }
        // Members who joined before welcome emails existed have no flag, so they never get one.
        return ok({ user: meView(u), welcome: u.welcome === 'pending' });
      }
      case 'welcomed': {
        const u = await user(b.uid); if (!u) return ok({ ok: true });
        u.welcome = now; await st.put('u:' + u.id, u); return ok({ ok: true });
      }
      case 'user': { const u = await user(b.uid); return ok({ user: u || null }); }
      case 'profile': {
        const u = await user(b.uid); if (!u) return ok({ error: 'no user' });
        u.name = b.name; await st.put('u:' + u.id, u); return ok({ user: meView(u) });
      }
      case 'payout': {
        const u = await user(b.uid); if (!u) return ok({ error: 'no user' });
        u.payout = b.payout; await st.put('u:' + u.id, u); return ok({ user: meView(u) });
      }
      case 'list': {
        const all = [...(await st.list({ prefix: 'p:' })).values()].filter((p) => !p.hidden);
        const uids = [...new Set(all.map((p) => p.uid))];
        const sellers = Object.fromEntries((await Promise.all(uids.map((id) => st.get('u:' + id)))).filter(Boolean).map((u) => [u.id, u]));
        all.sort((x, y) => (y.sales || 0) - (x.sales || 0) || y.created - x.created);
        return ok({ prompts: all.slice(0, 600).map((p) => publicPrompt(p, sellers)) });
      }
      case 'me': {
        const u = await user(b.uid); if (!u) return ok({ error: 'no user' });
        const mine = [...(await st.list({ prefix: 'p:' })).values()].filter((p) => p.uid === u.id).map(ownPrompt);
        const buys = await st.list({ prefix: 'b:' + u.id + ':' });
        const bought = [];
        for (const [k, rec] of buys) {
          const p = await st.get('p:' + k.split(':')[2]);
          if (p) bought.push({ id: p.id, title: p.title, body: p.body, model: p.model, at: rec.at, amount: rec.amount, path: promptPath(p) });
        }
        return ok({ user: meView(u), mine, bought });
      }
      case 'save': {
        const u = await user(b.uid); if (!u) return ok({ error: 'no user' });
        if (b.prompt.price > 0 && !u.payout) return ok({ error: 'payout' });
        let p = b.id ? await st.get('p:' + b.id) : null;
        if (b.id && (!p || p.uid !== u.id)) return ok({ error: 'not yours' });
        let created = false, first = false;
        if (!p) {
          const theirs = [...(await st.list({ prefix: 'p:' })).values()].filter((x) => x.uid === u.id);
          if (theirs.filter((x) => x.created > now - DAY).length >= 20) return ok({ error: 'limit' });
          p = { id: rid(10), uid: u.id, created: now, sales: 0, reports: 0, hidden: false };
          created = true; first = theirs.length === 0;
        }
        Object.assign(p, b.prompt, { updated: now });
        await st.put('p:' + p.id, p);
        return ok({ prompt: ownPrompt(p), created, first, seller: created ? { name: u.name, email: u.email } : undefined });
      }
      case 'delete': {
        const p = await st.get('p:' + b.id);
        if (!p) return ok({ ok: true });
        const u = await user(b.uid);
        if (!u || (p.uid !== u.id && !b.admin)) return ok({ error: 'not yours' });
        // Buyers keep what they paid for: a sold prompt is hidden, not erased.
        if (p.sales > 0) { p.hidden = true; await st.put('p:' + p.id, p); } else await st.delete('p:' + p.id);
        return ok({ ok: true });
      }
      case 'one': {             // the public view, for the prompt's own page
        const p = await st.get('p:' + b.id);
        if (!p || p.hidden) return ok({ prompt: null });
        const seller = await user(p.uid);
        return ok({ prompt: publicPrompt(p, seller ? { [seller.id]: seller } : {}) });
      }
      case 'get': {
        const p = await st.get('p:' + b.id);
        if (!p) return ok({ prompt: null });
        const seller = await user(p.uid);
        const owned = !!(b.uid && (p.uid === b.uid || (await st.get('b:' + b.uid + ':' + p.id))));
        return ok({ prompt: p, seller: seller ? { name: seller.name, payout: seller.payout || null } : null, owned });
      }
      case 'admin': {           // everything, for the site dashboard (admin.js). Includes emails: admins only.
        const users = [...(await st.list({ prefix: 'u:' })).values()];
        const byId = Object.fromEntries(users.map((u) => [u.id, u]));
        const prompts = [...(await st.list({ prefix: 'p:' })).values()];
        const pById = Object.fromEntries(prompts.map((x) => [x.id, x]));
        const purchases = [];
        for (const [k, rec] of await st.list({ prefix: 'b:' })) {
          const [, uid, pid] = k.split(':'); const p = pById[pid];
          purchases.push({ uid, pid, title: p ? p.title : '(removed)', buyer: byId[uid] ? byId[uid].email : null,
            seller: p && byId[p.uid] ? byId[p.uid].email : null, sellerName: p && byId[p.uid] ? byId[p.uid].name : null,
            amount: rec.amount || 0, at: rec.at, ref: rec.ref, mailed: !!rec.mailed, sellerMailed: !!rec.sellerMailed });
        }
        const counts = {};
        for (const pu of purchases) counts[pu.uid] = (counts[pu.uid] || 0) + 1;
        return ok({
          members: users.map((u) => ({ id: u.id, email: u.email, name: u.name, created: u.created, payout: !!u.payout,
            prompts: prompts.filter((x) => x.uid === u.id).length, bought: counts[u.id] || 0, welcomed: typeof u.welcome === 'number' })),
          prompts: prompts.map((x) => ({ id: x.id, title: x.title, cat: x.cat, price: x.price, sales: x.sales || 0, reports: x.reports || 0,
            hidden: !!x.hidden, created: x.created, updated: x.updated, seller: byId[x.uid] ? byId[x.uid].email : null,
            sellerName: byId[x.uid] ? byId[x.uid].name : null, path: promptPath(x) })),
          purchases,
        });
      }
      case 'adminPrompt': {     // hide, restore, or clear the reports on any prompt
        const p = await st.get('p:' + b.id); if (!p) return ok({ error: 'no prompt' });
        if (b.action === 'hide') p.hidden = true;
        else if (b.action === 'restore') { p.hidden = false; p.reports = 0; }
        else if (b.action === 'clear') p.reports = 0;
        else return ok({ error: 'bad action' });
        await st.put('p:' + p.id, p);
        return ok({ ok: true, hidden: p.hidden, reports: p.reports });
      }
      case 'report': {
        const p = await st.get('p:' + b.id); if (!p) return ok({ ok: true });
        p.reports = (p.reports || 0) + 1;
        if (p.reports >= HIDE_AFTER_REPORTS) p.hidden = true;
        await st.put('p:' + p.id, p); return ok({ ok: true });
      }
      case 'purchase': {        // idempotent: the page, a reload and the webhook all land here
        if (await st.get('r:' + b.ref)) {
          const rec = await st.get('b:' + b.uid + ':' + b.pid);
          const p0 = await st.get('p:' + b.pid);
          return ok({ ok: true, first: false, mailed: !!(rec && rec.mailed), sellerMailed: !!(rec && rec.sellerMailed), sales: p0 ? p0.sales || 0 : 0 });
        }
        const p = await st.get('p:' + b.pid);
        if (!p) return ok({ error: 'no prompt' });
        await st.put({ ['r:' + b.ref]: { uid: b.uid, pid: b.pid, at: now }, ['b:' + b.uid + ':' + b.pid]: { ref: b.ref, at: now, amount: b.amount } });
        p.sales = (p.sales || 0) + 1; await st.put('p:' + p.id, p);
        return ok({ ok: true, first: true, mailed: false, sellerMailed: false, sales: p.sales });
      }
      case 'mailed': {          // an email about this purchase went out; don't send it again
        const k = 'b:' + b.uid + ':' + b.pid;
        const rec = await st.get(k);
        if (rec) { rec[b.who === 'seller' ? 'sellerMailed' : 'mailed'] = now; await st.put(k, rec); }
        return ok({ ok: true });
      }
    }
    return ok({ error: 'unknown op' });
  }
}

/* ------------------------------------------------------------ worker side */

const store = (env) => env.MARKET.get(env.MARKET.idFromName('market'));
async function call(env, body) {
  const r = await store(env).fetch('https://market/', { method: 'POST', body: JSON.stringify(body) });
  return r.json();
}
async function paystack(env, path, init) {
  const r = await fetch(PAYSTACK + path, { ...init, headers: { Authorization: 'Bearer ' + env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json' } });
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
}
async function session(env, token, now) {
  const p = await unsign(token, env.MARKET_SECRET, 's', now);
  if (!p) return null;
  const { user } = await call(env, { op: 'user', uid: p.u });
  return user || null;
}
const admins = (env) => String(env.MARKET_ADMINS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

export function loginEmail(link) {
  const html = '<div style="font-family:\'Source Sans 3\',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
    + '<p style="font-family:Georgia,serif;font-weight:700;font-size:22px;margin:0 0 18px">The Tech Hut<span style="color:#06D6A0">.</span></p>'
    + '<p style="margin:0 0 6px;font-family:Menlo,monospace;font-size:12px;letter-spacing:1px;color:#046B52">PROMPT MARKETPLACE</p>'
    + '<p style="font-size:17px">Press the button to sign in. No password needed, and if you are new, this creates your account.</p>'
    + '<p style="margin:24px 0"><a href="' + link + '" style="background:#073B4C;color:#fff;padding:13px 22px;border-radius:3px;text-decoration:none;font-weight:700">Sign in to the marketplace</a></p>'
    + '<p style="font-size:13px;color:#5B6B7B">The link works once, for 20 minutes. If you did not ask for it, ignore this email: nothing happens.</p></div>';
  const text = 'Sign in to The Tech Hut prompt marketplace (works once, for 20 minutes):\n\n' + link + '\n\nIf you did not ask for it, ignore this email.\n';
  return { subject: 'Your sign-in link for the prompt marketplace', html, text };
}

/** The email a buyer gets: the whole prompt, so it is theirs even without signing in again. */
export function purchaseEmail(p, { amount, reference }) {
  const url = SITE + promptPath(p);
  const html = '<div style="font-family:\'Source Sans 3\',Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
    + '<p style="font-family:Georgia,serif;font-weight:700;font-size:22px;margin:0 0 18px">The Tech Hut<span style="color:#06D6A0">.</span></p>'
    + '<p style="margin:0 0 6px;font-family:Menlo,monospace;font-size:12px;letter-spacing:1px;color:#046B52">PROMPT MARKETPLACE &middot; RECEIPT</p>'
    + '<p style="font-size:17px">Thanks for your purchase. Here is your prompt, <b>' + esc(p.title) + '</b>. Copy it into ' + (p.model && p.model !== 'any' && p.model !== 'other' ? esc(MODEL_NAMES[p.model] || 'your AI tool') : 'your AI tool') + ' and fill in anything in brackets.</p>'
    + '<pre style="white-space:pre-wrap;word-wrap:break-word;font:14px/1.55 Menlo,Consolas,monospace;background:#F4F1EA;border-left:3px solid #073B4C;padding:14px 16px;margin:18px 0">' + esc(p.body) + '</pre>'
    + '<p style="margin:22px 0"><a href="' + url + '" style="background:#073B4C;color:#fff;padding:13px 22px;border-radius:3px;text-decoration:none;font-weight:700">Open it on the marketplace</a></p>'
    + '<p style="font-size:13px;color:#5B6B7B">Paid: KES ' + Number(amount).toLocaleString('en') + ' &middot; Reference: ' + esc(reference) + '<br>'
    + 'It is also saved under My account &rarr; Bought when you sign in with this email. Questions or a problem with the prompt? Reply to this email or write to info@thetechhut.co.</p></div>';
  const text = 'Thanks for your purchase on The Tech Hut prompt marketplace.\n\n' + p.title + '\n' + '-'.repeat(Math.min(60, p.title.length)) + '\n\n' + p.body
    + '\n\nOpen it on the marketplace: ' + url + '\nPaid: KES ' + Number(amount).toLocaleString('en') + ' | Reference: ' + reference
    + '\nQuestions? Write to info@thetechhut.co.\n';
  return { subject: 'Your prompt: ' + p.title, html, text };
}
const MAIL_TOP = '<div style="font-family:\'Source Sans 3\',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
  + '<p style="font-family:Georgia,serif;font-weight:700;font-size:22px;margin:0 0 18px">The Tech Hut<span style="color:#06D6A0">.</span></p>';
const button = (href, label, mint) => '<a href="' + href + '" style="display:inline-block;background:' + (mint ? '#06D6A0;color:#073B4C' : '#073B4C;color:#fff') + ';padding:12px 20px;border-radius:3px;text-decoration:none;font-weight:700;margin:0 8px 8px 0">' + label + '</a>';

/** Sent once, after a new member's first sign-in. */
export function welcomeEmail(u) {
  const name = u && u.name ? ', ' + esc(u.name) : '';
  const html = MAIL_TOP
    + '<p style="margin:0 0 6px;font-family:Menlo,monospace;font-size:12px;letter-spacing:1px;color:#046B52">PROMPT MARKETPLACE &middot; WELCOME</p>'
    + '<p style="font-family:Georgia,serif;font-size:26px;font-weight:700;margin:6px 0 12px">Welcome to the marketplace' + name + '!</p>'
    + '<p style="font-size:17px">You are now part of a community of people in Kenya and beyond who share the AI prompts that actually work for them. Here are three ways to take part this week:</p>'
    + '<ol style="font-size:16.5px;padding-left:20px;margin:0 0 18px">'
    + '<li style="margin-bottom:10px"><b>Try a free prompt.</b> Browse by category (CVs, coding, marketing, data and more) and copy one into ChatGPT, Claude or Gemini.</li>'
    + '<li style="margin-bottom:10px"><b>Share one you rely on.</b> That cover-letter or SQL prompt you keep reusing could save someone else an hour. Posting takes two minutes.</li>'
    + '<li style="margin-bottom:10px"><b>Earn from your best ones.</b> Set a price from KES 50 and keep ' + (100 - COMMISSION_PERCENT) + '% of every sale, paid by Paystack straight to your bank account.</li></ol>'
    + '<p style="margin:22px 0 10px">' + button(SITE + '/prompts/#sell', 'Post your first prompt', true) + button(SITE + '/prompts/', 'Browse prompts') + '</p>'
    + '<p style="font-size:13px;color:#5B6B7B">No password to remember: whenever you want to sign in, ask for a link on the marketplace. Questions? Reply to this email.</p></div>';
  const text = 'Welcome to The Tech Hut prompt marketplace' + (u && u.name ? ', ' + u.name : '') + '!\n\n'
    + '1. Try a free prompt: browse by category and copy one into your AI tool.\n'
    + '2. Share one you rely on: posting takes two minutes.\n'
    + '3. Earn from your best ones: set a price from KES 50 and keep ' + (100 - COMMISSION_PERCENT) + '% of every sale.\n\n'
    + 'Post your first prompt: ' + SITE + '/prompts/#sell\nBrowse: ' + SITE + '/prompts/\n';
  return { subject: 'Welcome to The Tech Hut prompt marketplace', html, text };
}

/** Sent when a member posts a new prompt: its link, and buttons to share it. */
export function listedEmail(p, { name, first }) {
  const url = SITE + promptPath(p);
  const pitch = p.title + (p.price > 0 ? '' : ' (free)') + ': an AI prompt on The Tech Hut marketplace';
  const wa = 'https://wa.me/?text=' + encodeURIComponent(pitch + ' ' + url);
  const li = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
  const x = 'https://x.com/intent/post?text=' + encodeURIComponent(pitch) + '&url=' + encodeURIComponent(url);
  const lead = first
    ? 'Welcome to the marketplace\'s sellers' + (name ? ', ' + esc(name) : '') + '! Your first prompt is live.'
    : 'Your new prompt is live' + (name ? ', ' + esc(name) : '') + '.';
  const why = p.price > 0
    ? 'Most sales start with a share. Post the link where people already ask you for help: your WhatsApp status, a class or work group, LinkedIn. You keep ' + (100 - COMMISSION_PERCENT) + '% of every sale.'
    : 'Free prompts are how people find you. Post the link where people already ask you for help: your WhatsApp status, a class or work group, LinkedIn.';
  const html = MAIL_TOP
    + '<p style="margin:0 0 6px;font-family:Menlo,monospace;font-size:12px;letter-spacing:1px;color:#046B52">PROMPT MARKETPLACE &middot; ' + (first ? 'WELCOME, SELLER' : 'NOW LIVE') + '</p>'
    + '<p style="font-family:Georgia,serif;font-size:26px;font-weight:700;margin:6px 0 12px">' + lead + '</p>'
    + '<p style="font-size:17px"><b>' + esc(p.title) + '</b> &middot; ' + (p.price > 0 ? 'KES ' + Number(p.price).toLocaleString('en') : 'Free') + '<br><a href="' + url + '" style="color:#046B52">' + esc(url) + '</a></p>'
    + '<p style="font-size:17px">' + why + '</p>'
    + '<p style="margin:20px 0 10px">' + button(wa, 'Share on WhatsApp', true) + button(li, 'Share on LinkedIn') + button(x, 'Share on X') + '</p>'
    + '<p style="font-size:15px">Tip: a clear title and a preview that shows the result sell best. You can edit the prompt any time from My account.</p>'
    + '<p style="font-size:13px;color:#5B6B7B">You get this email when you post a new prompt' + (p.price > 0 ? ', and another every time it sells' : '') + '.</p></div>';
  const text = (first ? 'Welcome to the marketplace\'s sellers! Your first prompt is live.' : 'Your new prompt is live.') + '\n\n'
    + p.title + '\n' + url + '\n\n' + why.replace(/&amp;/g, '&') + '\n\nShare on WhatsApp: ' + wa + '\nShare on LinkedIn: ' + li + '\nShare on X: ' + x + '\n';
  return { subject: (first ? 'Welcome, seller: ' : 'Your prompt is live: ') + p.title, html, text };
}

/** The email a seller gets on each sale. It never says who bought. */
export function saleEmail(p, { amount, sales, seller }) {
  const url = SITE + promptPath(p);
  const share = Math.floor(amount * (100 - COMMISSION_PERCENT)) / 100;
  const bank = seller && seller.payout ? (seller.payout.bank || 'your bank') + (seller.payout.last4 ? ', account ending ' + seller.payout.last4 : '') : 'your bank account';
  const nth = sales === 1 ? 'your first sale of this prompt' : 'sale number ' + sales + ' of this prompt';
  const html = '<div style="font-family:\'Source Sans 3\',Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
    + '<p style="font-family:Georgia,serif;font-weight:700;font-size:22px;margin:0 0 18px">The Tech Hut<span style="color:#06D6A0">.</span></p>'
    + '<p style="margin:0 0 6px;font-family:Menlo,monospace;font-size:12px;letter-spacing:1px;color:#046B52">PROMPT MARKETPLACE &middot; YOU MADE A SALE</p>'
    + '<p style="font-family:Georgia,serif;font-size:26px;font-weight:700;margin:6px 0 12px">Congratulations' + (seller && seller.name ? ', ' + esc(seller.name) : '') + '!</p>'
    + '<p style="font-size:17px">Someone just bought <b>' + esc(p.title) + '</b> for KES ' + Number(amount).toLocaleString('en') + '. That is ' + nth + '.</p>'
    + '<p style="font-size:17px">Your ' + (100 - COMMISSION_PERCENT) + '%, about <b>KES ' + share.toLocaleString('en') + '</b> before Paystack\'s fee, is paid to ' + esc(bank) + ' on Paystack\'s normal settlement schedule. You do not need to do anything.</p>'
    + '<p style="margin:24px 0"><a href="' + url + '" style="background:#073B4C;color:#fff;padding:13px 22px;border-radius:3px;text-decoration:none;font-weight:700">See your prompt\'s page</a></p>'
    + '<p style="font-size:15px">Want more sales? Share that link on WhatsApp, LinkedIn or X, and post another prompt you rely on.</p>'
    + '<p style="font-size:13px;color:#5B6B7B">You get this email for every sale. Questions about a payout? Write to info@thetechhut.co.</p></div>';
  const text = 'Congratulations' + (seller && seller.name ? ', ' + seller.name : '') + '! Someone just bought "' + p.title + '" for KES ' + Number(amount).toLocaleString('en') + ' (' + nth + ').\n\n'
    + 'Your ' + (100 - COMMISSION_PERCENT) + '%, about KES ' + share.toLocaleString('en') + ' before Paystack\'s fee, is paid to ' + bank + ' on Paystack\'s normal settlement schedule.\n\n'
    + 'Your prompt\'s page: ' + url + '\nShare it to sell more. Questions? info@thetechhut.co\n';
  return { subject: 'You made a sale: ' + p.title, html, text };
}
const MODEL_NAMES = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot', midjourney: 'Midjourney' };

/** Returns a Response for /market/*, or null. */
export async function handleMarket(req, env, url, origin, deps) {
  const { json, allowedOrigins } = deps;
  if (!url.pathname.startsWith('/market/')) return null;
  const route = url.pathname.slice(8);
  const now = Date.now();
  if (!env.MARKET || !env.MARKET_SECRET) return json({ error: 'The marketplace is switching on. Try again soon.' }, 503, origin);

  if (req.method === 'GET' && route === 'prompts') {
    const r = await call(env, { op: 'list' });
    return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=600', ...deps.cors(origin) } });
  }
  if (req.method === 'GET' && route === 'prompt') {
    const id = url.searchParams.get('id') || '';
    if (!/^[a-z0-9]{6,20}$/.test(id)) return json({ error: 'That prompt is no longer available.' }, 404, origin);
    const r = await call(env, { op: 'one', id });
    if (!r.prompt) return json({ error: 'That prompt is no longer available.' }, 404, origin);
    return new Response(JSON.stringify({ prompt: r.prompt }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=600', ...deps.cors(origin) } });
  }
  if (req.method === 'GET' && route === 'banks') {
    const r = await paystack(env, '/bank?country=kenya&currency=KES&perPage=200');
    const banks = (r.body.data || []).filter((x) => x.active !== false).map((x) => ({ code: x.code, name: x.name }));
    return new Response(JSON.stringify({ banks }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ...deps.cors(origin) } });
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
      { k: 'mlb:' + ip, limit: LIMITS.ipBurst.limit, window: LIMITS.ipBurst.window },
      { k: 'mle:' + (await sha256Hex(email)), limit: LIMITS.emailDay.limit, window: LIMITS.emailDay.window },
    ] });
    if (g && g.ok === false) return json({ error: 'Too many sign-in emails. Wait a few minutes and try again.' }, 429, origin);
    if (!(await emailDomainOk(email))) return json({ error: 'That email address cannot receive mail. Check the part after the @.' }, 400, origin);
    const t = await sign({ k: 'l', e: email, n: rid(16), x: now + LINK_TTL }, env.MARKET_SECRET);
    // Send them back to the page they signed in from (a prompt's own page), never off the marketplace.
    const next = typeof b.next === 'string' && /^\/prompts\/(p\/[a-z0-9]{6,20}\/([a-z0-9-]{1,60}\/)?)?$/.test(b.next) ? b.next : '/prompts/';
    const mail = loginEmail(SITE + next + '#login=' + t);
    const r = await fetch(BREVO + '/smtp/email', {
      method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: env.BREVO_SENDER_NAME || 'The Tech Hut', email: env.BREVO_SENDER_EMAIL }, to: [{ email }],
        subject: mail.subject, htmlContent: mail.html, textContent: mail.text, tags: ['market-login'] }),
    });
    if (!r.ok) return json({ error: 'Could not send the email. Try again in a minute.' }, 502, origin);
    return json({ ok: true }, 200, origin);
  }

  if (route === 'session') {
    const p = await unsign(b.t, env.MARKET_SECRET, 'l', now);
    if (!p) return json({ error: 'That sign-in link has expired or is not valid. Ask for a new one.' }, 400, origin);
    const r = await call(env, { op: 'login', email: p.e, nonce: p.n });
    if (r.error) return json({ error: 'That sign-in link was already used. Ask for a new one.' }, 400, origin);
    if (r.welcome && (await brevo(env, r.user.email, welcomeEmail(r.user), 'market-welcome'))) await call(env, { op: 'welcomed', uid: r.user.id });
    return json({ session: await sign({ k: 's', u: r.user.id, x: now + SESSION_TTL }, env.MARKET_SECRET), user: r.user }, 200, origin);
  }

  if (route === 'report') {
    const g = await guard(env, { op: 'hit', keys: [{ k: 'mrp:' + ip, limit: 10, window: DAY }] });
    if (g && g.ok === false) return json({ ok: true }, 200, origin);
    await call(env, { op: 'report', id: String(b.id || '') });
    return json({ ok: true }, 200, origin);
  }

  if (route === 'verify') {
    const ref = String(b.reference || '');
    if (!/^[A-Za-z0-9._=-]{6,100}$/.test(ref)) return json({ error: 'bad reference' }, 400, origin);
    const r = await paystack(env, '/transaction/verify/' + encodeURIComponent(ref));
    const d = r.body.data || {};
    const res = await settle(env, d);
    if (!res.paid) return json({ paid: false, reason: res.reason }, 200, origin);
    // The prompt itself only goes to the signed-in buyer; anyone else just learns it was paid.
    const me = b.session ? await session(env, b.session, now) : null;
    if (!me || me.id !== res.uid) return json({ paid: true, id: res.pid, mailed: res.mailed }, 200, origin);
    const g = await call(env, { op: 'get', id: res.pid, uid: res.uid });
    return json({ paid: true, id: res.pid, mailed: res.mailed, title: g.prompt && g.prompt.title, body: g.prompt && g.prompt.body, path: g.prompt ? promptPath(g.prompt) : null }, 200, origin);
  }

  if (route === 'open') {
    const u = b.session ? await session(env, b.session, now) : null;
    const g = await call(env, { op: 'get', id: String(b.id || ''), uid: u && u.id });
    if (!g.prompt || (g.prompt.hidden && !g.owned)) return json({ error: 'That prompt is no longer available.' }, 404, origin);
    if (g.prompt.price > 0 && !g.owned) return json({ error: 'buy', price: g.prompt.price }, 402, origin);
    return json({ body: g.prompt.body }, 200, origin);
  }

  // Everything below needs a signed-in member.
  const u = await session(env, b.session, now);
  if (!u) return json({ error: 'signin' }, 401, origin);

  if (route === 'me') return json(await call(env, { op: 'me', uid: u.id }), 200, origin);

  if (route === 'profile') {
    const name = text(b.name, 30);
    if (name.length < 2 || /https?:|www\.|[<>{}\\@]/i.test(name)) return json({ error: 'Use 2 to 30 letters or numbers for your name.' }, 400, origin);
    return json(await call(env, { op: 'profile', uid: u.id, name }), 200, origin);
  }

  if (route === 'save') {
    const c = cleanPrompt(b);
    if (c.error) return json({ error: c.error }, 400, origin);
    const r = await call(env, { op: 'save', uid: u.id, id: b.id ? String(b.id) : null, prompt: c.prompt });
    if (r.error === 'payout') return json({ error: 'payout', message: 'Add the bank account your earnings go to before you sell a paid prompt.' }, 400, origin);
    if (r.error === 'limit') return json({ error: 'You can post 20 prompts a day. Try again tomorrow.' }, 429, origin);
    if (r.error) return json({ error: 'You can only edit your own prompts.' }, 403, origin);
    // A new prompt (not an edit): send its link and share buttons. Best effort; the post is live either way.
    if (r.created && r.seller) await brevo(env, r.seller.email, listedEmail(r.prompt, { name: r.seller.name, first: r.first }), 'market-listed');
    return json({ prompt: r.prompt }, 200, origin);
  }

  if (route === 'delete') {
    const r = await call(env, { op: 'delete', uid: u.id, id: String(b.id || ''), admin: admins(env).includes(u.email) });
    return r.error ? json({ error: 'You can only remove your own prompts.' }, 403, origin) : json({ ok: true }, 200, origin);
  }

  if (route === 'payout') {
    const bank = String(b.bank || '').slice(0, 20), account = String(b.account || '').replace(/\s+/g, '');
    if (!bank || !/^\d{6,20}$/.test(account)) return json({ error: 'Choose your bank and enter the account number (digits only).' }, 400, origin);
    const body = { business_name: (u.name + ' (' + u.id + ')').slice(0, 60), settlement_bank: bank, account_number: account,
      percentage_charge: COMMISSION_PERCENT, primary_contact_email: u.email };
    const r = u.payout && u.payout.code
      ? await paystack(env, '/subaccount/' + encodeURIComponent(u.payout.code), { method: 'PUT', body: JSON.stringify(body) })
      : await paystack(env, '/subaccount', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok || !r.body.status) return json({ error: r.body.message || 'Paystack could not verify that account. Check the bank and number.' }, 400, origin);
    const d = r.body.data || {};
    const payout = { code: d.subaccount_code || (u.payout && u.payout.code), bank: d.settlement_bank || bank, last4: account.slice(-4), holder: d.account_name || '' };
    return json(await call(env, { op: 'payout', uid: u.id, payout }), 200, origin);
  }

  if (route === 'buy') {
    if (!allowedOrigins.includes(origin)) return json({ error: 'forbidden' }, 403, origin);
    if (typeof b.website === 'string' && b.website.trim()) return json({ error: 'could not start the payment' }, 400, origin);
    const g = await call(env, { op: 'get', id: String(b.id || ''), uid: u.id });
    const p = g.prompt;
    if (!p || p.hidden) return json({ error: 'That prompt is no longer available.' }, 404, origin);
    if (g.owned) return json({ error: 'owned' }, 409, origin);
    if (!(p.price > 0)) return json({ error: 'That prompt is free.' }, 400, origin);
    if (!g.seller || !g.seller.payout || !g.seller.payout.code) return json({ error: 'The seller has not finished setting up payouts yet.' }, 409, origin);
    const lim = await guard(env, { op: 'hit', keys: [{ k: 'mbuy:' + ip, limit: LIMITS.ipDay.limit, window: LIMITS.ipDay.window }] });
    if (lim && lim.ok === false) return json({ error: 'Too many attempts. Wait a few minutes.' }, 429, origin);
    const r = await paystack(env, '/transaction/initialize', { method: 'POST', body: JSON.stringify({
      email: u.email, amount: p.price * 100, currency: 'KES', channels: ['card', 'mobile_money', 'bank_transfer'],
      subaccount: g.seller.payout.code, bearer: 'subaccount',
      callback_url: SITE + promptPath(p),
      metadata: { kind: 'market', pid: p.id, uid: u.id, price: p.price,
        custom_fields: [{ display_name: 'Prompt', variable_name: 'prompt', value: p.title.slice(0, 80) }] },
    }) });
    if (!r.ok || !r.body.status) return json({ error: 'Could not start the payment. Try again.' }, 502, origin);
    return json({ url: r.body.data.authorization_url, reference: r.body.data.reference }, 200, origin);
  }

  return json({ error: 'not found' }, 404, origin);
}

/**
 * Records a successful marketplace payment. Used by /market/verify and by the
 * Paystack webhook, so a buyer who closes the tab mid-payment still gets the
 * prompt. -> { paid, pid, uid } or { paid:false, reason }
 */
export async function settle(env, d) {
  const m = (d && d.metadata) || {};
  if (!d || d.status !== 'success') return { paid: false, reason: (d && d.status) || 'not found' };
  if (m.kind !== 'market' || !m.pid || !m.uid) return { paid: false, reason: 'not a marketplace payment' };
  const g = await call(env, { op: 'get', id: String(m.pid) });
  if (!g.prompt) return { paid: false, reason: 'no prompt' };
  if (d.currency !== 'KES' || Number(d.amount) < g.prompt.price * 100) return { paid: false, reason: 'underpaid' };
  const pid = String(m.pid), uid = String(m.uid), amount = Number(d.amount) / 100;
  const rec = await call(env, { op: 'purchase', ref: String(d.reference), pid, uid, amount });
  let mailed = !!rec.mailed;
  if (!mailed) mailed = await mailPrompt(env, g.prompt, uid, { amount, reference: String(d.reference) });
  if (!rec.sellerMailed) await mailSeller(env, g.prompt, uid, { amount, sales: rec.sales || 1 });
  return { paid: true, pid, uid, mailed };
}

/* ------------------------------------------------- for the site dashboard */

export async function adminMarket(env) { return call(env, { op: 'admin' }); }
export async function adminPromptAction(env, id, action) { return call(env, { op: 'adminPrompt', id, action }); }
/** Sends a purchase's buyer or seller email again (the dashboard's Resend). -> true if sent */
export async function resendPurchaseEmail(env, uid, pid, who) {
  const g = await call(env, { op: 'get', id: pid, uid });
  if (!g.prompt || !g.owned) return false;
  const all = await call(env, { op: 'admin' });
  const pu = (all.purchases || []).find((x) => x.uid === uid && x.pid === pid);
  if (!pu) return false;
  if (who === 'seller') {
    const sales = (all.prompts.find((x) => x.id === pid) || {}).sales || 1;
    return mailSeller(env, g.prompt, uid, { amount: pu.amount, sales });
  }
  return mailPrompt(env, g.prompt, uid, { amount: pu.amount, reference: pu.ref });
}

async function brevo(env, to, mail, tag) {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return false;
  try {
    const r = await fetch(BREVO + '/smtp/email', {
      method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: env.BREVO_SENDER_NAME || 'The Tech Hut', email: env.BREVO_SENDER_EMAIL }, to: [{ email: to }],
        replyTo: { email: 'info@thetechhut.co' }, subject: mail.subject, htmlContent: mail.html, textContent: mail.text, tags: [tag] }),
    });
    return r.ok;
  } catch (e) { return false; }
}

/** Congratulates the seller on a sale; like mailPrompt, once per purchase, retried until it works. */
async function mailSeller(env, prompt, buyerUid, sale) {
  const { user: seller } = await call(env, { op: 'user', uid: prompt.uid });
  if (!seller || !seller.email) return false;
  if (!(await brevo(env, seller.email, saleEmail(prompt, { ...sale, seller }), 'market-sale'))) return false;
  await call(env, { op: 'mailed', who: 'seller', uid: buyerUid, pid: prompt.id });
  return true;
}

/**
 * Emails the buyer the prompt they paid for. Runs on every settle() until it
 * works once (the webhook and the buyer's return usually both call it), then
 * the purchase is marked mailed so it is never sent twice. -> true if sent
 */
async function mailPrompt(env, prompt, uid, receipt) {
  const { user } = await call(env, { op: 'user', uid });
  if (!user || !user.email) return false;
  if (!(await brevo(env, user.email, purchaseEmail(prompt, receipt), 'market-purchase'))) return false;
  await call(env, { op: 'mailed', who: 'buyer', uid, pid: prompt.id });
  return true;
}
