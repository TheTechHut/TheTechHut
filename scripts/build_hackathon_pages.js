#!/usr/bin/env node
/*
 * One static page per hackathon: /hackathons/event/<slug>/, each with its own
 * share image (card.png), plus /hackathons/event/sitemap.xml. The list on
 * /hackathons/ links to these pages (the `page` field in data/hackathons.json).
 *
 * Reads data/hackathons.json (scripts/build_hackathons.js) and writes into
 * hackathons/event/, which is built on GitHub Actions before every deploy and
 * never committed (see .gitignore), the same way jobs/role/ is.
 *
 * Every page shows what the organiser's listing states (dates, total prize,
 * each prize) and links to the organiser's own page as the place to enter.
 *
 * The share image is drawn by scripts/hackathon_card.js and needs `sharp` and
 * `opentype.js`. Without them the pages use the list's image instead.
 *
 *   node scripts/build_hackathon_pages.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var cards = require('./hackathon_card.js');

var ROOT = path.join(__dirname, '..');
var DATA = path.join(ROOT, 'data', 'hackathons.json');
var OUT = path.join(ROOT, 'hackathons', 'event');
var SITE = 'https://thetechhut.co';
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function day(d) { var p = d.split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
function period(h) { return h.starts === h.ends ? day(h.ends) : day(h.starts) + ' – ' + day(h.ends); }
// what the share image shows. A one-day hackathon gets its weekday ("Sat 14 Nov 2026");
// a longer one drops the first year when both dates share it ("30 Oct – 4 Dec 2026").
function cardOf(h) {
  var date = h.starts === h.ends ? DAYS[new Date(h.ends + 'T00:00:00Z').getUTCDay()] + ' ' + day(h.ends)
    : (h.starts.slice(0, 4) === h.ends.slice(0, 4) ? day(h.starts).slice(0, -5) : day(h.starts)) + ' – ' + day(h.ends);
  return {
    name: h.title, host: h.host, prize: h.prize || 'To be announced', date: date, where: h.place,
    registerBy: day(h.deadline), themes: h.themes, barLine: 'Register and submit on ' + h.source,
    link: h.url.replace(/^https:\/\/(www\.)?/, '').replace(/[/?#].*$/, '')
  };
}

function page(h, hasCard) {
  var url = SITE + '/hackathons/event/' + h.page + '/';
  var by = h.host ? ' by ' + h.host : '';
  var title = h.title + ' — ' + h.place + ' hackathon' + (h.prize ? ', ' + h.prize + ' in prizes' : '');
  var desc = h.title + by + ': ' + h.place + ', ' + period(h) + (h.prize ? ', ' + h.prize + ' in prizes' : '') +
    '. Entries close ' + day(h.deadline) + '. Listed by The Tech Hut.';
  var image = hasCard ? url + 'card.png' : SITE + '/assets/img/social/hackathons.jpg';
  var facts = [['Where', h.place], ['Runs', period(h)], ['Entries close', day(h.deadline)],
    ['Total prizes', h.prize], ['Themes', (h.themes || []).join(', ')],
    ['Joined so far', h.joined ? h.joined.toLocaleString('en-US') + ' people' : '']].filter(function (f) { return f[1]; });
  var prizes = (h.prizes || []).map(function (p) {
    return '    <li><strong>' + esc(p.title) + '</strong>' +
      (p.value || p.winners ? ' — ' + [p.value, p.winners].filter(Boolean).map(esc).join(' · ') : '') +
      (p.desc ? '<br><span>' + esc(p.desc) + '</span>' : '') + '</li>\n';
  }).join('');
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '  <title>' + esc(title) + ' | The Tech Hut</title>\n' +
    '  <meta name="description" content="' + esc(desc) + '">\n' +
    '  <meta name="robots" content="index, follow">\n' +
    '  <link rel="canonical" href="' + url + '">\n' +
    '  <meta property="og:type" content="website">\n  <meta property="og:site_name" content="The Tech Hut">\n' +
    '  <meta property="og:title" content="' + esc(title) + '">\n  <meta property="og:description" content="' + esc(desc) + '">\n' +
    '  <meta property="og:url" content="' + url + '">\n' +
    '  <meta property="og:image" content="' + image + '">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">\n' +
    '  <meta name="twitter:card" content="summary_large_image">\n  <meta name="twitter:image" content="' + image + '">\n' +
    '  <link rel="stylesheet" href="/assets/css/thh.css">\n' +
    '  <style>.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin:22px 0}.facts dt{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);padding-top:3px}.facts dd{margin:0}' +
    '.prizes{padding-left:20px}.prizes li{margin:0 0 10px}.prizes span{color:var(--muted);font-size:15.5px}.hero{display:block;width:100%;height:auto;border:1px solid var(--rule);border-radius:6px;margin:18px 0 22px}</style>\n' +
    '</head>\n<body>\n<a class="skip" href="#main">Skip to content</a>\n' +
    '<header class="masthead"><div class="wrap masthead-main"><a class="wordmark" href="/">The Tech Hut<span class="dot">.</span></a>' +
    '<nav class="sitenav" aria-label="Site"><a href="/blog/daily/">Daily</a><a href="/jobs/">Jobs</a><a href="/hackathons/" aria-current="page">Hackathons</a><a href="/remote/">Remote</a><a href="/blog/">Blog</a></nav></div></header>\n' +
    '<main id="main"><div class="wrap" style="max-width:760px;padding:40px 0 64px">\n' +
    '  <p><a href="/hackathons/">&larr; All hackathons</a></p>\n' +
    '  <h1>' + esc(h.title) + '</h1>\n' +
    (h.host ? '  <p class="lede">' + esc(h.host) + '</p>\n' : '') +
    (hasCard ? '  <img class="hero" src="card.png" width="1200" height="630" alt="' + esc(h.title) + ': ' + esc(h.place) + ', ' + esc(period(h)) + '">\n' : '') +
    (h.excerpt ? '  <p>' + esc(h.excerpt) + '</p>\n' : '') +
    '  <dl class="facts">\n' + facts.map(function (f) { return '    <dt>' + f[0] + '</dt><dd>' + esc(f[1]) + '</dd>\n'; }).join('') + '  </dl>\n' +
    (prizes ? '  <h2>Prizes</h2>\n  <ul class="prizes">\n' + prizes + '  </ul>\n' : '') +
    '  <p><a class="btn" href="' + esc(h.url) + '" target="_blank" rel="noopener nofollow">See the rules and enter on ' + esc(h.source) + '</a></p>\n' +
    '  <p style="font-size:14px">Dates and prizes are as published on ' + esc(h.source) + ' when this page was last read; the organiser’s page is the one that counts. ' +
    'Read who can enter before you start: some hackathons limit entry by country, age or student status. ' +
    'The Tech Hut does not run this hackathon or take entries, and no organiser pays to be listed here. Never pay to enter.</p>\n' +
    '</div></main>\n</body>\n</html>\n';
}

async function main() {
  var data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  var rows = (data.hackathons || []).filter(function (h) { return h.page && /^[a-z0-9-]+$/.test(h.page) && /^https:\/\//.test(h.url || ''); });
  if (!rows.length) { console.error('no hackathons in data/hackathons.json; leaving hackathons/event untouched'); process.exit(1); }
  var drawCard = cards.cardWriter();   // null without sharp: pages then use the list's share image
  if (!drawCard) console.log('hackathon pages: sharp is not installed, share images fall back to the list’s');
  fs.rmSync(OUT, { recursive: true, force: true });
  for (var i = 0; i < rows.length; i++) {
    var h = rows[i], dir = path.join(OUT, h.page), hasCard = false;
    fs.mkdirSync(dir, { recursive: true });
    if (drawCard) {
      try {
        fs.writeFileSync(path.join(dir, 'card.png'), await drawCard(cardOf(h)));
        hasCard = true;
      } catch (e) { console.error('hackathon pages: no card for %s: %s', h.page, e.message); }
    }
    fs.writeFileSync(path.join(dir, 'index.html'), page(h, hasCard));
  }
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.map(function (h) { return '  <url><loc>' + SITE + '/hackathons/event/' + h.page + '/</loc><lastmod>' + data.updated.slice(0, 10) + '</lastmod></url>'; }).join('\n') +
    '\n</urlset>\n');
  console.log('hackathon pages: %d written to %s', rows.length, path.relative(ROOT, OUT));
}

main().catch(function (e) { console.error(e); process.exit(1); });
