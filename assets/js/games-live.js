/* The Tech Hut games: live player count and total visits.
 *
 * Pings the Worker (worker/src/games.js) every 30 seconds while the page is
 * visible, and fills any element marked data-games-stats with the numbers.
 *   data-mode="full"     "12 online now · 3,482 visits"   (directory)
 *   data-mode="compact"  "12 online"                       (player bar)
 * The element stays hidden until the first answer arrives, so if the
 * counter is down the page simply doesn't show it.
 *
 * The only thing sent is a random id kept in sessionStorage (one tab, one
 * visitor) and whether this is the tab's first page on /games/.
 */
(function () {
  var API = 'https://thetechhut-pay.thetechhut.workers.dev';
  var EVERY = 30000;

  function rand() {
    var a = new Uint8Array(16), s = '';
    try { (window.crypto || window.msCrypto).getRandomValues(a); }
    catch (e) { for (var j = 0; j < 16; j++) a[j] = Math.floor(Math.random() * 256); }
    for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return s;
  }
  function session(key, make) {
    try {
      var v = sessionStorage.getItem(key);
      if (!v) { v = make(); sessionStorage.setItem(key, v); return { v: v, fresh: true }; }
      return { v: v, fresh: false };
    } catch (e) { return { v: make(), fresh: true }; }
  }

  var sid = session('tthGamesSid', rand).v;
  // Marked only once the server has counted it, so a failed first ping
  // (counter down, offline) doesn't lose the visit.
  var firstVisit = true;
  try { firstVisit = !sessionStorage.getItem('tthGamesVisit'); } catch (e) {}
  var nf = function (n) { try { return Number(n).toLocaleString('en-KE'); } catch (e) { return String(n); } };

  function show(d) {
    if (!d || typeof d.live !== 'number' || typeof d.visits !== 'number') return;
    var live = Math.max(d.live, 1);   // whoever is reading this is online
    var els = document.querySelectorAll('[data-games-stats]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.innerHTML = el.getAttribute('data-mode') === 'compact'
        ? '<span class="live-dot" aria-hidden="true"></span>' + nf(live) + ' online'
        : '<span class="live-dot" aria-hidden="true"></span><b>' + nf(live) + '</b> online now' +
          '<span class="sep" aria-hidden="true"> &middot; </span><b>' + nf(d.visits) + '</b> ' +
          (d.visits === 1 ? 'visit' : 'visits');
      el.hidden = false;
    }
  }

  function ping() {
    if (document.hidden || !window.fetch) return;
    var body = { sid: sid };
    if (firstVisit) body.visit = true;
    fetch(API + '/games/ping', { method: 'POST', body: JSON.stringify(body), keepalive: true })   // text/plain: no preflight
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        if (firstVisit) { firstVisit = false; try { sessionStorage.setItem('tthGamesVisit', '1'); } catch (e) {} }
        show(d);
      })
      .catch(function () {});
  }

  ping();
  setInterval(ping, EVERY);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ping(); });
  window.addEventListener('pagehide', function () {
    try { navigator.sendBeacon(API + '/games/leave', JSON.stringify({ sid: sid })); } catch (e) {}
  });
})();
