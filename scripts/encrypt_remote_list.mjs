#!/usr/bin/env node
/*
 * Encrypt the paid Remote-From-Kenya List for publishing.
 *
 * scripts/fetch_jobs_snapshot.py writes the full list (every role and its apply
 * link) in plain text to REMOTE_LIST_PLAIN, a temp file on the GitHub Actions
 * runner. This encrypts it with AES-256-GCM into data/remote-list.enc.json,
 * which is committed and deployed, and deletes the plain copy. The key is the
 * REMOTE_LIST_KEY secret (GitHub Actions, and the Worker that hands buyers their
 * link). A buyer's link is
 *
 *   https://thetechhut.co/remote/list/#<key>
 *
 * and /remote/list/ decrypts the list in their browser. The fragment after #
 * never reaches a server, so neither the public repo nor the site holds a
 * readable copy. Same scheme as the community database (build_communities.mjs).
 *
 *   node scripts/encrypt_remote_list.mjs --new-key   print a fresh key and its link
 *   REMOTE_LIST_KEY=… REMOTE_LIST_PLAIN=… node scripts/encrypt_remote_list.mjs
 *
 * A missing key or list is a warning, not a failure: the rest of the daily run
 * (summary, jobs board) must still deploy.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'remote-list.enc.json');
const b64u = (buf) => Buffer.from(buf).toString('base64url');

if (process.argv.includes('--new-key')) {
  const k = b64u(crypto.getRandomValues(new Uint8Array(32)));
  console.log('New key (set it as REMOTE_LIST_KEY in GitHub Actions secrets AND on the Worker):\n' + k);
  console.log('\nBuyers\' link:\nhttps://thetechhut.co/remote/list/#' + k);
  process.exit(0);
}

const key = (process.env.REMOTE_LIST_KEY || '').trim();
const plain = (process.env.REMOTE_LIST_PLAIN || '').trim();
if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
  console.log('!! REMOTE_LIST_KEY missing or not a 43-character key: the paid list was NOT updated.\n' +
              '   Make one with: node scripts/encrypt_remote_list.mjs --new-key');
  process.exit(0);
}
if (!plain || !existsSync(plain)) {
  console.log('!! No plain list at REMOTE_LIST_PLAIN: the paid list was NOT updated.');
  process.exit(0);
}

const text = readFileSync(plain, 'utf8');
const data = JSON.parse(text);
const k = await crypto.subtle.importKey('raw', Buffer.from(key, 'base64url'), 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text));
writeFileSync(OUT, JSON.stringify({ v: 1, alg: 'AES-GCM', iv: b64u(iv), ct: b64u(ct), updated: data.updated || null }) + '\n');
try { unlinkSync(plain); } catch (e) { /* the runner is thrown away anyway */ }
console.log('paid list encrypted to data/remote-list.enc.json (' + (data.company_count || 0) + ' companies, ' + (data.role_count || 0) + ' roles)');
