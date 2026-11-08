// Built-in list of games the arcade counts play time for. Should match the slugs
// in assets/js/games-data.js; test/games.test.mjs fails if the two drift apart.
// A game added to the site without updating this list still counts: the Worker
// re-reads games-data.js from thetechhut.co when it sees an unknown slug.
export const GAME_SLUGS = [
  'matatu-manager', 'lagos-life', 'quake3', 'doom', 'krunker', 'shell-shockers', 'venge', 'kour', 'evio',
  'deadshot', 'distrito-rabisco', 'xonotic', '1v1lol', 'freeciv', 'openfront', 'hedgewars', 'lichess',
  'chesscom', 'bitburner', 'shapez', 'polytrack', 'slow-roads', 'hexgl', 'drive-mad', 'kart-bros', 'dashcraft', 'free-rider-hd', 'smash-karts', 'js-racer', 'wordle',
  '2048', 'hextris', 'tetris', 'little-alchemy-2', 'solitaire', 'minesweeper', 'skribbl', 'snake', 'pacman',
  'celeste-classic', 'qwop', 'line-rider', 'minecraft-classic', 'bloxd', 'townscaper', 'sandspiel',
  'infinite-craft', 'slither', 'agar', 'diep', 'diablo', 'a-dark-room', 'cookie-clicker', 'paperclips',
  'sudoku',
  'flexbox-froggy', 'grid-garden', 'css-diner', 'elevator-saga', 'untrusted', 'sql-murder-mystery', 'narrow-one', 'generals', 'territorial', 'ogs-go', 'lidraughts', 'quordle', 'nerdle', 'worldle', 'globle', 'orb-farm', 'moomoo', 'zombs-royale', 'candy-box-2', 'kittens-game', 'antimatter-dimensions', 'trimps',
];
