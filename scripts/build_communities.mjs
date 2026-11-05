#!/usr/bin/env node
/*
 * Build the paid African Tech Community Database page's data.
 *
 * The source is the Notion export, kept out of git in private/ (this repo is
 * public, and the list is what people pay for). This script reads it, files
 * each community under a topic, drops repeats, and writes it ENCRYPTED to
 * data/communities.enc.json, which is safe to commit and deploy. The key never
 * leaves private/ and the Worker's COMMUNITIES_URL secret:
 *
 *   https://thetechhut.co/communities/db/#<key>
 *
 * The key travels in the URL fragment, which browsers never send to a server,
 * and /communities/db/ decrypts the list in the buyer's browser.
 *
 * To update the list: export the Notion page as Markdown, save it as
 * private/communities-export.md, run this, commit data/communities.enc.json.
 * The access link stays the same.
 *
 * If the link leaks, rotate it: run with --new-key, commit, set the new link
 * on the Worker (npx wrangler secret put COMMUNITIES_URL), then email buyers the
 * new link (worker/scripts/send-communities-access.mjs). Old links stop working.
 *
 *   node scripts/build_communities.mjs            build with the existing key
 *   node scripts/build_communities.mjs --new-key  build with a fresh key
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'private', 'communities-export.md');
const KEYFILE = join(ROOT, 'private', 'communities_key.txt');
const OUT = join(ROOT, 'data', 'communities.enc.json');
const SITE = 'https://thetechhut.co/communities/db/';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/* ------------------------------------------------------------------ parse */

// The first topic whose pattern matches the TITLE wins; if none does, the first
// to match the description. Specific topics come before broad ones.
export const TOPICS = [
  ['General tech', /\bict\b|planet tech|tech kenya|techwithtwin|immortal connect/i],
  ['Cybersecurity', /cyber|\bctf\b|bug bounty|forensic|hacking/i],
  ['Hardware & makers', /arduino|mechatronic|robot|embedded|\biot\b/i],
  ['Cloud & DevOps', /\baws\b|devops|kubernetes|cloud computing/i],
  ['Languages & frameworks', /\brust\b|gophers|golang|\bgo lang|\bzig\b|ziguanas|\bjava\b|spring|flutter|react|angular|typescript|javascript|node ?js|django|flask|python|laravel|\.net\b|\bios\b|data structures|crack ?mode/i],
  ['AI & data', /\bai\b|artificial intelligence|machine learning|\bdata\b/i],
  ['Startups & funding', /startup|fund|founder|\bceos?\b|entrepreneur|investor|\bvcs?\b|indie makers|impact360|forge|builders|bugs or features|kuzana/i],
  ['Jobs & opportunities', /\bjobs?\b|hire|hiring|opportunit|fellowship|scholarship|career|humanitarian|udemy|empower/i],
  ['Design & marketing', /design|marketing|\bseo\b/i],
  ['Hackathons & events', /hackathon|events?\b|workshop|training/i],
];
const OTHER = 'General tech';

function platform(url) {
  const h = new URL(url).hostname.replace(/^www\./, '');
  if (h === 'chat.whatsapp.com') return 'WhatsApp group';
  if (h === 'whatsapp.com' && /\/channel\//.test(url)) return 'WhatsApp channel';
  if (h === 't.me') return 'Telegram';
  if (h === 'linktr.ee') return 'Linktree';
  return h;
}
const ALLOWED = /^(chat\.whatsapp\.com|(www\.)?whatsapp\.com|t\.me|linktr\.ee)$/;

function niceTitle(t) {
  t = t.replace(/\*\*/g, '').replace(/^\s*\d+(\.\d+)?\s*\.?\s*/, '').replace(/\s+/g, ' ').trim();
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    t = t.toLowerCase().replace(/(^|[\s(&/-])([a-z])/g, (m, a, c) => a + c.toUpperCase())
      .replace(/\b(Ict|Ai|Ngo|Ku|Seo|Ke|Alx|Usa|Ctf|Ts)\b/g, (w) => w.toUpperCase());
  }
  return t.replace(/\bAdruino\b/, 'Arduino').replace(/\bios\b/i, 'iOS').replace(/(^|\s)\.net\b/i, '$1.NET');
}

const LABEL = /^(\d+(\.\d+)*\s*)?\**\s*(whatsapp( group)?|telegram( group)?|link ?tree|channel|group)\s*\**\s*:?$/i;

export function parse(md) {
  const blocks = md.split(/^## /m).slice(1);
  const seen = new Set();
  const items = [];
  for (const b of blocks) {
    const lines = b.split('\n');
    const title = niceTitle(lines[0]);
    const links = [];
    const text = [];
    for (const raw of lines.slice(1)) {
      const line = raw.trim();
      if (!line) { text.push(''); continue; }
      const m = [...line.matchAll(/\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g)];
      if (m.length) {
        for (const [, label, url] of m) {
          let u;
          try { u = new URL(url); } catch (e) { continue; }
          if (!ALLOWED.test(u.hostname)) continue;
          const clean = u.origin + u.pathname.replace(/\/+$/, '');
          if (seen.has(clean)) continue;
          seen.add(clean);
          const sub = label.startsWith('http') ? '' : label.replace(/\s+/g, ' ').replace(/\s*\|\s*(whatsapp channel|linktree|-)\s*$/i, '')
            .replace(/^\d+\.\s*/, '').replace(/["”]+$/, '').trim();
          links.push({ kind: platform(clean), url: clean, name: sub });
        }
        continue;
      }
      if (/^###\s/.test(line)) { text.push(''); links.push({ heading: niceTitle(line.replace(/^###\s*/, '')) }); continue; }
      if (LABEL.test(line) || /^🔗/.test(line)) continue;
      text.push(line.replace(/\*\*/g, ''));
    }
    // A sub-heading only matters if a link follows it.
    const out = [];
    for (let i = 0; i < links.length; i++) {
      if (links[i].heading) { if (links[i + 1] && !links[i + 1].heading) links[i + 1].name = links[i].heading; continue; }
      out.push(links[i]);
    }
    if (!out.length) continue;                   // every link was a repeat of an earlier entry
    const desc = text.join('\n').split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n\n');
    const hay = title + ' ' + desc + ' ' + out.map((l) => l.name).join(' ');
    const topic = (TOPICS.find(([, re]) => re.test(title)) || TOPICS.find(([, re]) => re.test(hay)) || [OTHER])[0];
    items.push({ title, desc, topic, links: out });
  }
  return items;
}

/* ---------------------------------------------------------------- encrypt */

async function encrypt(obj, keyBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, alg: 'AES-GCM', iv: b64u(iv), ct: b64u(ct) };
}

async function main() {
  if (!existsSync(SRC)) { console.error('Missing ' + SRC + ': export the Notion page as Markdown and save it there.'); process.exit(1); }
  const items = parse(readFileSync(SRC, 'utf8'));
  mkdirSync(dirname(KEYFILE), { recursive: true });
  let key;
  if (process.argv.includes('--new-key') || !existsSync(KEYFILE)) {
    key = crypto.getRandomValues(new Uint8Array(32));
    writeFileSync(KEYFILE, b64u(key) + '\n', { mode: 0o600 });
    console.log('New key written to private/communities_key.txt');
  } else {
    key = Buffer.from(readFileSync(KEYFILE, 'utf8').trim(), 'base64url');
    if (key.length !== 32) { console.error('private/communities_key.txt is not a 32-byte key.'); process.exit(1); }
  }
  const updated = new Date().toISOString().slice(0, 10);
  const topics = [...new Set([...TOPICS.map(([t]) => t), OTHER])].filter((t) => items.some((i) => i.topic === t));
  const payload = { updated, count: items.length, topics, items };
  const box = await encrypt(payload, key);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ ...box, updated }) + '\n');
  const per = Object.fromEntries(topics.map((t) => [t, items.filter((i) => i.topic === t).length]));
  console.log(`${items.length} communities, ${items.reduce((n, i) => n + i.links.length, 0)} links, encrypted to data/communities.enc.json`);
  console.log(per);
  console.log('\nAccess link (the Worker secret COMMUNITIES_URL):\n' + SITE + '#' + b64u(key));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
