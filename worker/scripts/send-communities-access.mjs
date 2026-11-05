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
 * --product remote-list does the same for the Remote-From-Kenya List (and the
 * Job Hunt Bundle, which includes it), after its key changes: set
 * REMOTE_LIST_KEY instead of COMMUNITIES_URL. It sends to every buyer, since
 * their old links have stopped working.
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
const pi = process.argv.indexOf('--product');
const PRODUCT = pi > -1 ? process.argv[pi + 1] : 'communities';
// Which orders count, and the price of an order with no product attached.
const SETUP = {
  communities: { products: ['communities'], kes: 250, label: /communit/i },
  'remote-list': { products: ['remote-list', 'bundle'], kes: 500, label: /remote|job hunt bundle/i },
}[PRODUCT];
if (!SETUP) { console.error('--product must be communities or remote-list'); process.exit(1); }
const env = process.env;
const LOG = join(dirname(fileURLToPath(import.meta.url)), PRODUCT === 'communities' ? '.communities-sent.json' : '.' + PRODUCT + '-sent.json');

function need(k) { if (!env[k]) { console.error('Set ' + k + ' first (see the top of this file).'); process.exit(1); } }
need('PAYSTACK_SECRET_KEY');
if (PRODUCT === 'communities') {
  need('COMMUNITIES_URL');
  if (!communitiesUrl(env)) { console.error('COMMUNITIES_URL must be the members page link (https://thetechhut.co/communities/db/#…) or a notion.site page.'); process.exit(1); }
} else {
  need('REMOTE_LIST_KEY');
  if (!/^[A-Za-z0-9_-]{43}$/.test(env.REMOTE_LIST_KEY.trim())) { console.error('REMOTE_LIST_KEY must be the 43-character key.'); process.exit(1); }
}
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
    const product = SETUP.products.includes(m.product) ? m.product : (!m.product && SETUP.label.test(m.product_name || '') ? SETUP.products[0] : null);
    if (product && Number(t.amount) >= SETUP.kes * 100) { if (!buyers.has(email)) buyers.set(email, { ...t, _product: product }); }
    else if (!m.product && Number(t.amount) === SETUP.kes * 100 && !unlabelled.has(email)) unlabelled.set(email, { ...t, _product: SETUP.products[0] });
  }
  const meta = b.meta || {};
  if (!b.data || !b.data.length || (meta.pageCount && page >= meta.pageCount)) break;
}
for (const e of buyers.keys()) unlabelled.delete(e);

const sent = new Set(existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : []);
const day = (t) => String(t.paid_at || t.created_at || '').slice(0, 10);
const todo = [...buyers].concat(UNLABELLED ? [...unlabelled] : []).filter(([e]) => !sent.has(e));

console.log(`\n${buyers.size} ${PRODUCT} buyer(s) found in Paystack.`);
for (const [e, t] of buyers) console.log(`  ${sent.has(e) ? 'already sent ' : '             '} ${day(t)}  ${e}  ${t.reference}`);
if (unlabelled.size) {
  console.log(`\n${unlabelled.size} other successful KSh ${SETUP.kes} payment(s) with no product attached (check by hand: other products may cost the same):`);
  for (const [e, t] of unlabelled) console.log(`  ${sent.has(e) ? 'already sent ' : '             '} ${day(t)}  ${e}  ${t.reference}`);
  if (!UNLABELLED) console.log('  Not included. Add --include-unlabelled to send to these too.');
}
const mail = receiptEmail(SETUP.products[0], deliveryFor(SETUP.products[0], env), 'REFERENCE');
console.log(`\nSubject: ${mail.subject}\n${mail.text.replace('REFERENCE', '<their reference>')}\n`);

if (!SEND) { console.log(`Dry run: ${todo.length} email(s) would be sent. Add --send to send them.`); process.exit(0); }

let ok = 0;
for (const [email, t] of todo) {
  const done = await sendReceipt(env, email, t._product, deliveryFor(t._product, env), t.reference);
  console.log((done ? '  sent    ' : '  FAILED  ') + email);
  if (done) { ok++; sent.add(email); writeFileSync(LOG, JSON.stringify([...sent], null, 1)); }
  await new Promise((r) => setTimeout(r, 300));    // stay well under Brevo's rate limit
}
console.log(`\n${ok} of ${todo.length} sent.`);
