/* The Tech Hut: site motion effects. Loaded by /assets/js/motion.js after
 * GSAP, ScrollTrigger, SplitText and Lenis. Every effect is opt-out-safe: if
 * a page lacks the elements, nothing happens; content is never left hidden.
 *
 *   1. Smooth scrolling (Lenis) on mouse and trackpad, native on touch.
 *   2. Hero headlines rise line by line from a mask (SplitText), with the
 *      eyebrow, standfirst and buttons following; a highlight sweeps once
 *      across emphasised words in the headline.
 *   3. Cards, columns and section heads fade up as they scroll into view.
 *   4. Figures with a number ("US$6.3bn", "−82%", "1,462") count up once.
 *   5. Pictures in feature sections and article heroes drift slightly (parallax).
 *   6. Buttons lean towards the pointer on desktop.
 *   7. A reading-progress bar on Daily Savannah and Reading List pages.
 */
(function () {
  var g = window.gsap, ST = window.ScrollTrigger, Split = window.SplitText, Lenis = window.Lenis;
  var M = window.TTHMotion || { reveal: function () {} };
  if (!g || !ST) { M.reveal(); return; }
  g.registerPlugin(ST);
  if (Split) g.registerPlugin(Split);
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* 1. Smooth scrolling ---------------------------------------------------- */
  if (Lenis) {
    try {
      var lenis = new Lenis({ autoRaf: false, lerp: 0.11, smoothWheel: true, syncTouch: false });
      lenis.on('scroll', ST.update);
      g.ticker.add(function (t) { lenis.raf(t * 1000); });
      g.ticker.lagSmoothing(0);
      window.TTHMotion.lenis = lenis;
    } catch (e) { /* native scrolling is fine */ }
  }

  /* 2. Hero ---------------------------------------------------------------- */
  var hero = document.querySelector('.front, header.hero, .pagehead, .art-hero');
  function heroIn() {
    if (!hero) { M.reveal(); return; }
    var h1 = hero.querySelector('h1');
    var lead = $$('.eyebrow, .pill, .cat', hero).slice(0, 1);
    var after = $$('.lede, .cta-row, .cta-note, .by', hero);
    var aside = $$('.today', hero);
    var tl = g.timeline({ defaults: { ease: 'power3.out' } });
    M.reveal();                                         // un-hide; GSAP now owns the start state
    if (lead.length) tl.from(lead, { y: 12, autoAlpha: 0, duration: 0.5 }, 0);
    if (h1 && Split) {
      Split.create(h1, {
        type: 'lines', mask: 'lines', linesClass: 'm-line', autoSplit: true, aria: 'auto',
        onSplit: function (self) {
          return g.from(self.lines, { yPercent: 110, duration: 0.9, ease: 'power4.out', stagger: 0.09, delay: 0.08 });
        }
      });
    } else if (h1) {
      tl.from(h1, { y: 24, autoAlpha: 0, duration: 0.8 }, 0.05);
    }
    if (after.length) tl.from(after, { y: 18, autoAlpha: 0, duration: 0.7, stagger: 0.08 }, 0.45);
    if (aside.length) tl.from(aside, { x: 24, autoAlpha: 0, duration: 0.8 }, 0.55);
    // one sweep of light across the emphasised words, e.g. "get it."
    $$('h1 em', hero).forEach(function (em) {
      em.classList.add('m-shine');
      g.fromTo(em, { backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0', duration: 1.6, ease: 'power2.inOut', delay: 1.0,
        onComplete: function () { em.classList.remove('m-shine'); } });
    });
  }
  // Wait for the web fonts (max 1.2 s) so lines are split where they really break.
  var fontsReady = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise(function (r) { setTimeout(r, 1200); })]) : Promise.resolve();
  fontsReady.then(heroIn, heroIn);

  /* 3. Scroll reveals ------------------------------------------------------ */
  var REVEAL = [
    '.section-head', '.desk-col', '.feature > *', '.partners > *', '.card', '.cards > *',
    '.edition article.lead', '.edition .story', '.numbers .num', '.reading .pick', '.picks li',
    '.game', '.acard', '.index-list > li', '.callout', 'section .video', '.sitefoot-grid > *'
  ].join(',');
  var targets = $$(REVEAL).filter(function (el) {
    if (hero && hero.contains(el)) return false;
    if (el.closest('[data-no-reveal]')) return false;
    var r = el.getBoundingClientRect();
    return r.top > window.innerHeight * 0.92;            // only what starts below the fold: no flash
  });
  if (targets.length) {
    g.set(targets, { autoAlpha: 0, y: 26 });
    ST.batch(targets, {
      start: 'top 90%', once: true,
      onEnter: function (batch) { g.to(batch, { autoAlpha: 1, y: 0, duration: 0.75, ease: 'power3.out', stagger: 0.08, overwrite: true }); }
    });
  }

  /* 4. Count-ups ----------------------------------------------------------- */
  $$('.numbers .num b, [data-count-up]').forEach(function (el) {
    if (el.children.length) return;                       // plain text only
    var text = el.textContent, m = /(\d[\d,]*(?:\.\d+)?)/.exec(text);
    if (!m) return;
    var raw = m[1], end = parseFloat(raw.replace(/,/g, '')), dec = (raw.split('.')[1] || '').length, commas = raw.indexOf(',') >= 0;
    if (!isFinite(end) || end === 0) return;
    var pre = text.slice(0, m.index), post = text.slice(m.index + raw.length), o = { v: 0 };
    var fmt = function (v) {
      var s = v.toFixed(dec);
      if (commas) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = p.join('.'); }
      return pre + s + post;
    };
    el.setAttribute('aria-label', text);
    ST.create({ trigger: el, start: 'top 92%', once: true, onEnter: function () {
      el.textContent = fmt(0);
      g.to(o, { v: end, duration: 1.4, ease: 'power2.out', onUpdate: function () { el.textContent = fmt(o.v); },
        onComplete: function () { el.textContent = text; } });
    } });
  });

  /* 5. Gentle parallax on pictures -------------------------------------- */
  $$('.feature figure img, .art-hero .pic img').forEach(function (img) {
    g.fromTo(img, { yPercent: -4, scale: 1.08 }, { yPercent: 4, scale: 1.08, ease: 'none',
      scrollTrigger: { trigger: img.closest('figure, .pic') || img, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  /* 6. Buttons lean towards the pointer ------------------------------------ */
  if (fine) {
    $$('.btn').forEach(function (b) {
      if (b.closest('.ame, .gfilters, form')) return;      // leave form buttons still
      var xTo = g.quickTo(b, 'x', { duration: 0.4, ease: 'power3' }), yTo = g.quickTo(b, 'y', { duration: 0.4, ease: 'power3' });
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        xTo((e.clientX - r.left - r.width / 2) * 0.18); yTo((e.clientY - r.top - r.height / 2) * 0.3);
      });
      b.addEventListener('pointerleave', function () { xTo(0); yTo(0); });
    });
  }

  /* 7. Reading progress on articles --------------------------------------- */
  if (/^\/blog\/(daily|reading)\/\d{4}-\d{2}-\d{2}\//.test(location.pathname)) {
    var bar = document.createElement('div');
    bar.id = 'tth-progress'; bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    g.to(bar, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 0.2 } });
  }

  // Images and late content (the jobs list, game filters, leaderboards) change the
  // page height; re-measure so nothing waits for a scroll position that moved.
  window.addEventListener('load', function () { ST.refresh(); });
  if ('ResizeObserver' in window) {
    var lastH = 0, timer = null;
    new ResizeObserver(function () {
      var h = document.body.scrollHeight;
      if (Math.abs(h - lastH) < 40) return;
      lastH = h; clearTimeout(timer);
      timer = setTimeout(function () { ST.refresh(); }, 200);
    }).observe(document.body);
  }
})();
