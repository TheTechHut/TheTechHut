/*
 * The 1200x630 share image for a role page (og:image), drawn from the role's own
 * title, employer and place, so each link preview says what is being shared.
 * Used by scripts/build_job_pages.js. Written as a 2400x1260 PNG (2x) so it stays
 * sharp on high-density screens.
 *
 * Needs the `sharp` and `opentype.js` packages, which the workflows install
 * before this runs. If either is missing, cardWriter() returns null and the pages
 * keep the generic image: a missing card never fails a deploy.
 *
 * Text is turned into outlines with opentype.js from the bundled fonts
 * (scripts/fonts: Plus Jakarta Sans for headings, Inter for the rest; both SIL
 * Open Font License). That makes the card identical on every machine, whatever
 * fonts or font engine it has, and gives exact text widths for wrapping.
 */
'use strict';
var fs = require('fs');
var path = require('path');

var FONTS = path.join(__dirname, 'fonts');
var LOGO = path.join(__dirname, '..', 'assets', 'img', 'the_tech_hut_logo.png');

var W = 1200, H = 630, BAR = 96, BAR_Y = H - BAR, PAD = 64;
var C = {
  navy: '#142f52', deep: '#0d2748', green: '#27ad8b', mint: '#55d2b0',
  gold: '#f4c354', white: '#ffffff', soft: '#c3d0de'
};
var F = {};   // loaded fonts, filled by cardWriter()

// A line of text as one outlined <path>. `anchor` is 'start' | 'middle'; `spacing`
// is extra space after each glyph in px. Width comes from the font's own metrics.
function measure(font, text, size, spacing) {
  var scale = size / font.unitsPerEm, g = font.stringToGlyphs(text), w = 0;
  g.forEach(function (gl, i) {
    w += gl.advanceWidth * scale + (spacing || 0);
    if (i) w += font.getKerningValue(g[i - 1], gl) * scale;
  });
  return w;
}
function text(font, str, x, y, size, fill, o) {
  o = o || {};
  var spacing = o.spacing || 0, scale = size / font.unitsPerEm, g = font.stringToGlyphs(str);
  var cx = o.anchor === 'middle' ? x - (measure(font, str, size, spacing) - spacing) / 2 : x, d = '';
  g.forEach(function (gl, i) {
    if (i) cx += font.getKerningValue(g[i - 1], gl) * scale;
    d += gl.getPath(cx, y, size).toPathData(2);
    cx += gl.advanceWidth * scale + spacing;
  });
  return '<path d="' + d + '" fill="' + fill + '"/>';
}

// Greedy wrap to a pixel width; at most `maxLines`. Returns { lines, fits } where
// fits is false when the text had to be cut (the last line then ends in "…").
function wrap(font, str, size, spacing, maxWidth, maxLines) {
  var words = String(str).split(/\s+/).filter(Boolean), out = [], cur = '';
  words.forEach(function (w) {
    var next = cur ? cur + ' ' + w : w;
    if (cur && measure(font, next, size, spacing) > maxWidth) { out.push(cur); cur = w; } else cur = next;
  });
  if (cur) out.push(cur);
  if (out.length <= maxLines) return { lines: out, fits: true };
  var kept = out.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  return { lines: kept, fits: false };
}

// A rounded rectangle with CSS-style percentage radii [tl, tr, br, bl] (each
// horizontal radius is a share of the width, each vertical one of the height).
function blob(x, y, w, h, r, fill, rotate, cx, cy) {
  var rx = r.map(function (p) { return p * w; }), ry = r.map(function (p) { return p * h; });
  var d = 'M' + (x + rx[0]) + ' ' + y + 'H' + (x + w - rx[1]) +
    'A' + rx[1] + ' ' + ry[1] + ' 0 0 1 ' + (x + w) + ' ' + (y + ry[1]) +
    'V' + (y + h - ry[2]) +
    'A' + rx[2] + ' ' + ry[2] + ' 0 0 1 ' + (x + w - rx[2]) + ' ' + (y + h) +
    'H' + (x + rx[3]) +
    'A' + rx[3] + ' ' + ry[3] + ' 0 0 1 ' + x + ' ' + (y + h - ry[3]) +
    'V' + (y + ry[0]) +
    'A' + rx[0] + ' ' + ry[0] + ' 0 0 1 ' + (x + rx[0]) + ' ' + y + 'Z';
  return '<path d="' + d + '" fill="' + fill + '" transform="rotate(' + rotate + ' ' + cx + ' ' + cy + ')"/>';
}

/** card = { title, company, tag }, logo = data URI of the brand mark -> SVG text */
function svg(card, logo) {
  // Title: 80px, up to two lines. Longer titles step down so the company row
  // below it always clears the bottom bar.
  var size = 80, t = wrap(F.head, card.title, 80, -3.2, 820, 2);
  if (!t.fits) { size = 64; t = wrap(F.head, card.title, 64, -2.56, 820, 2); }
  if (!t.fits) { size = 54; t = wrap(F.head, card.title, 54, -2.16, 820, 3); }
  var lh = size * 1.08;
  var eyebrowTop = PAD - 8 + 60 + 58;            // logo ends at y=116, then 58px
  var titleTop = eyebrowTop + 18 + 10;            // eyebrow line box, then 10px
  var titleBottom = titleTop + t.lines.length * lh;
  var rowTop = titleBottom + 44;
  var title = t.lines.map(function (l, i) {
    return text(F.head, l, PAD, titleTop + i * lh + size * 0.9, size, C.white, { spacing: -0.04 * size });
  }).join('');

  var company = wrap(F.head, card.company || '', 28, 0, 640, 1).lines[0] || '';
  var tag = String(card.tag || '').toUpperCase();
  var tagW = Math.round(measure(F.black, tag, 13, 0.52) + 28);
  var cy = rowTop + 34, stackTop = rowTop - 1, nameX = PAD + 68 + 18;

  // The dots fade out toward the left (clear to 52% of the width, full from 68%),
  // but never start closer than 28px to the title, so long titles stay clear of them.
  var textRight = PAD + Math.max.apply(null, t.lines.map(function (l) { return measure(F.head, l, size, -0.04 * size); }));
  var fadeFrom = Math.max(0.52 * W, textRight + 28), fadeTo = Math.max(0.68 * W, fadeFrom + 0.16 * W);
  var defs = '<linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="' + fadeFrom.toFixed(1) + '" y1="0" x2="' + fadeTo.toFixed(1) + '" y2="0">' +
    '<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>' +
    '<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W + '" height="' + BAR_Y + '"><rect width="' + W + '" height="' + BAR_Y + '" fill="#000"/><rect x="' + fadeFrom.toFixed(1) + '" width="' + (W - fadeFrom).toFixed(1) + '" height="' + BAR_Y + '" fill="url(#fade)"/></mask>' +
    '<pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="3.5" fill="' + C.white + '"/></pattern>' +
    '<clipPath id="logoClip"><rect x="' + PAD + '" y="' + (PAD - 8) + '" width="60" height="60" rx="12"/></clipPath>' +
    '<clipPath id="above"><rect width="' + W + '" height="' + BAR_Y + '"/></clipPath>';

  var btnText = 'thetechhut.co/jobs  →';
  var btnW = Math.round(measure(F.bold, btnText, 19, 0) + 56);
  var btnH = 54, btnX = W - PAD - btnW, btnY = BAR_Y + (BAR - btnH) / 2, midY = BAR_Y + BAR / 2 + 7;

  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<defs>' + defs + '</defs>' +
    '<rect width="' + W + '" height="' + H + '" fill="' + C.navy + '"/>' +
    '<rect width="' + W + '" height="' + BAR_Y + '" fill="url(#dots)" mask="url(#m)"/>' +
    '<g clip-path="url(#above)">' +
    blob(980, -120, 330, 370, [0.45, 0.25, 0.42, 0.24], C.green, -9, 1145, 65) +
    blob(954, 150, 96, 112, [0.6, 0.2, 0.6, 0.3], C.gold, -30, 1002, 206) +
    '</g>' +
    // brand lockup
    '<image x="' + PAD + '" y="' + (PAD - 8) + '" width="60" height="60" xlink:href="' + logo + '" clip-path="url(#logoClip)"/>' +
    text(F.head, 'THE TECH HUT', PAD + 74, PAD - 8 + 26, 22, C.white) +
    text(F.regular, 'A home for tech people.', PAD + 74, PAD - 8 + 50, 14, C.soft) +
    text(F.black, 'MAKE YOUR NEXT MOVE', PAD, eyebrowTop + 14, 15, C.mint, { spacing: 1.2 }) +
    title +
    // company row
    '<circle cx="' + (PAD + 34) + '" cy="' + cy + '" r="34" fill="' + C.gold + '"/>' +
    text(F.head, (card.company || '?').charAt(0).toUpperCase(), PAD + 34, cy + 11, 30, C.navy, { anchor: 'middle' }) +
    text(F.head, company, nameX, stackTop + 26, 28, C.white) +
    (tag ? '<rect x="' + nameX + '" y="' + (stackTop + 42) + '" width="' + tagW + '" height="28" rx="14" fill="' + C.gold + '"/>' +
      text(F.black, tag, nameX + tagW / 2, stackTop + 42 + 19, 13, C.navy, { anchor: 'middle', spacing: 0.52 }) : '') +
    // bottom bar
    '<rect y="' + BAR_Y + '" width="' + W + '" height="' + BAR + '" fill="' + C.deep + '"/>' +
    '<rect y="' + BAR_Y + '" width="' + W + '" height="1" fill="#fff" fill-opacity="0.22"/>' +
    text(F.semi, 'Apply on the employer’s own site', PAD, midY, 21, C.white) +
    '<rect x="' + btnX + '" y="' + btnY + '" width="' + btnW + '" height="' + btnH + '" rx="28" fill="' + C.gold + '"/>' +
    text(F.bold, btnText, btnX + btnW / 2, midY, 19, C.navy, { anchor: 'middle' }) +
    '</svg>';
}

/** -> function(card) returning a Promise of a PNG Buffer, or null when sharp or opentype.js is missing. */
function cardWriter() {
  var sharp, opentype;
  try { sharp = require('sharp'); opentype = require('opentype.js'); } catch (e) { return null; }
  var load = function (f) { return opentype.loadSync(path.join(FONTS, f)); };
  F.head = load('PlusJakartaSans-ExtraBold.ttf');
  F.regular = load('Inter-Regular.ttf');
  F.semi = load('Inter-SemiBold.ttf');
  F.bold = load('Inter-Bold.ttf');
  F.black = load('Inter-ExtraBold.ttf');
  // The mark is 500px; the card shows it at 60px (120px at 2x), so shrink it once.
  var logo = sharp(LOGO).resize(120, 120).png().toBuffer().then(function (b) {
    return 'data:image/png;base64,' + b.toString('base64');
  });
  return function (card) {
    return logo.then(function (uri) {
      return sharp(Buffer.from(svg(card, uri)), { density: 144 }).png({ compressionLevel: 9, palette: true }).toBuffer();
    });
  };
}

module.exports = { cardWriter: cardWriter, svg: svg };
