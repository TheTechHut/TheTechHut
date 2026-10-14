/**
 * The CV Pack signup: double opt-in, then Brevo.
 *
 *   POST /subscribe { email, name?, role?, website? }
 *        -> emails a confirmation link. Nothing is added to the list yet.
 *   POST /confirm   { t }
 *        -> the link's token. Adds the contact to the Brevo list, sends the
 *           welcome email with the keyword checklist.
 *
 * Why two steps: anyone can type any address into a form. Without the
 * confirmation, a stranger could subscribe someone else, and the Monday digest
 * would then be unsolicited email from us. The confirmation link is a signed
 * token (HMAC-SHA256, expires in 48 hours), so the Worker needs no database.
 *
 * Why the token lives in the URL #fragment and the page POSTs it: mail
 * scanners (Outlook, Gmail, corporate gateways) fetch every link in a message
 * to check it. A plain GET /confirm link would be "clicked" by the scanner and
 * confirm people who never read the email. Scanners do not run JavaScript or
 * press buttons, and a fragment is never sent to a server.
 *
 * Secrets / vars (wrangler secret put <NAME>):
 *   BREVO_API_KEY        Brevo -> SMTP & API -> API keys (a v3 key)
 *   BREVO_LIST_ID        the numeric id of the list contacts are added to
 *   BREVO_SENDER_EMAIL   a sender verified in Brevo (ideally on an authenticated
 *                        domain, or confirmation emails land in spam)
 *   BREVO_SENDER_NAME    optional, defaults to "The Tech Hut"
 *   SUBSCRIBE_SECRET     any long random string; signs the confirmation links
 */
import { CHECKLIST } from './checklist.js';

const SITE = 'https://thetechhut.co';
const BREVO = 'https://api.brevo.com/v3';
const TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

const REQUIRED = ['BREVO_API_KEY', 'BREVO_LIST_ID', 'BREVO_SENDER_EMAIL', 'SUBSCRIBE_SECRET'];

export function newsletterConfigured(env) {
  return REQUIRED.every((k) => env[k] && String(env[k]).trim());
}

/* ------------------------------------------------------------------ utils */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(str) {
  const bytes = enc.encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return dec.decode(bytes);
}

async function hmac256Hex(key, message) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signToken(payload, secret) {
  const body = b64urlEncode(JSON.stringify(payload));
  return body + '.' + (await hmac256Hex(secret, body));
}

/** -> { ok:true, payload } | { ok:false, reason:'invalid'|'expired' } */
export async function verifyToken(token, secret, now, safeEqual) {
  if (typeof token !== 'string' || token.length > 2000) return { ok: false, reason: 'invalid' };
  const i = token.lastIndexOf('.');
  if (i < 1) return { ok: false, reason: 'invalid' };
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!safeEqual(sig, await hmac256Hex(secret, body))) return { ok: false, reason: 'invalid' };
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch (e) { return { ok: false, reason: 'invalid' }; }
  if (!payload || typeof payload.e !== 'string' || typeof payload.x !== 'number') return { ok: false, reason: 'invalid' };
  if (now > payload.x) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

function clean(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function brevo(path, env, init) {
  const r = await fetch(BREVO + path, {
    ...init,
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  const text = await r.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (e) { /* brevo answers 204 with no body */ }
  return { ok: r.ok, status: r.status, body };
}

function sender(env) {
  return { name: (env.BREVO_SENDER_NAME || 'The Tech Hut').trim(), email: env.BREVO_SENDER_EMAIL.trim() };
}

/* ----------------------------------------------------------------- emails */

const WRAP_OPEN = '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#073B4C;line-height:1.55">'
  + '<p style="font-family:Poppins,Arial,sans-serif;font-weight:700;font-size:20px;margin:0 0 20px">The Tech Hut<span style="color:#06D6A0">.</span></p>';
const WRAP_CLOSE = '</div>';

export function confirmEmail(link, name) {
  const hi = name ? 'Hi ' + esc(name) + ',' : 'Hi,';
  const html = WRAP_OPEN
    + '<p>' + hi + '</p>'
    + '<p>Someone (hopefully you) asked for the CV keyword checklist and the Monday openings digest from The Tech Hut. Confirm your email and we will send the checklist straight away.</p>'
    + '<p style="margin:24px 0"><a href="' + esc(link) + '" style="background:#073B4C;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">Confirm my email</a></p>'
    + '<p style="font-size:13px;color:#4a5568">The link works for 48 hours. If it was not you, ignore this email and nothing will happen: you will not be added to anything.</p>'
    + WRAP_CLOSE;
  const text = hi + '\n\nSomeone (hopefully you) asked for the CV keyword checklist and the Monday openings digest from The Tech Hut. Confirm your email and we will send the checklist straight away:\n\n'
    + link + '\n\nThe link works for 48 hours. If it was not you, ignore this email and nothing will happen: you will not be added to anything.\n';
  return { subject: 'Confirm your email to get the CV checklist', html, text };
}

export function welcomeEmail(name) {
  const hi = name ? 'Hi ' + esc(name) + ',' : 'Hi,';
  const hiText = name ? 'Hi ' + name + ',' : 'Hi,';
  const rules = CHECKLIST.rules;
  const fam = Object.values(CHECKLIST.families);

  const rulesHtml = rules.map((r, i) => '<p style="margin:0 0 10px"><b>' + (i + 1) + '. ' + esc(r[0]) + '</b><br>' + esc(r[1]) + '</p>').join('');
  const famHtml = fam.map((f) => '<p style="margin:0 0 8px"><b>' + esc(f.label) + ':</b> ' + f.terms.map(esc).join(', ') + '</p>').join('');
  const html = WRAP_OPEN
    + '<p>' + hi + '</p>'
    + '<p>You are confirmed. Here is the checklist. The first openings digest arrives on Monday morning, Nairobi time.</p>'
    + '<h3 style="margin:24px 0 10px;font-family:Poppins,Arial,sans-serif">Six rules that parse cleanly in every system we track</h3>'
    + rulesHtml
    + '<p style="background:#f0f4f8;padding:12px 14px;border-radius:10px"><b>The 60-second test.</b> ' + esc(CHECKLIST.test) + '</p>'
    + '<h3 style="margin:24px 0 6px;font-family:Poppins,Arial,sans-serif">Keywords that recur in current postings</h3>'
    + '<p style="font-size:13px;color:#4a5568;margin:0 0 12px">Use only the ones you have genuinely used. Matching is literal, so copy the posting\'s own spelling.</p>'
    + famHtml
    + '<p style="margin-top:24px">The full guide, with the seven systems and a copy-paste CV skeleton, is at <a href="' + SITE + '/cv-pack/">thetechhut.co/cv-pack</a>.</p>'
    + '<p style="font-size:13px;color:#4a5568">Every digest has an unsubscribe link at the bottom, and one click removes you.</p>'
    + WRAP_CLOSE;
  const text = hiText + '\n\nYou are confirmed. Here is the checklist. The first openings digest arrives on Monday morning, Nairobi time.\n\n'
    + 'SIX RULES THAT PARSE CLEANLY IN EVERY SYSTEM WE TRACK\n'
    + rules.map((r, i) => (i + 1) + '. ' + r[0] + '\n   ' + r[1]).join('\n') + '\n\n'
    + 'THE 60-SECOND TEST\n' + CHECKLIST.test + '\n\n'
    + 'KEYWORDS THAT RECUR IN CURRENT POSTINGS (use only ones you have genuinely used; copy the posting\'s own spelling)\n'
    + fam.map((f) => f.label + ': ' + f.terms.join(', ')).join('\n') + '\n\n'
    + 'The full guide: ' + SITE + '/cv-pack/\n\nEvery digest has an unsubscribe link at the bottom, and one click removes you.\n';
  return { subject: 'Your CV keyword checklist', html, text };
}

async function sendMail(env, to, name, mail, tag) {
  return brevo('/smtp/email', env, {
    method: 'POST',
    body: JSON.stringify({
      sender: sender(env),
      to: [name ? { email: to, name } : { email: to }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
      tags: [tag],
    }),
  });
}

/* --------------------------------------------------------------- handlers */

async function subscribe(req, env, origin, deps, now) {
  const { json, validEmail } = deps;
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad request' }, 400, origin); }
  body = body || {};

  // Honeypot: a field no human sees. A bot fills it; we pretend it worked.
  if (typeof body.website === 'string' && body.website.trim() !== '') return json({ ok: true }, 200, origin);

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!validEmail(email)) return json({ error: 'a valid email is required' }, 400, origin);

  if (!newsletterConfigured(env)) return json({ error: 'signup is not switched on yet' }, 503, origin);

  const name = clean(body.name, 60);
  const role = clean(body.role, 80);
  const token = await signToken({ e: email, n: name, r: role, s: 'cv-pack', x: now + TOKEN_TTL_MS }, env.SUBSCRIBE_SECRET);
  const link = SITE + '/cv-pack/welcome/#t=' + token;

  const sent = await sendMail(env, email, name, confirmEmail(link, name), 'cv-pack-confirm');
  if (!sent.ok) return json({ error: 'could not send the confirmation email' }, 502, origin);
  return json({ ok: true }, 200, origin);
}

async function confirm(req, env, origin, deps, now) {
  const { json, safeEqual } = deps;
  if (!newsletterConfigured(env)) return json({ error: 'signup is not switched on yet' }, 503, origin);
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad request' }, 400, origin); }

  const v = await verifyToken(body && body.t, env.SUBSCRIBE_SECRET, now, safeEqual);
  if (!v.ok) return json({ error: v.reason }, 400, origin);
  const { e: email, n: name, r: role, s: source } = v.payload;

  const listId = Number(env.BREVO_LIST_ID);
  if (!Number.isInteger(listId) || listId < 1) return json({ error: 'signup is not switched on yet' }, 503, origin);

  // Confirming is explicit consent, so emailBlacklisted:false also re-enables
  // someone who unsubscribed earlier and has now chosen to come back.
  const make = (attributes) => brevo('/contacts', env, {
    method: 'POST',
    body: JSON.stringify({ email, attributes, listIds: [listId], updateEnabled: true, emailBlacklisted: false }),
  });
  const attrs = {};
  if (name) attrs.FIRSTNAME = name;
  let r = await make({ ...attrs, ...(role ? { ROLE: role } : {}), SOURCE: source || 'cv-pack' });
  // ROLE and SOURCE are custom attributes that must exist in Brevo. If they do
  // not, Brevo answers 400; the person is still worth adding without them.
  if (r.status === 400) r = await make(attrs);
  if (!r.ok) return json({ error: 'could not save your signup' }, 502, origin);

  // Best effort: being on the list matters more than the welcome email.
  try { await sendMail(env, email, name, welcomeEmail(name), 'cv-pack-welcome'); } catch (e) { /* ignore */ }
  return json({ ok: true }, 200, origin);
}

/** Returns a Response for /subscribe and /confirm, or null for anything else. */
export async function handleNewsletter(req, env, url, origin, deps, now = Date.now()) {
  if (req.method !== 'POST') return null;
  if (url.pathname === '/subscribe') return subscribe(req, env, origin, deps, now);
  if (url.pathname === '/confirm') return confirm(req, env, origin, deps, now);
  return null;
}
