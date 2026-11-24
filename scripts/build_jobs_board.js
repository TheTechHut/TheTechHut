#!/usr/bin/env node
/*
 * Build /data/jobs-board.json: every role the jobs board shows, read from all
 * its feeds in one go, so a visitor's browser downloads one small file instead
 * of making ~45 requests for several megabytes of JSON (Pinpoint, Lever and
 * Ashby send full job descriptions the board never shows).
 *
 * The feeds, parsers and filters are the page's own (assets/js/jobs-feeds.js),
 * so the file holds exactly what the page would have built live.
 *
 * Runs on GitHub Actions every few hours (.github/workflows/jobs-board.yml)
 * and before the daily snapshot's deploy. The file is not committed: it is
 * written into the checkout and deployed with it. If it is missing or stale,
 * the page reads the feeds live, as it always did.
 *
 *   node scripts/build_jobs_board.js            writes data/jobs-board.json
 *
 * Exits non-zero, writing nothing, when too few roles came back (a network
 * problem), so a bad run never replaces a good file.
 *
 * An employer whose hiring system does not answer (a timeout, an outage) would
 * otherwise vanish from the board, and every link already shared to its role
 * pages would break. So when an employer returns nothing, its roles from the
 * previous build (read from the live site, or PREV_BOARD for a local file) are
 * kept for up to HOLD_DAYS since the employer last confirmed them, unless their
 * closing date has passed. Each role carries `checked`, the last time its
 * employer's feed listed it. Held roles keep their description: it is read back
 * from their live role page.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var F = require('../assets/js/jobs-feeds.js');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'data', 'jobs-board.json');
// Full descriptions for the role pages (scripts/build_job_pages.js). Dot-prefixed
// so firebase.json's "**/.*" keeps it off the site and .gitignore keeps it out of git.
var BODIES = path.join(ROOT, '.job-bodies.json');
var MIN_ROLES = 50;
var HOLD_DAYS = 3;
var PREV_URL = 'https://thetechhut.co/data/jobs-board.json';
var UA = 'TheTechHutBot/1.0 (+https://thetechhut.co/jobs/)';
// salary (free text, e.g. "USD 160,000 – 200,000/year"), deadline (ISO date the
// posting closes) and workplace ("On-site", "Hybrid" or "Remote") are present only
// when the source states them; the WhatsApp channel posts read them from here.
var KEEP = ['id', 'title', 'company', 'logo', 'location', 'where', 'types', 'cats', 'level', 'excerpt', 'url', 'date',
            'salary', 'deadline', 'workplace', 'source', 'region', '_tags', 'checked', 'page'];

function slim(j) {
  var o = {};
  KEEP.forEach(function (k) {
    var v = j[k];
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
    o[k] = v;
  });
  return o;
}

// SmartRecruiters and Workable list their openings without any text. For the
// roles that get a page (open to Kenya, remote or Africa) fetch the one posting
// for its description, a few at a time. A posting that does not answer just keeps
// no description: the page falls back to the title and the apply link.
var PAGE_REGIONS = { Kenya: 1, Remote: 1, 'Rest of Africa': 1 };
function detailBody(url, d) {
  if (/smartrecruiters/.test(url)) {
    var sec = (d && d.jobAd && d.jobAd.sections) || {};
    return ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map(function (k) { return sec[k] && sec[k].text ? (sec[k].title ? '<h3>' + sec[k].title + '</h3>' : '') + sec[k].text : ''; }).join('');
  }
  return [d && d.description, d && d.requirements, d && d.benefits].filter(Boolean).join('');
}
async function addDetails(jobs) {
  var todo = jobs.filter(function (j) { return j.detail && !j.body && PAGE_REGIONS[j.region]; });
  var got = 0, next = 0;
  async function worker() {
    while (next < todo.length) {
      var j = todo[next++];
      try {
        var r = await fetch(j.detail, { headers: { 'User-Agent': 'TheTechHutBot/1.0 (+https://thetechhut.co/jobs/)', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) continue;
        var d = await r.json();
        j.body = detailBody(j.detail, d);
        // Workable's list only flags remote roles; the posting says "on_site" or "hybrid" too
        if (!j.workplace && d && d.workplace) j.workplace = F.workplaceOf(d.workplace);
        if (j.body) { j.excerpt = F.clean(j.body, 190); got++; }
      } catch (e) { /* keep the role without a description */ }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log('role descriptions fetched one by one: %d of %d', got, todo.length);
}

// The board as last deployed: { jobs: [...] }, or null if it cannot be read.
async function previousBoard() {
  try {
    if (process.env.PREV_BOARD) return JSON.parse(fs.readFileSync(process.env.PREV_BOARD, 'utf8'));
    var r = await fetch(PREV_URL + '?t=' + Date.now(), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

// The description already published on a held role's page, so it is not lost
// while its employer is not answering. Already cleaned by build_job_pages.js.
async function heldBody(slug) {
  if (!slug || process.env.PREV_BOARD) return '';
  try {
    var r = await fetch('https://thetechhut.co/jobs/role/' + slug + '/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return '';
    var m = /<div class="role-body">([\s\S]*?)<\/div>\n  <p><a class="btn"/.exec(await r.text());
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

// Roles of employers that returned nothing this run, carried over from the last
// build while recent enough. `silent` is the employers with no roles this run.
function heldRoles(prev, silent, now) {
  if (!prev || !Array.isArray(prev.jobs)) return [];
  var quiet = {}, today = now.toISOString().slice(0, 10), oldest = now.getTime() - HOLD_DAYS * 864e5;
  silent.forEach(function (n) { quiet[n] = 1; });
  return prev.jobs.filter(function (j) {
    if (!j || !quiet[j.source] || !j.id || !j.title || !/^https:\/\//.test(j.url || '')) return false;
    if (j.deadline && String(j.deadline).slice(0, 10) < today) return false;
    var checked = Date.parse(j.checked || prev.updated || '');
    return checked >= oldest;
  }).map(function (j) {
    var o = Object.assign({}, j);
    if (!o.checked) o.checked = prev.updated;
    return o;
  });
}

async function main() {
  var t0 = Date.now();
  var jobs = await F.load({ timeoutMs: 25000, headers: { 'User-Agent': 'TheTechHutBot/1.0 (+https://thetechhut.co/jobs/)' } });
  jobs = jobs.filter(function (j) { return j.title && /^https:\/\//.test(j.url || ''); });
  await addDetails(jobs);
  var bodies = {};
  jobs.forEach(function (j) { if (j.body) bodies[j.id] = j.body; });
  var now = new Date();
  jobs = jobs.map(function (j) { j.checked = now.toISOString(); return slim(j); });
  var by = {};
  jobs.forEach(function (j) { by[j.source] = (by[j.source] || 0) + 1; });
  var silent = F.COMPANIES.map(function (c) { return c.name; }).filter(function (n) { return !by[n]; });
  console.log('jobs board: %d roles from %d sources in %ds', jobs.length, Object.keys(by).length, Math.round((Date.now() - t0) / 1000));
  if (silent.length) console.log('  no tech roles today (or no answer): ' + silent.join(', '));
  var held = heldRoles(await previousBoard(), silent, now);
  if (held.length) {
    for (var h = 0; h < held.length; h++) {
      var b = await heldBody(held[h].page);
      if (b) bodies[held[h].id] = { clean: b };
    }
    var heldFrom = {};
    held.forEach(function (j) { heldFrom[j.source] = (heldFrom[j.source] || 0) + 1; });
    console.log('  held over from the last build (no answer this time): ' +
      Object.keys(heldFrom).map(function (n) { return n + ' ' + heldFrom[n]; }).join(', '));
    jobs = jobs.concat(held.map(slim));
  }
  if (jobs.length < MIN_ROLES) {
    console.error('only %d roles came back; not writing %s', jobs.length, path.relative(ROOT, OUT));
    process.exit(1);
  }
  var out = { updated: new Date().toISOString(), count: jobs.length, jobs: jobs };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  fs.writeFileSync(BODIES, JSON.stringify(bodies));
  console.log('wrote %s (%d KB)', path.relative(ROOT, OUT), Math.round(fs.statSync(OUT).size / 1024));
}

if (require.main === module) main().catch(function (e) { console.error(e); process.exit(1); });
module.exports = { heldRoles: heldRoles, HOLD_DAYS: HOLD_DAYS };
