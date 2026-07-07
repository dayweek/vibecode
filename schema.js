const { Schema, type } = require('@colyseus/schema');

// ── Schema definitions (shared by all games) ────────────────────────

class Position extends Schema {}
type('number')(Position.prototype, 'x');
type('number')(Position.prototype, 'y');

class Player extends Schema {}
type('number')(Player.prototype, 'x');
type('number')(Player.prototype, 'y');
// Snake-specific fields (unused while playing bomberman)
type('number')(Player.prototype, 'score');
type([Position])(Player.prototype, 'segments');
type('string')(Player.prototype, 'color');
type('string')(Player.prototype, 'playerName');
type('number')(Player.prototype, 'maxBombs');
type('number')(Player.prototype, 'activeBombs');
type('number')(Player.prototype, 'bombRange');
type('number')(Player.prototype, 'speedBoosts');
type('number')(Player.prototype, 'invisibleUntil');
type('number')(Player.prototype, 'protectedUntil');
type('number')(Player.prototype, 'lives');
type('boolean')(Player.prototype, 'alive');
type('string')(Player.prototype, 'killedBy');
type('number')(Player.prototype, 'lastMoveTime');
type('boolean')(Player.prototype, 'isMoving');
type('boolean')(Player.prototype, 'invisible');
type('boolean')(Player.prototype, 'ready');
type('boolean')(Player.prototype, 'isSpectator');
// Hangman team: 'A', 'B' or '' (unassigned)
type('string')(Player.prototype, 'team');

class Bomb extends Schema {}
type('number')(Bomb.prototype, 'x');
type('number')(Bomb.prototype, 'y');
type('number')(Bomb.prototype, 'placedTime');
type('string')(Bomb.prototype, 'playerId');
type('number')(Bomb.prototype, 'fuseTime');

class Explosion extends Schema {}
type('number')(Explosion.prototype, 'x');
type('number')(Explosion.prototype, 'y');
type('number')(Explosion.prototype, 'createdTime');
type('string')(Explosion.prototype, 'playerId');

class Pickup extends Schema {}
type('number')(Pickup.prototype, 'x');
type('number')(Pickup.prototype, 'y');
type('string')(Pickup.prototype, 'pickupType');

class Wall extends Schema {}
type('number')(Wall.prototype, 'x');
type('number')(Wall.prototype, 'y');

class GameState extends Schema {}
type({ map: Player })(GameState.prototype, 'players');
type([Bomb])(GameState.prototype, 'bombs');
type([Explosion])(GameState.prototype, 'explosions');
type([Pickup])(GameState.prototype, 'bombPickups');
type([Pickup])(GameState.prototype, 'powerups');
type([Wall])(GameState.prototype, 'indestructibleWalls');
type([Wall])(GameState.prototype, 'destructibleWalls');
type([Wall])(GameState.prototype, 'lavaTiles');
type([Position])(GameState.prototype, 'food'); // Snake food
type('string')(GameState.prototype, 'winnerId');
type('number')(GameState.prototype, 'gridWidth');
type('number')(GameState.prototype, 'gridHeight');
// 'lobby' = waiting room, 'playing' = game in progress
type('string')(GameState.prototype, 'phase');
type('string')(GameState.prototype, 'hostId');
// 'bomberman', 'snake' or 'hangman' — chosen by the host in the lobby
type('string')(GameState.prototype, 'gameType');
// ── Hangman state (unused for other games) ─────────────────────────
// The actual word never leaves the server; clients only see the mask.
type('string')(GameState.prototype, 'hangmanRevealed'); // e.g. '_pp_e'
type('string')(GameState.prototype, 'hangmanGuessed');  // all guessed letters, e.g. 'aept'
type('string')(GameState.prototype, 'hangmanTurn');     // 'A' or 'B'
type('string')(GameState.prototype, 'hangmanTheme');    // word theme key
type('number')(GameState.prototype, 'hangmanRound');
type('number')(GameState.prototype, 'hangmanTotalRounds');
type('number')(GameState.prototype, 'hangmanScoreA');
type('number')(GameState.prototype, 'hangmanScoreB');
type('number')(GameState.prototype, 'hangmanWrongA');
type('number')(GameState.prototype, 'hangmanWrongB');

module.exports = { Position, Player, Bomb, Explosion, Pickup, Wall, GameState };
