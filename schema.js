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
// Vibe Check: this round's guess on the 0–100 scale (-1 = not placed yet)
type('number')(Player.prototype, 'vibeGuess');
type('boolean')(Player.prototype, 'vibeLocked');
// Draw It: whether this player already guessed the current word
type('boolean')(Player.prototype, 'drawGuessed');
// Who Am I?: whether this player already named the current character
type('boolean')(Player.prototype, 'whoGuessed');
// Space Hunt: ship heading in radians (velocity stays server-side)
type('number')(Player.prototype, 'angle');

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

// ── Space Hunt entities ─────────────────────────────────────────────
// Self-contained (like Bomb): the server mutates x,y each tick. IDs let the
// client preserve render state and smoothly predict moving entities between
// room updates.
class Bullet extends Schema {}
type('number')(Bullet.prototype, 'id');
type('number')(Bullet.prototype, 'x');
type('number')(Bullet.prototype, 'y');
type('number')(Bullet.prototype, 'vx');
type('number')(Bullet.prototype, 'vy');
type('string')(Bullet.prototype, 'ownerId');
type('number')(Bullet.prototype, 'born');

class Asteroid extends Schema {}
type('number')(Asteroid.prototype, 'id');
type('number')(Asteroid.prototype, 'x');
type('number')(Asteroid.prototype, 'y');
type('number')(Asteroid.prototype, 'vx');
type('number')(Asteroid.prototype, 'vy');
type('number')(Asteroid.prototype, 'radius');

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
// 'bomberman', 'snake', 'hangman', 'vibecheck', 'drawit' or 'whoami' —
// chosen by the host in the lobby
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
// ── Vibe Check state (unused for other games) ──────────────────────
// The target position never leaves the server during a round; it is sent
// privately to the psychic and only synced here during the reveal.
type('string')(GameState.prototype, 'vibePhase');      // '' | 'clue' | 'guess' | 'reveal'
type('string')(GameState.prototype, 'vibeScaleLeft');  // left end of the scale
type('string')(GameState.prototype, 'vibeScaleRight'); // right end of the scale
type('string')(GameState.prototype, 'vibeClue');       // the psychic's clue
type('string')(GameState.prototype, 'vibePsychicId');  // sessionId of this round's psychic
type('number')(GameState.prototype, 'vibeRound');
type('number')(GameState.prototype, 'vibeTotalRounds');
type('number')(GameState.prototype, 'vibeTarget');     // -1 while secret, 0–100 during reveal
type('number')(GameState.prototype, 'vibeDeadline');   // phase deadline (ms timestamp, 0 = none)
// ── Draw It state (unused for other games) ─────────────────────────
// The word never leaves the server during a round; the drawer gets it
// privately and everyone else only sees the mask (hint letters included).
type('string')(GameState.prototype, 'drawPhase');      // '' | 'draw' | 'reveal'
type('string')(GameState.prototype, 'drawDrawerId');   // sessionId of this round's drawer
type('string')(GameState.prototype, 'drawMasked');     // e.g. '_a__ ___' (spaces shown)
type('string')(GameState.prototype, 'drawWord');       // '' while secret, the word during reveal
type('number')(GameState.prototype, 'drawRound');
type('number')(GameState.prototype, 'drawTotalRounds');
type('number')(GameState.prototype, 'drawDeadline');   // phase deadline (ms timestamp, 0 = none)
// ── Who Am I? state (unused for other games) ───────────────────────
// The character name never leaves the server during a round; only the
// clues revealed so far are synced (newline-joined, hard → easy).
type('string')(GameState.prototype, 'whoPhase');         // '' | 'clue' | 'reveal'
type('string')(GameState.prototype, 'whoCharacter');     // '' while secret, the name during reveal
type('string')(GameState.prototype, 'whoClues');         // revealed clues joined with '\n'
type('number')(GameState.prototype, 'whoCluesRevealed'); // 1–5 during a round
type('number')(GameState.prototype, 'whoRound');
type('number')(GameState.prototype, 'whoTotalRounds');
type('number')(GameState.prototype, 'whoDeadline');      // round deadline (ms timestamp, 0 = none)
// ── Space Hunt state (unused for other games) ──────────────────────
type([Bullet])(GameState.prototype, 'bullets');
type([Asteroid])(GameState.prototype, 'asteroids');

module.exports = { Position, Player, Bomb, Explosion, Pickup, Wall, Bullet, Asteroid, GameState };
