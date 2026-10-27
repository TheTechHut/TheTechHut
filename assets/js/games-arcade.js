/* The Tech Hut games: the arcade section on /games/ (leaderboards, the
 * player card, badges and "playing now" chips on game cards).
 * Needs games-data.js and games-live.js on the page first.
 *
 * Sign in with Google stays hidden until GOOGLE_CLIENT_ID is filled in below
 * and the same id and GAMES_SECRET are set on the Worker (worker/README.md).
 */
(function () {
  var GOOGLE_CLIENT_ID = '';   // e.g. '1234-abc.apps.googleusercontent.com'

  var A = window.TTHArcade, D = window.TTHGames;
  var root = document.getElementById('arcade');
  if (!A || !D || !root) return;
  var NAMES = {}; D.GAMES.forEach(function (g) { NAMES[g.slug] = g; });
  var board = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function dur(s) {
    s = Math.round(s || 0);
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function gname(slug) { return NAMES[slug] ? NAMES[slug].name : slug; }
  function tick(v) { return v ? ' <span class="ver" title="Signed in with Google">&#10003;</span>' : ''; }
  function $(id) { return document.getElementById(id); }

  /* ---- leaderboards ------------------------------------------------------ */
  function list(el, rows, fmt, empty) {
    el.innerHTML = rows.length
      ? rows.map(function (r, i) { return '<li><span class="rk r' + (i + 1) + '">' + (i + 1) + '</span>' + fmt(r) + '</li>'; }).join('')
      : '<li class="empty">' + empty + '</li>';
  }
  function drawBoards() {
    if (!board) return;
    var wk = /W(\d+)/.exec(board.week || '');
    $('aweek').textContent = (wk ? 'Week ' + Number(wk[1]) + ' · ' : '') + 'resets Monday 00:00 Nairobi time';
    var games = board.games.filter(function (g) { return NAMES[g.slug] && g.secs > 0; }).slice(0, 5);
    list($('agames'), games, function (g) {
      return '<a href="/games/play/?g=' + encodeURIComponent(g.slug) + '">' + esc(gname(g.slug)) + '</a>' +
        '<span class="v">' + dur(g.secs) + ' · ' + g.plays + (g.plays === 1 ? ' play' : ' plays') + '</span>';
    }, 'Nothing played yet this week. Open any game marked Plays here.');
    list($('aplayers'), board.players.slice(0, 5), function (p) {
      return '<b>' + esc(p.name) + tick(p.verified) + '</b><span class="v">' + dur(p.secs) +
        (p.top && NAMES[p.top] ? ' · mostly ' + esc(gname(p.top)) : '') + '</span>';
    }, 'No one on the board yet. Join below and play to take first place.');
    list($('asessions'), board.sessions.slice(0, 5), function (s) {
      return '<b>' + esc(s.name) + tick(s.verified) + '</b><span class="v">' + dur(s.secs) + ' of ' + esc(gname(s.slug)) + '</span>';
    }, 'The longest single sitting this week goes here.');
    root.hidden = false;
    marks();
  }
  // "Playing now" and "Top 3 this week" chips on the game cards below.
  function marks() {
    if (!board) return;
    var top = board.games.filter(function (g) { return g.secs > 0; }).slice(0, 3).map(function (g) { return g.slug; });
    document.querySelectorAll('[data-arcade-slug]').forEach(function (el) {
      var slug = el.getAttribute('data-arcade-slug'), n = (board.liveBySlug || {})[slug] || 0, i = top.indexOf(slug), h = '';
      if (i >= 0) h += '<span class="atop">#' + (i + 1) + ' this week</span>';
      if (n) h += '<span class="anow"><i></i>' + n + ' playing</span>';
      el.innerHTML = h; el.hidden = !h;
    });
  }
  function refresh() { return A.board().then(function (b) { if (b) { board = b; drawBoards(); } }).catch(function () {}); }

  /* ---- the player card --------------------------------------------------- */
  var BADGES = [
    ['First play', 'Play any game here for a minute', function (m) { return m.secs >= 60; }],
    ['Explorer', 'Play 5 different games in a week', function (m) { return m.games >= 5; }],
    ['Marathon', 'Play one game for 30 minutes in one sitting', function (m) { return m.best >= 1800; }],
    ['Regular', 'Play on 3 different days in a week', function (m) { return m.days >= 3; }],
    ['Top 10', 'Finish the week in the top 10 players', function (m) { return m.rank && m.rank <= 10 && m.secs >= 60; }],
    ['Made in Africa', 'Play Matatu Manager', function (m) { return (m.played || []).indexOf('matatu-manager') >= 0; }]
  ];
  var editing = false;

  function joinForm(prefill, msg) {
    return '<form class="ajoin" id="ajoin" novalidate>' +
      '<label for="anick">Nickname</label>' +
      '<div class="arow"><input id="anick" maxlength="20" autocomplete="nickname" placeholder="e.g. Wanjiku254" value="' + esc(prefill || '') + '">' +
      '<button class="btn" type="submit">' + (A.player() ? 'Save' : 'Join') + '</button></div>' +
      '<p class="amsg" id="amsg" role="status">' + (msg || '2 to 20 letters, numbers, spaces, dots or dashes. Keep it friendly.') + '</p></form>';
  }
  function drawCard() {
    var el = $('ame'), p = A.player(), d = A.last(), m = d && d.me;
    if (!p || editing) {
      el.innerHTML = '<span class="akick">Your arcade card</span>' +
        '<h3>' + (p ? 'Change your nickname' : 'Get on the leaderboard') + '</h3>' +
        (p ? '' : '<p>Pick a nickname, or sign in with Google for a verified tick. Your play time counts from the moment you join.</p>') +
        joinForm(p && p.name) +
        (!p && GOOGLE_CLIENT_ID ? '<div class="aor"><span>or</span></div><div id="agbtn"></div>' : '') +
        '<p class="apriv">We keep your nickname and how long you play here. Google sign-in keeps a scrambled id, never your email.</p>' +
        (p ? '<button type="button" class="alink" id="acancel">Cancel</button>' : '');
      bindForm();
      if (!p && GOOGLE_CLIENT_ID) loadGoogle();
      if (p) $('acancel').onclick = function () { editing = false; drawCard(); };
      return;
    }
    var badges = BADGES.map(function (b) {
      var got = m ? b[2](m) : false;
      return '<li class="' + (got ? 'got' : '') + '" title="' + esc(b[1]) + '">' + esc(b[0]) + '</li>';
    }).join('');
    el.innerHTML = '<span class="akick">Your arcade card</span>' +
      '<h3>' + esc(p.name) + tick(p.kind === 'google') + '</h3>' +
      '<dl class="astats">' +
        '<div><dt>Rank</dt><dd>' + (m && m.rank ? '#' + m.rank : '&ndash;') + '</dd></div>' +
        '<div><dt>This week</dt><dd>' + dur(m ? m.secs : 0) + '</dd></div>' +
        '<div><dt>Games</dt><dd>' + (m ? m.games : 0) + '</dd></div>' +
        '<div><dt>Best sitting</dt><dd>' + dur(m ? m.best : 0) + '</dd></div>' +
      '</dl>' +
      '<ul class="abadges" aria-label="Badges">' + badges + '</ul>' +
      '<p class="amsg">' + (m && m.secs ? 'Keep playing: time counts in any game marked Plays here.' : 'Open any game marked Plays here and your time starts counting.') + '</p>' +
      '<div class="aacts"><button type="button" class="alink" id="aedit">Change nickname</button>' +
      '<button type="button" class="alink" id="aleave">Leave the leaderboard</button></div>';
    $('aedit').onclick = function () { editing = true; drawCard(); };
    $('aleave').onclick = function () {
      if (!window.confirm('Remove your nickname and this week’s play time from the leaderboard?')) return;
      A.leave().then(function () { editing = false; drawCard(); refresh(); });
    };
  }
  function bindForm() {
    var f = $('ajoin'); if (!f) return;
    f.onsubmit = function (e) {
      e.preventDefault();
      var v = $('anick').value.replace(/\s+/g, ' ').trim();
      if (v.length < 2 || v.length > 20 || !/^[\p{L}\p{N} _.'-]+$/u.test(v)) {
        $('amsg').textContent = 'Use 2 to 20 letters, numbers, spaces, dots or dashes.'; $('amsg').className = 'amsg bad'; return;
      }
      $('amsg').textContent = 'Saving…'; $('amsg').className = 'amsg';
      A.setNickname(v).then(function (d) {
        if (d && d.nameOk === false) {
          editing = !!A.player(); drawCard();
          $('amsg').textContent = 'That nickname can\u2019t go on a public board. Try another.'; $('amsg').className = 'amsg bad';
          return;
        }
        editing = false; drawCard(); refresh();
      });
    };
  }
  function loadGoogle() {
    function render() {
      var box = $('agbtn'); if (!box || !window.google || !google.accounts) return;
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: function (r) {
        var name = ($('anick') && $('anick').value.trim()) || '';
        A.signInWithGoogle(r.credential, name).then(function (res) {
          var nick = name || res.name;
          if (nick) return A.setNickname(nick).then(function () { editing = false; drawCard(); refresh(); });
          editing = true; drawCard();
        }).catch(function () { $('amsg').textContent = 'Google sign-in didn’t work. Try again, or use a nickname.'; $('amsg').className = 'amsg bad'; });
      } });
      google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular' });
    }
    if (window.google && google.accounts) return render();
    if (!document.getElementById('gsi')) {
      var s = document.createElement('script'); s.id = 'gsi'; s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = render;
      document.head.appendChild(s);
    }
  }

  A.onUpdate(function () { if (!editing) drawCard(); });
  document.addEventListener('tth:grid', marks);
  drawCard();
  refresh();
  setInterval(function () { if (!document.hidden) refresh(); }, 60000);
})();
