/*
 * The 1200x630 share image for a role page (og:image), drawn from the role's own
 * title, employer and place, so each link preview says what is being shared.
 * Used by scripts/build_job_pages.js.
 *
 * Needs the `sharp` package, which the workflows install before this runs. If it
 * is not there, cardWriter() returns null and the pages keep the generic image:
 * a missing card never fails a deploy.
 *
 * The font is bundled (scripts/fonts, Poppins, SIL Open Font License) so the card
 * looks the same on the Linux runner as on a laptop. sharp draws text through
 * fontconfig, so a small config that points at that folder is written to the temp
 * directory and set before sharp loads.
 */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');

var FONTS = path.join(__dirname, 'fonts');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Greedy wrap by character count, at most `lines` lines, the last one ending in "…".
function wrap(text, max, lines) {
  var out = [], cur = '';
  String(text).split(/\s+/).forEach(function (w) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  });
  if (cur) out.push(cur);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/\s*\S*$/, '') + '…'; }
  return out;
}

/** card = { title, company, where, tag } -> SVG text */
function svg(card) {
  var size = card.title.length > 60 ? 50 : 58;
  var lines = wrap(card.title, size === 50 ? 30 : 26, 3);
  var gap = size + 14, y0 = 262;
  var title = lines.map(function (l, i) {
    return '<text x="72" y="' + (y0 + i * gap) + '" font-size="' + size + '" font-weight="700" fill="#fff">' + esc(l) + '</text>';
  }).join('');
  var metaY = y0 + lines.length * gap + 14;
  var where = wrap(card.where || '', 58, 1)[0] || '';
  var tag = String(card.tag || '').toUpperCase();
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Poppins">' +
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#073B4C"/>' +
    '<stop offset="0.62" stop-color="#06303F"/><stop offset="1" stop-color="#046B52"/></linearGradient></defs>' +
    '<rect width="1200" height="630" fill="url(#bg)"/>' +
    '<text x="72" y="98" font-size="32" font-weight="700" fill="#fff">The Tech Hut<tspan fill="#06D6A0">.</tspan></text>' +
    (tag ? '<rect x="72" y="152" rx="18" ry="18" width="' + (44 + tag.length * 16) + '" height="40" fill="#06D6A0" fill-opacity="0.16"/>' +
      '<text x="94" y="180" font-size="19" font-weight="700" letter-spacing="2" fill="#06D6A0">' + esc(tag) + '</text>' : '') +
    title +
    '<circle cx="102" cy="' + (metaY + 30) + '" r="30" fill="#06D6A0"/>' +
    '<text x="102" y="' + (metaY + 42) + '" font-size="30" font-weight="700" fill="#073B4C" text-anchor="middle">' + esc((card.company || '?').charAt(0).toUpperCase()) + '</text>' +
    '<text x="150" y="' + (metaY + 26) + '" font-size="32" font-weight="700" fill="#fff">' + esc(wrap(card.company || '', 34, 1)[0]) + '</text>' +
    '<text x="150" y="' + (metaY + 62) + '" font-size="24" fill="#BFD6DE">' + esc(where) + '</text>' +
    '<rect x="0" y="568" width="1200" height="62" fill="#000" fill-opacity="0.22"/>' +
    '<text x="72" y="606" font-size="21" fill="#BFD6DE">Apply on the employer’s own site</text>' +
    '<text x="1128" y="606" font-size="21" font-weight="700" fill="#06D6A0" text-anchor="end">thetechhut.co/jobs</text>' +
    '</svg>';
}

/** -> function(card) returning a PNG Buffer, or null when sharp is not installed. */
function cardWriter() {
  if (!process.env.FONTCONFIG_FILE) {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcard-'));
    var conf = path.join(dir, 'fonts.conf');
    fs.writeFileSync(conf, '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>' +
      '<dir>' + FONTS + '</dir><cachedir>' + path.join(dir, 'cache') + '</cachedir></fontconfig>');
    process.env.FONTCONFIG_FILE = conf;
  }
  var sharp;
  try { sharp = require('sharp'); } catch (e) { return null; }
  return function (card) { return sharp(Buffer.from(svg(card))).png({ compressionLevel: 9 }).toBuffer(); };
}

module.exports = { cardWriter: cardWriter, svg: svg, wrap: wrap };
