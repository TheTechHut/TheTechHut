/* The Tech Hut games directory: free browser games that are legal to play.
 *
 * Every game here is one of: official and free from whoever owns it, open
 * source, freeware, or an official shareware/demo release. Unofficial copies
 * of commercial games (Call of Duty, GTA, Halo, Counter-Strike 1.6 ports and
 * the like) are left out on purpose, as are games that need you to load your
 * own copy of a commercial game's files.
 *
 * Fields:
 *   slug   used in /games/play/?g=<slug>
 *   cat    one of CATS below
 *   legal  'official' | 'open-source' | 'shareware' | 'indie'
 *   phone  true: plays on a phone; false: needs a keyboard (and usually a mouse)
 *   embed  true: opens inside thetechhut.co (the game's site allows being
 *          framed: no X-Frame-Options or frame-ancestors block, checked in Chrome
 *          on 21 Oct 2026); false: opens the game's own site in a new tab.
 *          Only set true after checking the page loads in a frame.
 */
(function (root) {
  var CATS = [
    ['africa', 'Made in Africa'], ['shooters', 'Shooters'], ['strategy', 'Strategy'], ['racing', 'Racing'],
    ['puzzle', 'Puzzle & word'], ['arcade', 'Arcade'], ['sandbox', 'Sandbox & creative'],
    ['io', 'Multiplayer .io'], ['retro', 'Retro classics'], ['idle', 'Idle & text']
  ];
  var G = [
    // Made in Africa
    { slug: 'lagos-life', name: 'Lagos Life', cat: 'africa', url: 'https://lagoslife.app', legal: 'indie', phone: true, embed: false,
      by: 'Shalom Rayhamen (Vatar), Nigeria', line: 'Build a life in Lagos: get a job, rent a place, get around the city and meet other players. Free, with optional paid extras.' },

    // Shooters
    { slug: 'quake3', name: 'Quake III Arena (demo)', cat: 'shooters', url: 'https://q3js.com/', legal: 'shareware', phone: true, embed: false,
      by: 'Q3JS, on the open-source ioquake3 engine', line: 'The 1999 arena shooter with id Software\'s freely released demo maps, online against other players.' },
    { slug: 'doom', name: 'Doom (shareware episode)', cat: 'shooters', url: 'https://diekmann.github.io/wasm-fizzbuzz/doom/', legal: 'shareware', phone: true, embed: true,
      by: 'id Software\'s open-source engine, compiled to WebAssembly', line: 'The first episode of the 1993 original, Knee-Deep in the Dead, which id gave away free.' },
    { slug: 'krunker', name: 'Krunker', cat: 'shooters', url: 'https://krunker.io', legal: 'official', phone: true, embed: true,
      by: 'FRVR', line: 'Fast, blocky multiplayer FPS with classes, custom maps and a busy competitive scene.' },
    { slug: 'shell-shockers', name: 'Shell Shockers', cat: 'shooters', url: 'https://shellshock.io', legal: 'official', phone: false, embed: true,
      by: 'Blue Wizard Digital', line: 'Multiplayer shooter where everyone is an egg with a gun. Silly, and harder than it looks.' },
    { slug: 'venge', name: 'Venge.io', cat: 'shooters', url: 'https://venge.io', legal: 'indie', phone: false, embed: true,
      by: 'Independent', line: 'Team and free-for-all shooter with abilities and cards between rounds.' },
    { slug: 'kour', name: 'Kour.io', cat: 'shooters', url: 'https://kour.io', legal: 'indie', phone: true, embed: true,
      by: 'LEGiON Platforms', line: 'Quick-match blocky shooter that also runs on phones.' },
    { slug: 'evio', name: 'Ev.io', cat: 'shooters', url: 'https://ev.io', legal: 'indie', phone: false, embed: false,
      by: 'Independent', line: 'Sci-fi arena shooter in the style of Halo, with jump pads and clans.' },
    { slug: 'deadshot', name: 'Deadshot.io', cat: 'shooters', url: 'https://deadshot.io', legal: 'indie', phone: false, embed: true,
      by: 'Independent', line: 'Straightforward modern-military multiplayer shooter.' },
    { slug: 'xonotic', name: 'Xonotic (browser port)', cat: 'shooters', url: 'https://dpgame.xonotic.workers.dev/', legal: 'open-source', phone: false, embed: true,
      by: 'Community port of the GPL arena shooter', line: 'Fast, open-source arena FPS in the Quake tradition. An unofficial port, so it may move.' },
    { slug: '1v1lol', name: '1v1.LOL', cat: 'shooters', url: 'https://1v1.lol', legal: 'official', phone: true, embed: false,
      by: 'Justplay.LOL', line: 'Build-and-shoot duels and battle royale, Fortnite-style, in a browser tab.' },

    // Strategy
    { slug: 'freeciv', name: 'Freeciv-web', cat: 'strategy', url: 'https://play.freeciv.org', legal: 'open-source', phone: false, embed: false,
      by: 'The Freeciv project (AGPL)', line: 'Open-source Civilization: build cities, research, trade and go to war, against AI or people.' },
    { slug: 'openfront', name: 'OpenFront', cat: 'strategy', url: 'https://openfront.io', legal: 'open-source', phone: false, embed: false,
      by: 'OpenFront (AGPL)', line: 'Real-time territory war on real-world maps. Still in alpha.' },
    { slug: 'hedgewars', name: 'Hedgewars (WebWars)', cat: 'strategy', url: 'https://webwars.link', legal: 'open-source', phone: false, embed: false,
      by: 'Unofficial port of the GPL game', line: 'Worms-style turn-based artillery with hedgehogs. Hotseat or online.' },
    { slug: 'lichess', name: 'Lichess', cat: 'strategy', url: 'https://lichess.org', legal: 'open-source', phone: true, embed: false,
      by: 'Lichess (AGPL), free and ad-free', line: 'Chess against people or the computer, puzzles and lessons. No account needed to start.' },
    { slug: 'chesscom', name: 'Chess.com', cat: 'strategy', url: 'https://www.chess.com/play/online', legal: 'official', phone: true, embed: false,
      by: 'Chess.com', line: 'The biggest chess site; play as a guest without signing up.' },
    { slug: 'bitburner', name: 'Bitburner', cat: 'strategy', url: 'https://bitburner-official.github.io/', legal: 'open-source', phone: false, embed: true,
      by: 'Open source', line: 'A hacking game you play by writing real JavaScript. Good for learning to code.' },
    { slug: 'shapez', name: 'shapez (demo)', cat: 'strategy', url: 'https://shapez.io', legal: 'official', phone: false, embed: true,
      by: 'tobspr Games', line: 'Build factories that cut, paint and stack shapes. The browser demo of the Steam game.' },

    // Racing
    { slug: 'polytrack', name: 'PolyTrack', cat: 'racing', url: 'https://www.kodub.com/apps/polytrack', legal: 'indie', phone: true, embed: false,
      by: 'Kodub', line: 'Low-poly time-trial racer with a track editor. Easy to start, hard to master.' },
    { slug: 'slow-roads', name: 'Slow Roads', cat: 'racing', url: 'https://slowroads.io', legal: 'indie', phone: false, embed: true,
      by: 'Topograph', line: 'An endless, calm drive through landscapes generated as you go.' },
    { slug: 'hexgl', name: 'HexGL', cat: 'racing', url: 'https://hexgl.bkcore.com', legal: 'open-source', phone: false, embed: false,
      by: 'Thibaut Despoulain (MIT)', line: 'Futuristic anti-gravity racer in the spirit of Wipeout.' },
    { slug: 'smash-karts', name: 'Smash Karts', cat: 'racing', url: 'https://smashkarts.io', legal: 'official', phone: true, embed: true,
      by: 'Tall Team', line: 'Multiplayer kart battles with weapons. Short ads before rounds.' },
    { slug: 'js-racer', name: 'Javascript Racer', cat: 'racing', url: 'https://jakesgordon.com/games/racer/', legal: 'indie', phone: false, embed: false,
      by: 'Jake Gordon', line: 'Retro pseudo-3D racer like the 1980s arcades, built in plain JavaScript.' },

    // Puzzle & word
    { slug: 'wordle', name: 'Wordle', cat: 'puzzle', url: 'https://www.nytimes.com/games/wordle/', legal: 'official', phone: true, embed: false,
      by: 'The New York Times', line: 'Guess the five-letter word in six tries. One a day.' },
    { slug: '2048', name: '2048', cat: 'puzzle', url: 'https://play2048.co', legal: 'open-source', phone: true, embed: false,
      by: 'Gabriele Cirulli', line: 'Slide numbered tiles together until you reach 2048.' },
    { slug: 'hextris', name: 'Hextris', cat: 'puzzle', url: 'https://hextris.io', legal: 'open-source', phone: true, embed: false,
      by: 'Hextris team (GPL)', line: 'Tetris meets a spinning hexagon. Rotate to catch falling blocks.' },
    { slug: 'tetris', name: 'Tetris', cat: 'puzzle', url: 'https://play.tetris.com/', legal: 'official', phone: true, embed: true,
      by: 'The Tetris Company', line: 'The official free version of the original.' },
    { slug: 'little-alchemy-2', name: 'Little Alchemy 2', cat: 'puzzle', url: 'https://littlealchemy2.com', legal: 'official', phone: true, embed: true,
      by: 'Recloak', line: 'Combine elements to discover hundreds of new things.' },
    { slug: 'solitaire', name: 'Solitaire', cat: 'puzzle', url: 'https://www.google.com/search?q=solitaire', legal: 'official', phone: true, embed: false,
      by: 'Google', line: 'Classic Klondike, built into Google search. Press Play on the results page.' },
    { slug: 'minesweeper', name: 'Minesweeper', cat: 'puzzle', url: 'https://www.google.com/search?q=minesweeper', legal: 'official', phone: true, embed: false,
      by: 'Google', line: 'The Windows classic, built into Google search.' },
    { slug: 'skribbl', name: 'skribbl.io', cat: 'puzzle', url: 'https://skribbl.io', legal: 'indie', phone: true, embed: true,
      by: 'Independent', line: 'Draw a word while your friends guess it. Make a private room for your group.' },

    // Arcade
    { slug: 'snake', name: 'Snake', cat: 'arcade', url: 'https://www.google.com/search?q=play+snake', legal: 'official', phone: true, embed: false,
      by: 'Google', line: 'The Nokia-era classic, built into Google search.' },
    { slug: 'pacman', name: 'Pac-Man (Google Doodle)', cat: 'arcade', url: 'https://www.google.com/logos/2010/pacman10-i.html', legal: 'official', phone: false, embed: false,
      by: 'Google, with Bandai Namco', line: 'The playable 30th-anniversary Pac-Man doodle from 2010.' },
    { slug: 'celeste-classic', name: 'Celeste Classic', cat: 'arcade', url: 'https://www.lexaloffle.com/bbs/?tid=2145', legal: 'official', phone: false, embed: true,
      by: 'Maddy Thorson and Noel Berry', line: 'The tiny PICO-8 platformer that became Celeste. Climb the mountain.' },
    { slug: 'qwop', name: 'QWOP', cat: 'arcade', url: 'https://www.foddy.net/Athletics.html', legal: 'official', phone: false, embed: true,
      by: 'Bennett Foddy', line: 'Run 100 metres using four keys for your legs. Famously hard.' },
    { slug: 'line-rider', name: 'Line Rider', cat: 'arcade', url: 'https://www.linerider.com', legal: 'official', phone: false, embed: true,
      by: 'Line Rider', line: 'Draw a track and watch a tiny sledder ride it.' },

    // Sandbox & creative
    { slug: 'minecraft-classic', name: 'Minecraft Classic', cat: 'sandbox', url: 'https://classic.minecraft.net', legal: 'official', phone: false, embed: true,
      by: 'Mojang', line: 'The 2009 original with 32 blocks, re-released free by Mojang. Invite friends with a link.' },
    { slug: 'bloxd', name: 'Bloxd.io', cat: 'sandbox', url: 'https://bloxd.io', legal: 'indie', phone: true, embed: true,
      by: 'Independent', line: 'Block-building sandbox and mini-games. No download, no login.' },
    { slug: 'townscaper', name: 'Townscaper (demo)', cat: 'sandbox', url: 'https://oskarstalberg.com/Townscaper/', legal: 'official', phone: false, embed: true,
      by: 'Oskar Stålberg', line: 'Click to grow a little island town. Calm and pretty. Desktop only.' },
    { slug: 'sandspiel', name: 'Sandspiel', cat: 'sandbox', url: 'https://sandspiel.club', legal: 'open-source', phone: true, embed: true,
      by: 'Max Bittker (MIT)', line: 'Falling-sand toy: pour water, plant seeds, start fires.' },
    { slug: 'infinite-craft', name: 'Infinite Craft', cat: 'sandbox', url: 'https://neal.fun/infinite-craft/', legal: 'official', phone: true, embed: false,
      by: 'Neal Agarwal', line: 'Start with water, fire, wind and earth, and combine your way to anything.' },

    // Multiplayer .io
    { slug: 'slither', name: 'slither.io', cat: 'io', url: 'http://slither.io', legal: 'indie', phone: true, embed: false,
      by: 'Steve Howse', line: 'Grow your snake by eating, and cut others off.' },
    { slug: 'agar', name: 'agar.io', cat: 'io', url: 'https://agar.io', legal: 'official', phone: true, embed: false,
      by: 'Miniclip', line: 'Eat smaller cells, avoid bigger ones. The game that started the .io wave.' },
    { slug: 'diep', name: 'diep.io', cat: 'io', url: 'https://diep.io', legal: 'indie', phone: true, embed: true,
      by: 'Independent', line: 'Upgrade your tank and battle in a shared arena.' },

    // Retro classics
    { slug: 'diablo', name: 'Diablo (shareware)', cat: 'retro', url: 'https://d07riv.github.io/diabloweb/', legal: 'shareware', phone: true, embed: true,
      by: 'DiabloWeb, a fan port running Blizzard\'s free 1997 shareware', line: 'The first two levels of the dark 1996 action RPG, from the free shareware release.' },

    // Idle & text
    { slug: 'a-dark-room', name: 'A Dark Room', cat: 'idle', url: 'https://adarkroom.doublespeakgames.com', legal: 'official', phone: true, embed: true,
      by: 'Doublespeak Games', line: 'Starts with a cold room and a fire. Text adventure that keeps growing.' },
    { slug: 'cookie-clicker', name: 'Cookie Clicker', cat: 'idle', url: 'https://orteil.dashnet.org/cookieclicker/', legal: 'official', phone: true, embed: true,
      by: 'Orteil', line: 'Click a cookie. Buy grandmas. Lose a weekend.' },
    { slug: 'paperclips', name: 'Universal Paperclips', cat: 'idle', url: 'https://www.decisionproblem.com/paperclips/index2.html', legal: 'official', phone: false, embed: true,
      by: 'Frank Lantz', line: 'You are an AI told to make paperclips. A short, famous game about where that leads.' }
  ];
  var api = { CATS: CATS, GAMES: G };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.TTHGames = api;
})(this);
