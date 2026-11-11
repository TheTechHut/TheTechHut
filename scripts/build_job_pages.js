#!/usr/bin/env node
/*
 * One static, indexable page per role: /jobs/role/<slug>/, plus
 * /jobs/role/sitemap.xml. /jobs/ itself is built in the browser and its detail
 * view lives behind a #hash, which search engines ignore, so before this no job
 * had a URL of its own and none could appear in Google for Jobs.
 *
 * Reads data/jobs-board.json (scripts/build_jobs_board.js, which must run first)
 * and writes into jobs/role/, which is built on GitHub Actions and deployed,
 * never committed (see .gitignore).
 *
 * Which roles get a page:
 *   - read straight from the employer's own hiring system. Jobicy and Remote OK
 *     rows are left out: their terms ask for a credit and a link to their own
 *     listing, so those roles stay in the list and link there.
 *   - open to Kenya, remote, or elsewhere in Africa. A page for a role a Kenyan
 *     cannot take would be thin and would not help the visitor.
 *
 * Only roles whose feed gives a real description are indexed (indexable, in the
 * sitemap, with JobPosting markup): Google requires a description and a page
 * with none is thin. The rest still get a page, marked noindex, so a link to
 * them works; most feeds do not send a description yet (jobs-feeds.js drops it
 * to keep jobs-board.json small), which is the next thing to fix.
 *
 * Each role's slug is also written back to jobs-board.json as `page`, so the
 * list on /jobs/ links to its page instead of the in-page #job= view.
 *
 * Every page links to the employer's own posting as the way to apply, and says
 * so. The description is the short excerpt the feed gives; no salary or closing
 * date is published unless a feed supplies one (none do yet), so none is made up.
 *
 *   node scripts/build_job_pages.js
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var BOARD = path.join(ROOT, 'data', 'jobs-board.json');
var OUT = path.join(ROOT, 'jobs', 'role');
var SITE = 'https://thetechhut.co';
var AGGREGATORS = /^(rok|jobicy)-/;
var REGIONS = { Kenya: 1, Remote: 1, 'Rest of Africa': 1 };
var MIN_PAGES = 20;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function slugOf(j) {
  var base = (j.title + ' ' + j.company).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
  var tail = j.id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-8);
  return base + '-' + tail;
}

function employmentType(types) {
  var t = (types || []).join(' ').toLowerCase();
  if (/part/.test(t)) return 'PART_TIME';
  if (/contract|freelance/.test(t)) return 'CONTRACTOR';
  if (/intern/.test(t)) return 'INTERN';
  if (/full/.test(t)) return 'FULL_TIME';
  return null;
}

function jsonLd(j, url) {
  var d = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: j.title,
    description: '<p>' + esc(j.excerpt) + '</p>',
    identifier: { '@type': 'PropertyValue', name: j.company, value: j.id },
    hiringOrganization: { '@type': 'Organization', name: j.company },
    url: url,
    directApply: false
  };
  if (j.date) d.datePosted = j.date.slice(0, 10);
  var et = employmentType(j.types);
  if (et) d.employmentType = et;
  // "Remote" here only means the location text says remote/anywhere/worldwide;
  // nothing says a Kenyan may take it. JobPosting needs the countries a remote
  // role is open to, so those pages get no markup rather than a guessed country.
  if (j.location) d.jobLocation = { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: j.location } };
  return JSON.stringify(d).replace(/</g, '\\u003c');
}

function page(j, slug) {
  var url = SITE + '/jobs/role/' + slug + '/';
  var where = j.region === 'Remote' ? 'Remote' + (j.location ? ' · ' + j.location : '') : (j.location || j.region);
  var title = j.title + ' at ' + j.company + ' — ' + where;
  var desc = j.title + ' at ' + j.company + ' (' + where + '). Apply on ' + j.company + '’s own careers page. Listed by The Tech Hut.';
  var posted = j.date ? new Date(j.date).toISOString().slice(0, 10) : '';
  var meta = [where, (j.types || [])[0], posted && 'Posted ' + posted].filter(Boolean);
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '  <title>' + esc(title) + ' | The Tech Hut</title>\n' +
    '  <meta name="description" content="' + esc(desc) + '">\n' +
    '  <meta name="robots" content="' + (j.excerpt && j.region !== 'Remote' ? 'index, follow, max-snippet:-1' : 'noindex, follow') + '">\n' +
    '  <link rel="canonical" href="' + url + '">\n' +
    '  <meta property="og:type" content="website">\n  <meta property="og:site_name" content="The Tech Hut">\n' +
    '  <meta property="og:title" content="' + esc(title) + '">\n  <meta property="og:description" content="' + esc(desc) + '">\n' +
    '  <meta property="og:url" content="' + url + '">\n' +
    '  <meta property="og:image" content="' + SITE + '/assets/img/social/jobs.jpg">\n  <meta name="twitter:card" content="summary_large_image">\n' +
    '  <link rel="stylesheet" href="/assets/css/thh.css">\n' +
    (j.excerpt && j.region !== 'Remote' ? '  <script type="application/ld+json">' + jsonLd(j, url) + '</script>\n' : '') +
    '</head>\n<body>\n<a class="skip" href="#main">Skip to content</a>\n' +
    '<header class="masthead"><div class="wrap masthead-main"><a class="wordmark" href="/">The Tech Hut<span class="dot">.</span></a>' +
    '<nav class="sitenav" aria-label="Site"><a href="/blog/daily/">Daily</a><a href="/jobs/" aria-current="page">Jobs</a><a href="/remote/">Remote</a><a href="/cv-pack/">CV Pack</a><a href="/blog/">Blog</a></nav></div></header>\n' +
    '<main id="main"><div class="wrap" style="max-width:760px;padding:40px 0 64px">\n' +
    '  <p><a href="/jobs/">&larr; All jobs</a></p>\n' +
    '  <h1>' + esc(j.title) + '</h1>\n' +
    '  <p class="lede">' + esc(j.company) + '</p>\n' +
    '  <p>' + meta.map(esc).join(' &middot; ') + '</p>\n' +
    (j.excerpt ? '  <p>' + esc(j.excerpt) + '</p>\n' : '') +
    '  <p><a class="btn" href="' + esc(j.url) + '" target="_blank" rel="noopener nofollow">Apply on ' + esc(j.company) + '’s careers page</a></p>\n' +
    '  <p style="font-size:14px">The full description and the application form are on ' + esc(j.company) + '’s own site. ' +
    (j.region === 'Remote' ? 'Remote roles often limit which countries can apply: check the list of eligible countries there. ' : '') +
    'The Tech Hut does not take applications, and no employer pays to be listed here. Check the closing date there before you apply.</p>\n' +
    '</div></main>\n</body>\n</html>\n';
}

function main() {
  var board = JSON.parse(fs.readFileSync(BOARD, 'utf8'));
  var rows = board.jobs.filter(function (j) {
    return !AGGREGATORS.test(j.id) && REGIONS[j.region] && j.title && j.company && /^https:\/\//.test(j.url || '');
  });
  if (rows.length < MIN_PAGES) {
    console.error('only %d eligible roles; leaving jobs/role untouched', rows.length);
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  var urls = [];
  rows.forEach(function (j) {
    var slug = slugOf(j);
    j.page = slug;   /* the list links here (jobs/index.html card) */
    var dir = path.join(OUT, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page(j, slug));
    if (j.excerpt && j.region !== 'Remote') urls.push({ loc: SITE + '/jobs/role/' + slug + '/', lastmod: (j.date || board.updated).slice(0, 10) });
  });
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(function (u) { return '  <url><loc>' + u.loc + '</loc><lastmod>' + u.lastmod + '</lastmod></url>'; }).join('\n') +
    '\n</urlset>\n');
  fs.writeFileSync(BOARD, JSON.stringify(board));
  console.log('job pages: %d written to %s', rows.length, path.relative(ROOT, OUT));
}

main();
