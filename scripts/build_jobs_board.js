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

async function main() {
  var t0 = Date.now();
  var jobs = await F.load({ timeoutMs: 25000, headers: { 'User-Agent': 'TheTechHutBot/1.0 (+https://thetechhut.co/jobs/)' } });
  jobs = jobs.filter(function (j) { return j.title && /^https:\/\//.test(j.url || ''); }).map(slim);
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
  console.log('wrote %s (%d KB)', path.relative(ROOT, OUT), Math.round(fs.statSync(OUT).size / 1024));
}

main().catch(function (e) { console.error(e); process.exit(1); });
