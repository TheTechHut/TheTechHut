// Every game the arcade will count play time for. Must match the slugs in
// assets/js/games-data.js; test/games.test.mjs fails if the two drift apart.
// When you add a game to the directory, add its slug here too and redeploy.
export const GAME_SLUGS = [
  'matatu-manager', 'lagos-life', 'quake3', 'doom', 'krunker', 'shell-shockers', 'venge', 'kour', 'evio',
  'deadshot', 'distrito-rabisco', 'xonotic', '1v1lol', 'freeciv', 'openfront', 'hedgewars', 'lichess',
  'chesscom', 'bitburner', 'shapez', 'polytrack', 'slow-roads', 'hexgl', 'smash-karts', 'js-racer', 'wordle',
  '2048', 'hextris', 'tetris', 'little-alchemy-2', 'solitaire', 'minesweeper', 'skribbl', 'snake', 'pacman',
  'celeste-classic', 'qwop', 'line-rider', 'minecraft-classic', 'bloxd', 'townscaper', 'sandspiel',
  'infinite-craft', 'slither', 'agar', 'diep', 'diablo', 'a-dark-room', 'cookie-clicker', 'paperclips',
];
