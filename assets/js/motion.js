/* The Tech Hut: site motion, loaded on every page (in <head>, not deferred).
 *
 * This file is tiny on purpose. It decides whether to animate at all, hides
 * the hero text for a moment so it can be revealed instead of flashing, and
 * then loads the real work in order:
 *   GSAP + ScrollTrigger + SplitText (scroll and text effects)
 *   Lenis (smooth scrolling on mouse and trackpad; phones keep native scroll)
 *   /assets/js/motion-run.js (the effects themselves)
 * The libraries are self-hosted in /assets/vendor/ (versions in the file names).
 *
 * No motion when the visitor asks for less (prefers-reduced-motion), on the
 * game player, or on any page with <html data-no-motion>. If anything fails
 * to load, the hero is shown again after 2.5 seconds, so nothing stays hidden.
 */
(function () {
  var d = document.documentElement;
  try {
    if (d.hasAttribute('data-no-motion')) return;
    if (/^\/games\/play\//.test(location.pathname)) return;
    if (!window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window) || !window.Promise) return;
  } catch (e) { return; }

  var HERO = '.front h1, .front .eyebrow, .front .lede, .front .cta-row, .front .today, ' +
             'header.hero h1, header.hero .pill, header.hero .lede, header.hero .cta-row, header.hero .cta-note, ' +
             '.pagehead h1, .art-hero h1, .art-hero .cat, .art-hero .by';
  var css = document.createElement('style');
  css.id = 'motion-css';
  css.textContent =
    'html.motion-pending :is(' + HERO + '){visibility:hidden}' +
    // Lenis (from lenis/dist/lenis.css)
    'html.lenis,html.lenis body{height:auto}.lenis:not(.lenis-autoToggle).lenis-stopped{overflow:clip}' +
    '.lenis [data-lenis-prevent]{overscroll-behavior:contain}' +
    // Lenis's own CSS blocks clicks on every iframe while smooth scrolling is on;
    // we only block them mid-scroll, so YouTube embeds and games stay clickable.
    '.lenis.lenis-scrolling iframe{pointer-events:none}' +
    '.lenis.lenis-autoToggle{transition-property:overflow;transition-duration:1ms;transition-behavior:allow-discrete}' +
    'html.lenis.lenis-smooth{scroll-behavior:auto!important}' +
    // reading progress bar and the shimmer on emphasised hero words
    '#tth-progress{position:fixed;left:0;top:0;height:3px;width:100%;background:var(--mint,#06D6A0);transform:scaleX(0);transform-origin:0 50%;z-index:100;pointer-events:none}' +
    '.m-shine{background:linear-gradient(100deg,currentColor 0%,currentColor 40%,var(--mint,#06D6A0) 50%,currentColor 60%,currentColor 100%);background-size:250% 100%;background-position:100% 0;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}';
  document.head.appendChild(css);
  d.classList.add('motion-pending');
  var reveal = function () { d.classList.remove('motion-pending'); };
  var safety = setTimeout(reveal, 2500);
  window.TTHMotion = { reveal: function () { clearTimeout(safety); reveal(); } };

  var V = '/assets/vendor/';
  var files = [V + 'gsap-3.15.0/gsap.min.js', V + 'gsap-3.15.0/ScrollTrigger.min.js', V + 'gsap-3.15.0/SplitText.min.js',
               V + 'lenis-1.3.27/lenis.min.js', '/assets/js/motion-run.js?v=1'];
  files.forEach(function (src) {
    var s = document.createElement('script');
    s.src = src; s.async = false;                  // keep order, don't block the page
    s.onerror = function () { window.TTHMotion.reveal(); };
    document.head.appendChild(s);
  });
})();
