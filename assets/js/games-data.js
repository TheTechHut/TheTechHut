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
    ['africa', 'Made in Africa'], ['code', 'Learn to code'], ['shooters', 'Shooters'], ['strategy', 'Strategy'], ['racing', 'Racing'],
    ['puzzle', 'Puzzle & word'], ['arcade', 'Arcade'], ['sandbox', 'Sandbox & creative'],
    ['io', 'Multiplayer .io'], ['retro', 'Retro classics'], ['idle', 'Idle & text']
  ];
  var G = [
    // Made in Africa
    { slug: 'matatu-manager', name: 'Matatu Manager', cat: 'africa', url: 'https://matatumanager.com/', legal: 'indie', phone: true, embed: true,
      by: 'Kerubi Canvas Animation Studios, Kenya', line: 'Customise your matatu, take on trips and solve puzzles when things go wrong on the road. Compete in the league.' },
    { slug: 'lagos-life', name: 'Lagos Life', cat: 'africa', url: 'https://lagoslife.app', legal: 'indie', phone: true, embed: false,
      by: 'Shalom Rayhamen (Vatar), Nigeria', line: 'Build a life in Lagos: get a job, rent a place, get around the city and meet other players. Free, with optional paid extras.' },

    // Learn to code
    { slug: 'flexbox-froggy', name: 'Flexbox Froggy', cat: 'code', url: 'https://flexboxfroggy.com/', legal: 'indie', phone: false, embed: true,
      by: 'Codepip (Thomas Park)', line: 'Get the frogs onto their lily pads by writing CSS flexbox. 24 levels; you will never forget justify-content again.' },
    { slug: 'grid-garden', name: 'Grid Garden', cat: 'code', url: 'https://cssgridgarden.com/', legal: 'indie', phone: false, embed: true,
      by: 'Codepip (Thomas Park)', line: 'Water your carrots and poison the weeds using CSS grid. The fastest way to learn grid layout.' },
    { slug: 'css-diner', name: 'CSS Diner', cat: 'code', url: 'https://flukeout.github.io/', legal: 'open-source', phone: false, embed: true,
      by: 'Luke Pacholski', line: 'Pick plates, apples and pickles off a table with CSS selectors. 32 levels, from tags to :nth-of-type.' },
    { slug: 'elevator-saga', name: 'Elevator Saga', cat: 'code', url: 'https://play.elevatorsaga.com/', legal: 'open-source', phone: false, embed: true,
      by: 'Magnus Wolffelt', line: 'Program the elevators of a building in JavaScript and move everyone fast enough to beat each challenge.' },
    { slug: 'untrusted', name: 'Untrusted', cat: 'code', url: 'https://untrustedgame.com/', legal: 'open-source', phone: false, embed: true,
      by: 'Alex Nisnevich & Greg Shuflin', line: 'A roguelike where you escape each level by editing its JavaScript source. Hacking as a puzzle game.' },
    { slug: 'sql-murder-mystery', name: 'SQL Murder Mystery', cat: 'code', url: 'https://mystery.knightlab.com/', legal: 'official', phone: false, embed: false,
      by: 'Northwestern University Knight Lab', line: 'A murder in SQL City. Query the police database to find the killer. Good practice for data interviews.' },

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
    { slug: 'distrito-rabisco', name: 'Distrito Rabisco', cat: 'shooters', url: 'https://rabisco.net/', legal: 'indie', phone: true, embed: true,
      by: 'Alan Nicolas', line: 'A first-person firefight drawn in ink on notebook paper. Play solo or with friends, on 20-plus hand-drawn maps.' },
    { slug: 'xonotic', name: 'Xonotic (browser port)', cat: 'shooters', url: 'https://dpgame.xonotic.workers.dev/', legal: 'open-source', phone: false, embed: true,
      by: 'Community port of the GPL arena shooter', line: 'Fast, open-source arena FPS in the Quake tradition. An unofficial port, so it may move.' },
    { slug: '1v1lol', name: '1v1.LOL', cat: 'shooters', url: 'https://1v1.lol', legal: 'official', phone: true, embed: false,
      by: 'Justplay.LOL', line: 'Build-and-shoot duels and battle royale, Fortnite-style, in a browser tab.' },
    { slug: 'narrow-one', name: 'Narrow One', cat: 'shooters', url: 'https://narrow.one/', legal: 'indie', phone: false, embed: true,
      by: 'Pelican Party Studios', line: 'Capture-the-flag with bows and arrows in medieval castles. Five-a-side, all in the browser.' },

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
    { slug: 'generals', name: 'generals.io', cat: 'strategy', url: 'https://generals.io/', legal: 'indie', phone: false, embed: true,
      by: 'generals.io', line: 'Fast online war game: grow your army, find the enemy general and capture it before they find yours.' },
    { slug: 'territorial', name: 'Territorial.io', cat: 'strategy', url: 'https://territorial.io/', legal: 'indie', phone: true, embed: true,
      by: 'David Tschacher', line: 'Expand across a map against hundreds of players. Simple controls, rounds of a few minutes.' },
    { slug: 'ogs-go', name: 'Online Go (OGS)', cat: 'strategy', url: 'https://online-go.com/', legal: 'official', phone: true, embed: true,
      by: 'Online-Go.com', line: 'Play Go, the 4,000-year-old board game, against people or bots. Free, with lessons for beginners.' },
    { slug: 'lidraughts', name: 'Lidraughts', cat: 'strategy', url: 'https://lidraughts.org/', legal: 'open-source', phone: true, embed: true,
      by: 'Lidraughts (sister to Lichess)', line: 'Free, ad-free draughts online, with puzzles, analysis and international and other rule sets.' },

    // Racing
    { slug: 'polytrack', name: 'PolyTrack', cat: 'racing', url: 'https://www.kodub.com/apps/polytrack', legal: 'indie', phone: true, embed: false,
      by: 'Kodub', line: 'Low-poly time-trial racer with a track editor. Easy to start, hard to master.' },
    { slug: 'slow-roads', name: 'Slow Roads', cat: 'racing', url: 'https://slowroads.io', legal: 'indie', phone: false, embed: true,
      by: 'Topograph', line: 'An endless, calm drive through landscapes generated as you go.' },
    { slug: 'hexgl', name: 'HexGL', cat: 'racing', url: 'https://hexgl.bkcore.com', legal: 'open-source', phone: false, embed: false,
      by: 'Thibaut Despoulain (MIT)', line: 'Futuristic anti-gravity racer in the spirit of Wipeout.' },
    { slug: 'drive-mad', name: 'Drive Mad', cat: 'racing', url: 'https://poki.com/en/g/drive-mad', legal: 'official', phone: true, embed: false,
      by: 'Fancade (Martin Magni), on Poki', line: 'Physics driving puzzles: get odd vehicles over bridges and ramps to the finish without flipping. Short ads between levels.' },
    { slug: 'kart-bros', name: 'Kart Bros', cat: 'racing', url: 'https://kartbros.io/', legal: 'indie', phone: true, embed: true,
      by: 'The Bros games team', line: 'Kart racing with rockets, shields and drifting. Race bots or friends online, or build your own track.' },
    { slug: 'dashcraft', name: 'DashCraft.io', cat: 'racing', url: 'https://dashcraft.io/', legal: 'indie', phone: false, embed: true,
      by: 'DashCraft', line: 'Build a stunt track out of blocks, then race it against other players online. Loops, jumps and ramps.' },
    { slug: 'free-rider-hd', name: 'Free Rider HD', cat: 'racing', url: 'https://www.freeriderhd.com/', legal: 'official', phone: false, embed: true,
      by: 'Kano Games', line: 'Ride a bike over tracks drawn by other players, or draw your own. Thousands of community tracks.' },
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
    { slug: 'quordle', name: 'Quordle', cat: 'puzzle', url: 'https://www.merriam-webster.com/games/quordle/', legal: 'official', phone: true, embed: true,
      by: 'Merriam-Webster', line: 'Four Wordles at once with nine guesses. Harder than it sounds.' },
    { slug: 'nerdle', name: 'Nerdle', cat: 'puzzle', url: 'https://nerdlegame.com/', legal: 'indie', phone: true, embed: false,
      by: 'Richard Mann', line: 'Wordle with sums: guess the hidden equation in six tries.' },
    { slug: 'worldle', name: 'Worldle', cat: 'puzzle', url: 'https://worldle.teuteuf.fr/', legal: 'indie', phone: true, embed: false,
      by: 'teuteuf', line: 'Guess the country from its outline. Each wrong guess tells you how far off and in which direction.' },
    { slug: 'sudoku', name: 'Sudoku (sudoku.coach)', cat: 'puzzle', url: 'https://sudoku.coach/', legal: 'indie', phone: true, embed: true,
      by: 'sudoku.coach', line: 'Free, ad-free sudoku from easy to expert, plus variants and step-by-step tutorials on solving techniques.' },
    { slug: 'globle', name: 'Globle', cat: 'puzzle', url: 'https://globle-game.com/', legal: 'indie', phone: true, embed: true,
      by: 'Abe Train', line: 'Find the mystery country on a globe. Your guesses glow hotter the closer you get.' },

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
    { slug: 'orb-farm', name: 'Orb.Farm', cat: 'sandbox', url: 'https://orb.farm/', legal: 'indie', phone: true, embed: true,
      by: 'Max Bittker', line: 'Build a tiny aquatic ecosystem in a glass orb: sand, water, plants, daphnia and fish that live or die by your balance.' },

    // Multiplayer .io
    { slug: 'slither', name: 'slither.io', cat: 'io', url: 'http://slither.io', legal: 'indie', phone: true, embed: false,
      by: 'Steve Howse', line: 'Grow your snake by eating, and cut others off.' },
    { slug: 'agar', name: 'agar.io', cat: 'io', url: 'https://agar.io', legal: 'official', phone: true, embed: false,
      by: 'Miniclip', line: 'Eat smaller cells, avoid bigger ones. The game that started the .io wave.' },
    { slug: 'diep', name: 'diep.io', cat: 'io', url: 'https://diep.io', legal: 'indie', phone: true, embed: true,
      by: 'Independent', line: 'Upgrade your tank and battle in a shared arena.' },
    { slug: 'moomoo', name: 'MooMoo.io', cat: 'io', url: 'https://moomoo.io/', legal: 'indie', phone: false, embed: true,
      by: 'MooMoo.io', line: 'Gather wood and stone, farm, build walls and windmills, and defend your base against other players.' },
    { slug: 'zombs-royale', name: 'ZombsRoyale.io', cat: 'io', url: 'https://zombsroyale.io/', legal: 'official', phone: false, embed: true,
      by: 'End Game', line: 'A 2D battle royale for up to 100 players. Loot, build and be the last one standing.' },

    // Retro classics
    { slug: 'diablo', name: 'Diablo (shareware)', cat: 'retro', url: 'https://d07riv.github.io/diabloweb/', legal: 'shareware', phone: true, embed: true,
      by: 'DiabloWeb, a fan port running Blizzard\'s free 1997 shareware', line: 'The first two levels of the dark 1996 action RPG, from the free shareware release.' },

    // Idle & text
    { slug: 'a-dark-room', name: 'A Dark Room', cat: 'idle', url: 'https://adarkroom.doublespeakgames.com', legal: 'official', phone: true, embed: true,
      by: 'Doublespeak Games', line: 'Starts with a cold room and a fire. Text adventure that keeps growing.' },
    { slug: 'cookie-clicker', name: 'Cookie Clicker', cat: 'idle', url: 'https://orteil.dashnet.org/cookieclicker/', legal: 'official', phone: true, embed: true,
      by: 'Orteil', line: 'Click a cookie. Buy grandmas. Lose a weekend.' },
    { slug: 'paperclips', name: 'Universal Paperclips', cat: 'idle', url: 'https://www.decisionproblem.com/paperclips/index2.html', legal: 'official', phone: false, embed: true,
      by: 'Frank Lantz', line: 'You are an AI told to make paperclips. A short, famous game about where that leads.' },
    { slug: 'candy-box-2', name: 'Candy Box 2', cat: 'idle', url: 'https://candybox2.github.io/', legal: 'open-source', phone: true, embed: true,
      by: 'aniwey', line: 'You have candies. Then a sword, a quest and an ASCII-art world that keeps getting bigger.' },
    { slug: 'kittens-game', name: 'Kittens Game', cat: 'idle', url: 'https://kittensgame.com/web/', legal: 'open-source', phone: true, embed: true,
      by: 'Bloodrizer', line: 'Build a civilisation of kittens: catnip, then science, then space. A deep, slow idle game.' },
    { slug: 'antimatter-dimensions', name: 'Antimatter Dimensions', cat: 'idle', url: 'https://ivark.github.io/AntimatterDimensions/', legal: 'open-source', phone: true, embed: true,
      by: 'IvarK', line: 'An idle game about making numbers huge, with layer on layer of resets and a surprising story.' },
    { slug: 'trimps', name: 'Trimps', cat: 'idle', url: 'https://trimps.github.io/', legal: 'open-source', phone: true, embed: true,
      by: 'Trimps team', line: 'Lead little Trimps through zones of fights, gathering and upgrades. Long-haul idle strategy.' }
  ];
  var api = { CATS: CATS, GAMES: G };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.TTHGames = api;
})(this);
