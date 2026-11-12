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
var KEEP = ['id', 'title', 'company', 'logo', 'location', 'where', 'types', 'cats', 'level', 'excerpt', 'url', 'date', 'source', 'region', '_tags'];

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
        j.body = detailBody(j.detail, await r.json());
        if (j.body) { j.excerpt = F.clean(j.body, 190); got++; }
      } catch (e) { /* keep the role without a description */ }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log('role descriptions fetched one by one: %d of %d', got, todo.length);
}

async function main() {
  var t0 = Date.now();
  var jobs = await F.load({ timeoutMs: 25000, headers: { 'User-Agent': 'TheTechHutBot/1.0 (+https://thetechhut.co/jobs/)' } });
  jobs = jobs.filter(function (j) { return j.title && /^https:\/\//.test(j.url || ''); });
  await addDetails(jobs);
  var bodies = {};
  jobs.forEach(function (j) { if (j.body) bodies[j.id] = j.body; });
  jobs = jobs.map(slim);
  var by = {};
  jobs.forEach(function (j) { by[j.source] = (by[j.source] || 0) + 1; });
  var silent = F.COMPANIES.map(function (c) { return c.name; }).filter(function (n) { return !by[n]; });
  console.log('jobs board: %d roles from %d sources in %ds', jobs.length, Object.keys(by).length, Math.round((Date.now() - t0) / 1000));
  if (silent.length) console.log('  no tech roles today (or no answer): ' + silent.join(', '));
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

main().catch(function (e) { console.error(e); process.exit(1); });
