#!/usr/bin/env node
/*
 * /prompts/sitemap.xml: the marketplace page and one URL per
 * prompt page (/prompts/p/<id>/<slug>/), so search engines find
 * prompts without having to run the marketplace's JavaScript.
 *
 * Reads the public list from the Worker (GET /market/prompts: titles and ids,
 * never prompt text). Built on GitHub Actions before every deploy and never
 * committed (see .gitignore), like jobs/role/ and hackathons/event/. If the
 * Worker cannot be reached it still writes a valid sitemap with the
 * marketplace page, so robots.txt never points at a missing file.
 *
 *   node scripts/build_prompt_sitemap.js
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'prompts', 'sitemap.xml');
var API = process.env.MARKET_API || 'https://api.thetechhut.co/market/prompts';
var SITE = 'https://thetechhut.co';

function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]; }); }
function day(ms) { var d = new Date(Number(ms) || Date.now()); return isNaN(d) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10); }

/** prompts (the public list) -> sitemap XML */
function build(prompts, now) {
  var rows = [{ loc: SITE + '/prompts/', lastmod: day(now), freq: 'daily', pri: '0.8' }];
  var newest = 0;
  (prompts || []).forEach(function (p) {
    // Only well-formed ids and paths from the Worker; anything else is skipped.
    if (!p || !/^[a-z0-9]{6,20}$/.test(p.id || '')) return;
    var loc = p.path && /^\/prompts\/p\/[a-z0-9]{6,20}\/([a-z0-9-]{1,60}\/)?$/.test(p.path) ? p.path : '/prompts/p/' + p.id + '/';
    var t = Number(p.updated || p.created) || 0; if (t > newest) newest = t;
    rows.push({ loc: SITE + loc, lastmod: day(t), freq: 'weekly', pri: '0.6' });
  });
  if (newest) rows[0].lastmod = day(newest);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.map(function (r) {
      return '  <url>\n    <loc>' + esc(r.loc) + '</loc>\n    <lastmod>' + r.lastmod + '</lastmod>\n    <changefreq>' + r.freq + '</changefreq>\n    <priority>' + r.pri + '</priority>\n  </url>';
    }).join('\n') + '\n</urlset>\n';
}

async function main() {
  var prompts = null;
  try {
    var r = await fetch(API, { headers: { Origin: SITE } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    prompts = (await r.json()).prompts || [];
  } catch (e) {
    console.error('could not read the prompt list (' + e.message + '); writing the marketplace page only');
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, build(prompts, Date.now()));
  console.log('prompts/sitemap.xml: ' + (prompts ? prompts.length : 0) + ' prompts');
}

if (require.main === module) main();
module.exports = { build: build };
