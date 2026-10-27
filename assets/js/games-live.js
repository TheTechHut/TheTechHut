/* The Tech Hut games arcade, shared by /games/ and the player page.
 *
 * Pings the Worker (worker/src/games.js) every 30 seconds while the page is
 * on screen. On the player page it says which game is open, which is how play
 * time reaches the weekly leaderboards. Elements marked data-games-stats get
 * the live numbers:
 *   data-mode="full"     "12 online now · 3,482 visits"   (directory)
 *   data-mode="compact"  "12 online"                       (player bar)
 * They stay hidden until the first answer, so if the Worker is down the page
 * simply doesn't show them.
 *
 * Sent: a random tab id (sessionStorage), the game being played, and, only
 * if the visitor joined the leaderboard, their player id and nickname
 * (localStorage). window.TTHArcade lets the directory manage that player.
 */
(function () {
  var API = 'https://thetechhut-pay.thetechhut.workers.dev';
  var EVERY = 30000;
  var KEY = 'tthArcadePlayer';

  function rand(n) {
    var a = new Uint8Array(n || 16), s = '', abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    try { (window.crypto || window.msCrypto).getRandomValues(a); }
    catch (e) { for (var j = 0; j < a.length; j++) a[j] = Math.floor(Math.random() * 256); }
    for (var i = 0; i < a.length; i++) s += abc[a[i] % abc.length];
    return s;
  }
  function tabId() {
    try {
      var v = sessionStorage.getItem('tthGamesSid');
      if (!v) { v = rand(24); sessionStorage.setItem('tthGamesSid', v); }
      return v;
    } catch (e) { return window.__tthSid || (window.__tthSid = rand(24)); }
  }
  function loadPlayer() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function savePlayer(p) { try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch (e) {} }

  var sid = tabId();
  var player = loadPlayer();
  var slug = document.documentElement.getAttribute('data-game') || null;
  var firstVisit = true;
  try { firstVisit = !sessionStorage.getItem('tthGamesVisit'); } catch (e) {}
  var last = null, listeners = [];
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
  function emit(d) { last = d; for (var i = 0; i < listeners.length; i++) try { listeners[i](d, player); } catch (e) {} }

  function post(path, body) {
    return fetch(API + path, { method: 'POST', body: JSON.stringify(body), keepalive: true })   // text/plain: no preflight
      .then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
  }

  function ping() {
    if (document.hidden || !window.fetch) return Promise.resolve(null);
    var body = { sid: sid };
    if (firstVisit) body.visit = true;
    if (slug) body.slug = slug;
    if (player) { body.pid = player.pid; body.name = player.name; if (player.sig) body.sig = player.sig; }
    return post('/games/ping', body).then(function (d) {
      if (!d || d._status !== 200) return null;
      if (firstVisit) { firstVisit = false; try { sessionStorage.setItem('tthGamesVisit', '1'); } catch (e) {} }
      show(d);
      if (d.nameOk !== false) emit(d);
      return d;
    }).catch(function () { return null; });
  }

  window.TTHArcade = {
    api: API,
    player: function () { return player; },
    last: function () { return last; },
    onUpdate: function (fn) { listeners.push(fn); if (last) fn(last, player); },
    // Join with a nickname: a random id kept in this browser, no account.
    setNickname: function (name) {
      var prev = player;
      player = { pid: prev ? prev.pid : 'n_' + rand(24), sig: prev && prev.sig, name: name, kind: prev ? prev.kind : 'nick' };
      return ping().then(function (d) {
        if (d && d.nameOk === false) player = prev;   // the Worker turned the name down: keep the old one
        savePlayer(player);
        return d;
      });
    },
    // Join with Google: the Worker checks Google's token and returns a signed id.
    signInWithGoogle: function (credential, name) {
      return post('/games/login', { credential: credential }).then(function (r) {
        if (r._status !== 200) throw new Error(r.error || 'sign-in failed');
        player = { pid: r.pid, sig: r.sig, name: name || r.name || (player && player.name) || '', kind: 'google' };
        savePlayer(player);
        return r;
      });
    },
    // Leave the boards: forget this player here and on the server.
    leave: function () {
      var p = player; player = null; savePlayer(null);
      return p ? post('/games/forget', { pid: p.pid, sig: p.sig }).catch(function () {}) : Promise.resolve();
    },
    board: function () { return fetch(API + '/games/board').then(function (r) { return r.ok ? r.json() : null; }); },
    ping: ping
  };

  ping();
  setInterval(ping, EVERY);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ping(); });
  window.addEventListener('pagehide', function () {
    try { navigator.sendBeacon(API + '/games/leave', JSON.stringify({ sid: sid })); } catch (e) {}
  });
})();
