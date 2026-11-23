#!/usr/bin/env node
/*
 * One static page and one share image per prompt on the prompt marketplace:
 *
 *   prompts/p/<id>/<slug>/index.html   the page shell with this prompt's
 *                                                 title, description and og:image in it
 *   prompts/p/<id>/card.png            the 1200x630 share card (2x), drawn by
 *                                                 scripts/prompt_card.js
 *   prompts/sitemap.xml                (scripts/build_prompt_sitemap.js)
 *
 * Why static pages: WhatsApp, LinkedIn, X and Facebook read a link's preview from
 * the HTML the server sends and never run the page's JavaScript, so the single
 * shell that Firebase serves for every /prompts/p/... address would show
 * the same preview for every prompt. Firebase serves a file that exists before it
 * falls back to the rewrite, so built prompts get their own preview, and a prompt
 * posted since the last build still opens (with the generic preview) until the
 * next one, at most about 3 hours later.
 *
 * Reads the public list from the Worker (GET /market/prompts: no prompt text).
 * Built on GitHub Actions before every deploy and never committed (.gitignore),
 * like jobs/role/ and hackathons/event/. Without sharp the pages are still
 * written, with the marketplace's generic image.
 *
 *   node scripts/build_prompt_pages.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var sitemap = require('./build_prompt_sitemap.js');
var cards = require('./prompt_card.js');

var ROOT = path.join(__dirname, '..');
var SHELL = path.join(ROOT, 'prompts', 'p', 'index.html');
var API = process.env.MARKET_API || 'https://thetechhut-pay.thetechhut.workers.dev/market/prompts';
var SITE = 'https://thetechhut.co';
var CAT = { writing: 'Writing', coding: 'Coding', career: 'Career & CVs', marketing: 'Marketing', data: 'Data & analysis',
            images: 'Images', business: 'Business', learning: 'Learning', other: 'Other' };
var MODEL = { any: 'Any AI', chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', copilot: 'Copilot', midjourney: 'Midjourney', other: 'Other' };
var ID = /^[a-z0-9]{6,20}$/, PATH = /^\/prompts\/p\/[a-z0-9]{6,20}\/([a-z0-9-]{1,60}\/)?$/;

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function oneLine(s, max) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s; }

/** The shell with one prompt's head tags. `image` is an absolute URL or null for the generic one. */
function page(shell, p, image) {
  var url = SITE + p.path;
  var title = oneLine(p.title, 90);
  var price = p.price > 0 ? 'KES ' + Number(p.price).toLocaleString('en') : 'Free';
  var desc = oneLine(price + ' · ' + (MODEL[p.model] || 'Any AI') + ' prompt by ' + (p.seller || 'a member') + '. ' + (p.desc || ''), 200);
  function set(re, tag) {
    if (!re.test(shell)) throw new Error('the page shell has no ' + re);
    shell = shell.replace(re, tag);
  }
  set(/<title>[^<]*<\/title>/, '<title>' + esc(title) + ' | AI prompt | The Tech Hut</title>');
  set(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(desc) + '">');
  set(/<link rel="canonical" id="canon" href="[^"]*">/, '<link rel="canonical" id="canon" href="' + esc(url) + '">');
  set(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + esc(title) + '">');
  set(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + esc(desc) + '">');
  set(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + esc(url) + '">');
  set(/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + esc(title) + '">');
  set(/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + esc(desc) + '">');
  if (image) {
    set(/<meta property="og:image" content="[^"]*">/, '<meta property="og:image" content="' + esc(image) + '">');
    set(/<meta property="og:image:alt" content="[^"]*">/, '<meta property="og:image:alt" content="' + esc(title + ': ' + price + ' AI prompt by ' + (p.seller || 'a member') + ' on The Tech Hut') + '">');
    set(/<meta name="twitter:image" content="[^"]*">/, '<meta name="twitter:image" content="' + esc(image) + '">');
  }
  return shell;
}

async function main() {
  var prompts;
  try {
    var r = await fetch(API, { headers: { Origin: SITE } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    prompts = (await r.json()).prompts || [];
  } catch (e) {
    console.error('prompt pages: could not read the prompt list (' + e.message + '); writing the sitemap only');
    prompts = null;
  }
  // The sitemap always gets written, as build_prompt_sitemap.js does on its own.
  var mapFile = path.join(ROOT, 'prompts', 'sitemap.xml');
  fs.writeFileSync(mapFile, sitemap.build(prompts, Date.now()));
  if (!prompts) return;

  var shell = fs.readFileSync(SHELL, 'utf8');
  var draw = cards.cardWriter();   // null without sharp: pages keep the generic image
  var made = 0, drawn = 0;
  for (var i = 0; i < prompts.length; i++) {
    var p = prompts[i];
    if (!p || !ID.test(p.id || '') || !PATH.test(p.path || '') || p.path === '/prompts/p/' + p.id + '/') continue;
    var idDir = path.join(ROOT, 'prompts', 'p', p.id);
    var image = null;
    if (draw) {
      try {
        fs.mkdirSync(idDir, { recursive: true });
        fs.writeFileSync(path.join(idDir, 'card.png'), await draw({
          title: p.title, seller: p.seller, price: p.price, model: MODEL[p.model] || 'Any AI', cat: CAT[p.cat] || ''
        }));
        // Images are cached for a year (firebase.json), so an edited prompt needs a new address.
        image = SITE + '/prompts/p/' + p.id + '/card.png?v=' + (Number(p.updated || p.created) || 0).toString(36);
        drawn++;
      } catch (e) { console.error('prompt pages: no card for %s: %s', p.id, e.message); }
    }
    var dir = path.join(ROOT, p.path.replace(/^\//, ''));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page(shell, p, image));
    made++;
  }
  console.log('prompt pages: %d pages, %d share cards, sitemap with %d prompts', made, drawn, prompts.length);
}

if (require.main === module) main();
module.exports = { page: page };
