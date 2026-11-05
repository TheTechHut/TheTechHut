#!/usr/bin/env node
/**
 * Email the African Tech Community Database link to everyone who has already
 * bought it. New buyers get it automatically (src/index.js, /verify and the
 * webhook); this is for the people who paid before that existed.
 *
 * Reads the successful transactions from Paystack and picks the community
 * database orders, then sends each buyer the same receipt the Worker sends.
 * Runs on your own computer; the keys come from your environment and are never
 * written anywhere.
 *
 *   cd worker
 *   export PAYSTACK_SECRET_KEY=sk_live_...        # Paystack -> Settings -> API Keys
 *   export BREVO_API_KEY=xkeysib-...              # Brevo -> SMTP & API -> API keys
 *   export BREVO_SENDER_EMAIL=info@thetechhut.co  # the verified sender
 *   export COMMUNITIES_URL='https://thetechhut.co/communities/db/#...'  # from scripts/build_communities.mjs
 *   node scripts/send-communities-access.mjs           # dry run: lists who would get it
 *   node scripts/send-communities-access.mjs --send    # sends
 *
 * Each address is sent to once, even if they bought twice. A list of the
 * addresses already sent is kept in scripts/.communities-sent.json (not
 * committed), so running it again only reaches new buyers.
 * Successful KSh 250 payments with no product attached (for example, paid
 * through a Paystack payment page) are listed separately for you to check,
 * and are only sent with --include-unlabelled.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deliveryFor, receiptEmail, communitiesUrl, sendReceipt } from '../src/index.js';

const SEND = process.argv.includes('--send');
const UNLABELLED = process.argv.includes('--include-unlabelled');
const env = process.env;
const LOG = join(dirname(fileURLToPath(import.meta.url)), '.communities-sent.json');

function need(k) { if (!env[k]) { console.error('Set ' + k + ' first (see the top of this file).'); process.exit(1); } }
need('PAYSTACK_SECRET_KEY'); need('COMMUNITIES_URL');
if (!communitiesUrl(env)) { console.error('COMMUNITIES_URL must be the members page link (https://thetechhut.co/communities/db/#…) or a notion.site page.'); process.exit(1); }
if (SEND) { need('BREVO_API_KEY'); need('BREVO_SENDER_EMAIL'); }
delete env.RESEND_API_KEY;                       // this script sends through Brevo

async function paystack(path) {
  const r = await fetch('https://api.paystack.co' + path, { headers: { Authorization: 'Bearer ' + env.PAYSTACK_SECRET_KEY } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.status) throw new Error('Paystack ' + r.status + ': ' + (b.message || 'error'));
  return b;
}

const buyers = new Map(), unlabelled = new Map();
for (let page = 1; page < 200; page++) {
  const b = await paystack('/transaction?status=success&perPage=100&page=' + page);
  for (const t of b.data || []) {
    const email = t.customer && t.customer.email && t.customer.email.trim().toLowerCase();
    if (!email || t.currency !== 'KES') continue;
    const m = t.metadata && typeof t.metadata === 'object' ? t.metadata : {};
    const isDb = m.product === 'communities' || /communit/i.test(m.product_name || '');
    if (isDb && Number(t.amount) >= 25000) { if (!buyers.has(email)) buyers.set(email, t); }
    else if (!m.product && Number(t.amount) === 25000 && !unlabelled.has(email)) unlabelled.set(email, t);
  }
  const meta = b.meta || {};
  if (!b.data || !b.data.length || (meta.pageCount && page >= meta.pageCount)) break;
}
for (const e of buyers.keys()) unlabelled.delete(e);

const sent = new Set(existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : []);
const day = (t) => String(t.paid_at || t.created_at || '').slice(0, 10);
const todo = [...buyers].concat(UNLABELLED ? [...unlabelled] : []).filter(([e]) => !sent.has(e));

console.log(`\n${buyers.size} community database buyer(s) found in Paystack.`);
for (const [e, t] of buyers) console.log(`  ${sent.has(e) ? 'already sent ' : '             '} ${day(t)}  ${e}  ${t.reference}`);
if (unlabelled.size) {
  console.log(`\n${unlabelled.size} other successful KSh 250 payment(s) with no product attached (also KSh 250: CV Blueprint, Early Access monthly):`);
  for (const [e, t] of unlabelled) console.log(`  ${sent.has(e) ? 'already sent ' : '             '} ${day(t)}  ${e}  ${t.reference}`);
  if (!UNLABELLED) console.log('  Not included. Add --include-unlabelled to send to these too.');
}
const mail = receiptEmail('communities', deliveryFor('communities', env), 'REFERENCE');
console.log(`\nSubject: ${mail.subject}\n${mail.text.replace('REFERENCE', '<their reference>')}\n`);

if (!SEND) { console.log(`Dry run: ${todo.length} email(s) would be sent. Add --send to send them.`); process.exit(0); }

let ok = 0;
for (const [email, t] of todo) {
  const done = await sendReceipt(env, email, 'communities', deliveryFor('communities', env), t.reference);
  console.log((done ? '  sent    ' : '  FAILED  ') + email);
  if (done) { ok++; sent.add(email); writeFileSync(LOG, JSON.stringify([...sent], null, 1)); }
  await new Promise((r) => setTimeout(r, 300));    // stay well under Brevo's rate limit
}
console.log(`\n${ok} of ${todo.length} sent.`);
