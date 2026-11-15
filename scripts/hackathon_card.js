/*
 * The 1200x630 share image for a hackathon page (og:image): white, with the
 * name, host, prize, dates, place, closing date and themes, and the organiser's
 * own link in the bottom bar. Used by scripts/build_hackathon_pages.js.
 *
 * It is drawn as SVG with the same helpers, fonts and PNG writer as the role
 * card (scripts/job_card.js), so text is outlined and the image is identical on
 * every machine. Sizes are CSS pixels; the PNG is written at 2x.
 *
 *   card = { name, host, prize, date, where, registerBy, themes: [], barLine, link }
 *
 * Only what the card is given is drawn: no host line without a host, no chips
 * without themes.
 */
'use strict';
var J = require('./job_card.js');
var F = J.fonts, measure = J.measure, text = J.text, wrap = J.wrap, blob = J.blob;

var W = 1200, H = 630, BAR = 96, BAR_Y = H - BAR, PAD = 64, TOP = 48;
var C = { white: '#ffffff', navy: '#142f52', gold: '#f4c354', brown: '#624a13', green: '#0d7a62',
          slate: '#60718a', chipBg: '#e0f2e9', chipText: '#087b68', line: '#e9e6de' };
// Where the baseline sits below the top of a line of text, and how tall that
// line is, as a share of the font size (from each font's own ascent and descent).
var INTER = { base: 0.97, line: 1.21 }, JAKARTA = { base: 1.04, line: 1.26 };

function svg(card, logo) {
  var out = '', right = 0;   // right: the furthest any text reaches, so the dots can stay clear of it
  function put(font, str, x, top, size, fill, metrics, spacing) {
    out += text(font, str, x, top + metrics.base * size, size, fill, { spacing: spacing || 0 });
    var w = measure(font, str, size, spacing || 0);
    right = Math.max(right, x + w);
    return w;
  }
  // a small uppercase label with a value under it; returns the width of the wider one
  function pair(label, value, x, top, labelFill) {
    var a = put(F.black, label, x, top, 12, labelFill, INTER, 0.96);
    var b = put(F.head, value, x, top + 12 * INTER.line + 4, 22, C.navy, JAKARTA);
    return Math.max(a, b);
  }
  var PAIR_H = 12 * INTER.line + 4 + 22 * JAKARTA.line;

  // 1. brand lockup: the two lines are centred on the 60px logo
  var nameTop = TOP + (60 - 22 * JAKARTA.line - 14 * INTER.line) / 2;
  put(F.head, 'THE TECH HUT', PAD + 74, nameTop, 22, C.navy, JAKARTA);
  put(F.regular, 'A home for tech people.', PAD + 74, nameTop + 22 * JAKARTA.line, 14, C.slate, INTER);
  var y = TOP + 60;

  // 2. eyebrow
  y += 34;
  put(F.black, 'HACKATHON · BUILD WITH OTHERS', PAD, y, 15, C.green, INTER, 1.2);
  y += 15 * INTER.line;

  // 3. name: 80px on one line. A longer name steps down (64px on one line, then
  // 52px on two) so the rows under it always clear the bottom bar.
  y += 6;
  var size = 80, t = wrap(F.head, card.name, 80, -3.2, 840, 1);
  if (!t.fits) { size = 64; t = wrap(F.head, card.name, 64, -2.56, 840, 1); }
  if (!t.fits) { size = 52; t = wrap(F.head, card.name, 52, -2.08, 840, 2); }
  var lh = size * 1.05;
  t.lines.forEach(function (l, i) {
    put(F.head, l, PAD, y + i * lh + (lh - size * JAKARTA.line) / 2, size, C.navy, JAKARTA, -0.04 * size);
  });
  y += t.lines.length * lh;

  // 4. host
  if (card.host) {
    y += 12;
    var w = put(F.regular, 'Hosted by ', PAD, y, 19, C.slate, INTER);
    put(F.bold, wrap(F.bold, card.host, 19, 0, 640, 1).lines[0], PAD + w + measure(F.regular, ' ', 19, 0), y, 19, C.navy, INTER);
    y += 19 * INTER.line;
  }

  // 5. prize box, sized to its content
  y += 22;
  var prize = wrap(F.head, card.prize, 22, 0, 700, 1).lines[0];
  var boxW = Math.max(measure(F.black, 'PRIZE', 12, 0.96), measure(F.head, prize, 22, 0)) + 40;
  out += '<rect x="' + PAD + '" y="' + y.toFixed(1) + '" width="' + boxW.toFixed(1) + '" height="' + (PAIR_H + 20).toFixed(1) + '" rx="14" fill="' + C.gold + '"/>';
  pair('PRIZE', prize, PAD + 20, y + 10, C.brown);
  y += PAIR_H + 20;

  // 6. details row
  y += 20;
  var x = PAD;
  [['DATE', card.date], ['WHERE', wrap(F.head, card.where, 22, 0, 360, 1).lines[0]], ['REGISTER BY', card.registerBy]].forEach(function (d) {
    if (d[1]) x += pair(d[0], d[1], x, y, C.slate) + 44;
  });
  y += PAIR_H;

  // 7. theme chips, as many as fit on the line
  y += 20;
  x = PAD;
  (card.themes || []).some(function (th) {
    var cw = measure(F.bold, th, 15, 0) + 28;
    if (x + cw > W - PAD) return true;
    out += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + cw.toFixed(1) + '" height="' + (15 * INTER.line + 14).toFixed(1) + '" rx="' + ((15 * INTER.line + 14) / 2).toFixed(1) + '" fill="' + C.chipBg + '"/>';
    put(F.bold, th, x + 14, y + 7, 15, C.chipText, INTER);
    right = Math.max(right, x + cw);
    x += cw + 10;
    return false;
  });

  // Decoration, behind the text: dots fade in from 56% to 72% of the width, and
  // never start closer than 28px to the text.
  var fadeFrom = Math.max(0.56 * W, right + 28), fadeTo = Math.max(0.72 * W, fadeFrom + 0.16 * W);
  var defs = '<linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="' + fadeFrom.toFixed(1) + '" y1="0" x2="' + fadeTo.toFixed(1) + '" y2="0">' +
    '<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>' +
    '<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W + '" height="' + BAR_Y + '"><rect width="' + W + '" height="' + BAR_Y + '" fill="#000"/><rect x="' + fadeFrom.toFixed(1) + '" width="' + (W - fadeFrom).toFixed(1) + '" height="' + BAR_Y + '" fill="url(#fade)"/></mask>' +
    '<pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="3.5" fill="' + C.navy + '"/></pattern>' +
    '<clipPath id="logoClip"><rect x="' + PAD + '" y="' + TOP + '" width="60" height="60" rx="12"/></clipPath>' +
    '<clipPath id="above"><rect width="' + W + '" height="' + BAR_Y + '"/></clipPath>';

  // bottom bar
  var btnText = card.link + ' ↗';
  var btnW = measure(F.bold, btnText, 19, 0) + 56, btnH = 19 * INTER.line + 30;
  var btnX = W - PAD - btnW, mid = BAR_Y + BAR / 2;
  var barLine = wrap(F.semi, card.barLine, 21, 0, btnX - PAD - 32, 1).lines[0];

  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<defs>' + defs + '</defs>' +
    '<rect width="' + W + '" height="' + H + '" fill="' + C.white + '"/>' +
    '<rect width="' + W + '" height="' + BAR_Y + '" fill="url(#dots)" mask="url(#m)"/>' +
    '<g clip-path="url(#above)">' +
    blob(W + 110 - 330, -120, 330, 370, [0.45, 0.25, 0.42, 0.24], C.navy, -9, W + 110 - 165, 65) +
    blob(W - 150 - 96, 150, 96, 112, [0.6, 0.2, 0.6, 0.3], C.gold, -30, W - 150 - 48, 206) +
    '</g>' +
    '<image x="' + PAD + '" y="' + TOP + '" width="60" height="60" xlink:href="' + logo + '" clip-path="url(#logoClip)"/>' +
    out +
    '<rect y="' + BAR_Y + '" width="' + W + '" height="' + BAR + '" fill="' + C.white + '"/>' +
    '<rect y="' + BAR_Y + '" width="' + W + '" height="1" fill="' + C.line + '"/>' +
    text(F.semi, barLine, PAD, mid - 21 * INTER.line / 2 + 21 * INTER.base, 21, C.navy) +
    '<rect x="' + btnX.toFixed(1) + '" y="' + (mid - btnH / 2).toFixed(1) + '" width="' + btnW.toFixed(1) + '" height="' + btnH.toFixed(1) + '" rx="28" fill="' + C.navy + '"/>' +
    text(F.bold, btnText, btnX + 28, mid - 19 * INTER.line / 2 + 19 * INTER.base, 19, C.white) +
    '</svg>';
}

/** -> function(card) returning a Promise of a PNG Buffer, or null when sharp or opentype.js is missing. */
module.exports = { cardWriter: function () { return J.cardWriter(svg); }, svg: svg };
