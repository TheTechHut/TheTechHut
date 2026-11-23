/*
 * The 1200x630 share image for a prompt's own page (og:image) on the prompt
 * marketplace. Same design system as the role card (scripts/job_card.js): navy,
 * dots fading in from the right, the green and gold blobs, the brand lockup and
 * the deep-navy bar, with the prompt's own title, seller, price and AI tool.
 *
 *   card = { title, seller, price, model, cat }
 *     price: KES number, 0 = free;  model, cat: labels as the marketplace shows them
 *
 * Drawn with job_card.js's helpers and fonts, so the text is outlined and the
 * image is identical on every machine. Written at 2x (2400x1260).
 */
'use strict';
var J = require('./job_card.js');
var F = J.fonts, measure = J.measure, text = J.text, wrap = J.wrap, blob = J.blob;

var W = 1200, H = 630, BAR = 96, BAR_Y = H - BAR, PAD = 64;
var C = { navy: '#142f52', deep: '#0d2748', green: '#27ad8b', mint: '#55d2b0',
          gold: '#f4c354', white: '#ffffff', soft: '#c3d0de' };

function pill(label, x, top, fill) {
  var w = Math.round(measure(F.black, label, 13, 0.52) + 28);
  return { w: w, svg: '<rect x="' + x + '" y="' + top + '" width="' + w + '" height="28" rx="14" fill="' + fill + '"/>' +
    text(F.black, label, x + w / 2, top + 19, 13, C.navy, { anchor: 'middle', spacing: 0.52 }) };
}

function svg(card, logo) {
  var title = String(card.title || 'An AI prompt');
  // Title: 80px on up to two lines; longer titles step down so the seller row clears the bar.
  var size = 80, t = wrap(F.head, title, 80, -3.2, 820, 2);
  if (!t.fits) { size = 64; t = wrap(F.head, title, 64, -2.56, 820, 2); }
  if (!t.fits) { size = 54; t = wrap(F.head, title, 54, -2.16, 820, 3); }
  var lh = size * 1.08;
  var eyebrowTop = PAD - 8 + 60 + 58;
  var titleTop = eyebrowTop + 18 + 10;
  var rowTop = titleTop + t.lines.length * lh + 44;
  var titleSvg = t.lines.map(function (l, i) {
    return text(F.head, l, PAD, titleTop + i * lh + size * 0.9, size, C.white, { spacing: -0.04 * size });
  }).join('');

  var eyebrow = ('AI prompt' + (card.cat ? ' · ' + card.cat : '')).toUpperCase();
  eyebrow = wrap(F.black, eyebrow, 15, 1.2, 820, 1).lines[0];

  // Seller row: initial in the gold circle, "by <name>", then price and tool pills.
  var seller = String(card.seller || 'Member');
  var name = wrap(F.head, 'by ' + seller, 28, 0, 600, 1).lines[0];
  var cy = rowTop + 34, stackTop = rowTop - 1, nameX = PAD + 68 + 18;
  var price = card.price > 0 ? 'KES ' + Number(card.price).toLocaleString('en') : 'FREE';
  var p1 = pill(price, nameX, stackTop + 42, C.gold);
  var p2 = card.model ? pill(String(card.model).toUpperCase(), nameX + p1.w + 8, stackTop + 42, C.mint) : { svg: '' };

  // Dots: clear to 52% of the width, full from 68%, and never within 28px of the title.
  var textRight = PAD + Math.max.apply(null, t.lines.map(function (l) { return measure(F.head, l, size, -0.04 * size); }));
  var fadeFrom = Math.max(0.52 * W, textRight + 28), fadeTo = Math.max(0.68 * W, fadeFrom + 0.16 * W);
  var defs = '<linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="' + fadeFrom.toFixed(1) + '" y1="0" x2="' + fadeTo.toFixed(1) + '" y2="0">' +
    '<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>' +
    '<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W + '" height="' + BAR_Y + '"><rect width="' + W + '" height="' + BAR_Y + '" fill="#000"/><rect x="' + fadeFrom.toFixed(1) + '" width="' + (W - fadeFrom).toFixed(1) + '" height="' + BAR_Y + '" fill="url(#fade)"/></mask>' +
    '<pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="3.5" fill="' + C.white + '"/></pattern>' +
    '<clipPath id="logoClip"><rect x="' + PAD + '" y="' + (PAD - 8) + '" width="60" height="60" rx="12"/></clipPath>' +
    '<clipPath id="above"><rect width="' + W + '" height="' + BAR_Y + '"/></clipPath>';

  var barLine = card.price > 0 ? 'Pay by M-PESA or card, use it in minutes' : 'Free to copy into your AI tool';
  var btnText = 'thetechhut.co/prompts  →';
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
    '<image x="' + PAD + '" y="' + (PAD - 8) + '" width="60" height="60" xlink:href="' + logo + '" clip-path="url(#logoClip)"/>' +
    text(F.head, 'THE TECH HUT', PAD + 74, PAD - 8 + 26, 22, C.white) +
    text(F.regular, 'A home for tech people.', PAD + 74, PAD - 8 + 50, 14, C.soft) +
    text(F.black, eyebrow, PAD, eyebrowTop + 14, 15, C.mint, { spacing: 1.2 }) +
    titleSvg +
    '<circle cx="' + (PAD + 34) + '" cy="' + cy + '" r="34" fill="' + C.gold + '"/>' +
    text(F.head, seller.charAt(0).toUpperCase(), PAD + 34, cy + 11, 30, C.navy, { anchor: 'middle' }) +
    text(F.head, name, nameX, stackTop + 26, 28, C.white) +
    p1.svg + p2.svg +
    '<rect y="' + BAR_Y + '" width="' + W + '" height="' + BAR + '" fill="' + C.deep + '"/>' +
    '<rect y="' + BAR_Y + '" width="' + W + '" height="1" fill="#fff" fill-opacity="0.22"/>' +
    text(F.semi, barLine, PAD, midY, 21, C.white) +
    '<rect x="' + btnX + '" y="' + btnY + '" width="' + btnW + '" height="' + btnH + '" rx="28" fill="' + C.gold + '"/>' +
    text(F.bold, btnText, btnX + btnW / 2, midY, 19, C.navy, { anchor: 'middle' }) +
    '</svg>';
}

/** -> function(card) returning a Promise of a PNG Buffer, or null without sharp/opentype.js */
function cardWriter() { return J.cardWriter(svg); }

module.exports = { cardWriter: cardWriter, svg: svg };
