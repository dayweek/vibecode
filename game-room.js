const { Room, CloseCode } = require('colyseus');
const { Schema, type, ArraySchema, MapSchema } = require('@colyseus/schema');

// ── Schema definitions ──────────────────────────────────────────────

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
// 'bomberman' or 'snake' — chosen by the host in the lobby
type('string')(GameState.prototype, 'gameType');

// ── Constants ────────────────────────────────────────────────────────

const COLORS = [
    '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
    '#FFA500', '#800080', '#FFFFFF', '#008000', '#ADD8E6', '#FFC0CB',
    '#A52A2A', '#808080', '#FFD700', '#40E0D0', '#FA8072', '#90EE90',
    '#E6E6FA', '#D2B48C'
];

const CONFIG = {
    scale: 32,
    updateInterval: 100,
    moveInterval: 195,
    bombFuseTime: 3000,
    explosionDuration: 500,
    baseExplosionRange: 1,
    destructibleWallDensity: 0.55,
    hiddenBombChance: 0.333,
    flamePowerupChance: 0.25,
    speedPowerupChance: 0.25,
    invisibilityPowerupChance: 0.05,
    lifePowerupChance: 0.05,
    invisibilityDuration: 10000,
    lavaTileSpawnRate: 0.05,
    lavaWallReplacementRate: 0.02,
    maxSpeedBoosts: 5,
    maxPlayers: 20,
    inactivityTimeout: 60000,
};

const SNAKE_CONFIG = {
    width: 800,
    height: 800,
    scale: 20,
    baseMoveInterval: 200,
    speedFactor: 0.95,
    winningScore: 20,
};

// ── Room ─────────────────────────────────────────────────────────────

class GameRoom extends Room {

    onCreate(options) {
        this.setState(new GameState());
        this.state.players = new MapSchema();
        this.state.bombs = new ArraySchema();
        this.state.explosions = new ArraySchema();
        this.state.bombPickups = new ArraySchema();
        this.state.powerups = new ArraySchema();
        this.state.indestructibleWalls = new ArraySchema();
        this.state.destructibleWalls = new ArraySchema();
        this.state.lavaTiles = new ArraySchema();
        this.state.food = new ArraySchema();
        this.state.winnerId = '';
        this.state.gridWidth = 0;
        this.state.gridHeight = 0;
        this.state.phase = 'lobby';
        this.state.hostId = '';
        this.state.gameType = 'bomberman';

        this.maxClients = CONFIG.maxPlayers;

        // Internal state not synced to clients
        this.usedColors = new Set();
        this.wallLookup = new Set();
        this.indestructibleLookup = new Set();
        this.bombLookup = new Map();
        this.lavaLookup = new Set();
        this.spawnPoints = [];
        this.restartTimeout = null;

        // Per-player internal state (direction, activity time, hidden wall data)
        this.playerInternal = new Map();
        // Map of persistentId -> saved player data for reconnection
        this.persistentPlayers = new Map();
        // Map of sessionId -> persistentId
        this.sessionToPersistentId = new Map();
        this.cleanupTimeouts = new Map();
        // Hidden bomb flags per destructible wall index (not sent to client)
        this.wallHiddenBombs = [];

        // The room starts in the lobby; the grid is sized and generated once
        // when the host starts the game, and stays fixed for the whole game.
        this.participantsAtStart = 0;

        // Game loop
        this.setSimulationInterval(() => this.updateGameState(), CONFIG.updateInterval);

        // Inactivity check
        this.clock.setInterval(() => this.checkInactivity(), 5000);

        // ── Message handlers ──────────────────────────────────────────
        // Sanitize a client-supplied direction list down to valid unit steps
        const sanitizeDirections = (directions) =>
            (Array.isArray(directions) ? directions : [])
                .filter(d => d && (Math.abs(d.x) + Math.abs(d.y) === 1)
                    && [-1, 0, 1].includes(d.x) && [-1, 0, 1].includes(d.y))
                .map(d => ({ x: d.x, y: d.y }))
                .slice(0, 4);

        // Full list of held direction keys, oldest first / most recent last
        this.onMessage('setDirections', (client, directions) => {
            const internal = this.playerInternal.get(client.sessionId);
            if (internal) {
                internal.lastActivityTime = Date.now();
                internal.pendingDirections = sanitizeDirections(directions);
                internal.pendingDirectionChanged = true;
            }
        });

        this.onMessage('moveStart', (client, direction) => {
            const internal = this.playerInternal.get(client.sessionId);
            if (internal) {
                internal.lastActivityTime = Date.now();
                internal.pendingDirections = sanitizeDirections([direction]);
                internal.pendingDirectionChanged = true;
            }
        });

        this.onMessage('moveStop', (client) => {
            const internal = this.playerInternal.get(client.sessionId);
            if (internal) {
                internal.lastActivityTime = Date.now();
                internal.pendingDirections = [];
                internal.pendingDirectionChanged = true;
            }
        });

        this.onMessage('placeBomb', (client) => {
            const internal = this.playerInternal.get(client.sessionId);
            if (internal) {
                internal.lastActivityTime = Date.now();
                internal.pendingBomb = true;
            }
        });

        this.onMessage('update_player_name', (client, newName) => {
            const player = this.state.players.get(client.sessionId);
            if (player) {
                player.playerName = (newName || '').substring(0, 20);
                this.updateMetadata();
            }
        });

        // Host picks which game the room plays (lobby only)
        this.onMessage('setGameType', (client, gameType) => {
            if (this.state.phase !== 'lobby') return;
            if (client.sessionId !== this.state.hostId) return;
            if (gameType !== 'bomberman' && gameType !== 'snake') return;
            this.state.gameType = gameType;
            this.updateMetadata();
        });

        // Snake steering (ignored while playing bomberman)
        this.onMessage('direction', (client, direction) => {
            if (this.state.gameType !== 'snake' || this.state.phase !== 'playing') return;
            const internal = this.playerInternal.get(client.sessionId);
            if (!internal) return;
            internal.lastActivityTime = Date.now();

            if (!direction || ![-1, 0, 1].includes(direction.x) || ![-1, 0, 1].includes(direction.y)
                || Math.abs(direction.x) + Math.abs(direction.y) !== 1) return;

            const player = this.state.players.get(client.sessionId);
            if (!player || !player.alive || player.segments.length === 0) return;

            const current = internal.snakePendingDirection || internal.snakeDirection || { x: 1, y: 0 };

            // Prevent 180-degree turns if snake has more than one segment
            const isOpposite = current.x === -direction.x && current.y === -direction.y;
            if (!(player.segments.length > 1 && isOpposite)) {
                internal.snakePendingDirection = { x: direction.x, y: direction.y };
            }
        });

        this.onMessage('setReady', (client, ready) => {
            if (this.state.phase !== 'lobby') return;
            const player = this.state.players.get(client.sessionId);
            if (player) player.ready = !!ready;
            const internal = this.playerInternal.get(client.sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        });

        this.onMessage('startGame', (client) => {
            if (this.state.phase !== 'lobby') return;
            if (client.sessionId !== this.state.hostId) return;
            // Every player except the host must have confirmed ready
            for (const [id, p] of this.state.players) {
                if (id !== this.state.hostId && !p.ready) return;
            }
            this.startGame();
        });
    }

    onJoin(client, options) {
        console.log(`Bomberman player joined: ${client.sessionId}`);

        const persistentId = options.persistentId || '';
        const playerName = (options.playerName || '').substring(0, 20);

        // If this persistentId is already bound to an active session (e.g. the
        // same browser opened a second tab), take over that player: remove the
        // old session so only one player exists per persistentId.
        if (persistentId) {
            for (const [existingSessionId, pid] of this.sessionToPersistentId) {
                if (pid === persistentId && existingSessionId !== client.sessionId) {
                    const existingPlayer = this.state.players.get(existingSessionId);
                    if (existingPlayer) {
                        if (existingPlayer.alive) {
                            this.persistentPlayers.set(persistentId, this.serializePlayer(existingPlayer));
                        } else {
                            this.usedColors.delete(existingPlayer.color);
                        }
                    }
                    // Remove player before leave() so onLeave's reconnection
                    // path doesn't resurrect the old session.
                    this.state.players.delete(existingSessionId);
                    this.playerInternal.delete(existingSessionId);
                    this.sessionToPersistentId.delete(existingSessionId);
                    // CONSENTED close code, otherwise the kicked tab's SDK
                    // auto-reconnects and the two tabs kick each other forever.
                    const oldClient = this.clients.find(c => c.sessionId === existingSessionId);
                    if (oldClient) oldClient.leave(CloseCode.CONSENTED);
                    break;
                }
            }
        }

        // Check for reconnection (only meaningful while a bomberman game is
        // running; snake players just respawn fresh)
        const savedPlayer = this.persistentPlayers.get(persistentId);
        if (savedPlayer && savedPlayer.alive && this.state.phase === 'playing' && this.state.gameType === 'bomberman') {
            console.log(`Restoring player ${persistentId}`);
            this.sessionToPersistentId.set(client.sessionId, persistentId);

            // Cancel cleanup timeout
            if (this.cleanupTimeouts.has(persistentId)) {
                clearTimeout(this.cleanupTimeouts.get(persistentId));
                this.cleanupTimeouts.delete(persistentId);
            }

            const player = new Player();
            player.x = savedPlayer.x;
            player.y = savedPlayer.y;
            player.color = savedPlayer.color;
            player.playerName = playerName || savedPlayer.playerName || '';
            player.maxBombs = savedPlayer.maxBombs;
            player.activeBombs = savedPlayer.activeBombs;
            player.bombRange = savedPlayer.bombRange;
            player.speedBoosts = savedPlayer.speedBoosts;
            player.invisibleUntil = savedPlayer.invisibleUntil;
            player.protectedUntil = Date.now() + 2000;
            player.lives = savedPlayer.lives;
            player.alive = true;
            player.killedBy = '';
            player.lastMoveTime = Date.now();
            player.isMoving = false;
            player.invisible = false;
            player.ready = false;
            player.isSpectator = false;
            player.score = 0;
            player.segments = new ArraySchema();

            this.state.players.set(client.sessionId, player);
            this.playerInternal.set(client.sessionId, {
                currentDirections: [],
                pendingDirections: [],
                pendingDirectionChanged: false,
                lastStepDirection: null,
                pendingBomb: false,
                lastActivityTime: Date.now(),
                lastMoveTime: Date.now(),
            });

            client.send('playerColor', savedPlayer.color);
            this.broadcast('playNewSound');
        } else {
            // New player: waits in the lobby, or spectates if a game is running.
            // They get a position only when a game starts.
            const color = this.getAvailableColor();
            this.usedColors.add(color);

            const player = new Player();
            player.x = 0;
            player.y = 0;
            player.color = color;
            player.playerName = playerName;
            player.maxBombs = 1;
            player.activeBombs = 0;
            player.bombRange = CONFIG.baseExplosionRange;
            player.speedBoosts = 0;
            player.invisibleUntil = 0;
            player.protectedUntil = 0;
            player.lives = 0;
            player.alive = false;
            player.killedBy = '';
            player.lastMoveTime = Date.now();
            player.isMoving = false;
            player.invisible = false;
            player.ready = false;
            player.isSpectator = this.state.phase === 'playing';
            player.score = 0;
            player.segments = new ArraySchema();

            this.state.players.set(client.sessionId, player);
            this.sessionToPersistentId.set(client.sessionId, persistentId);

            this.playerInternal.set(client.sessionId, {
                currentDirections: [],
                pendingDirections: [],
                pendingDirectionChanged: false,
                lastStepDirection: null,
                pendingBomb: false,
                lastActivityTime: Date.now(),
                lastMoveTime: Date.now(),
            });

            // Save to persistent storage
            if (persistentId) {
                this.persistentPlayers.set(persistentId, this.serializePlayer(player));
            }

            client.send('playerColor', color);
            this.broadcast('playNewSound');
        }

        // First player in becomes host
        if (!this.state.hostId || !this.state.players.has(this.state.hostId)) {
            this.state.hostId = client.sessionId;
        }
        this.updateMetadata();
    }

    async onLeave(client, consented) {
        const sessionId = client.sessionId;
        const player = this.state.players.get(sessionId);
        if (!player) return;

        const persistentId = this.sessionToPersistentId.get(sessionId);

        if (persistentId && player.alive) {
            // Save state for reconnection
            this.persistentPlayers.set(persistentId, this.serializePlayer(player));

            // Try to allow reconnection for 30 seconds
            try {
                await this.allowReconnection(client, 30);
                // Player reconnected — update internal state
                console.log(`Player ${sessionId} reconnected`);
                const internal = this.playerInternal.get(sessionId);
                if (internal) internal.lastActivityTime = Date.now();
                return;
            } catch (e) {
                // Reconnection timed out
                console.log(`Player ${sessionId} reconnection timed out`);
            }

            // Set up cleanup timeout (5 min)
            const timeoutHandle = setTimeout(() => {
                const saved = this.persistentPlayers.get(persistentId);
                if (saved) {
                    this.usedColors.delete(saved.color);
                    this.persistentPlayers.delete(persistentId);
                }
                this.cleanupTimeouts.delete(persistentId);
            }, 5 * 60 * 1000);
            this.cleanupTimeouts.set(persistentId, timeoutHandle);
        } else if (player) {
            this.usedColors.delete(player.color);
        }

        this.state.players.delete(sessionId);
        this.playerInternal.delete(sessionId);
        this.sessionToPersistentId.delete(sessionId);

        // Reassign host if the host left
        if (this.state.hostId === sessionId) {
            let newHost = '';
            for (const [id] of this.state.players) { newHost = id; break; }
            this.state.hostId = newHost;
        }
        this.updateMetadata();
    }

    // ── Lobby / game lifecycle ────────────────────────────────────────

    updateMetadata() {
        const host = this.state.players.get(this.state.hostId);
        this.setMetadata({
            hostName: host ? (host.playerName || 'Anonymous') : '',
            phase: this.state.phase,
            playerCount: this.state.players.size,
            gameType: this.state.gameType,
        });
    }

    startGame() {
        if (this.state.gameType === 'snake') {
            this.startSnakeGame();
        } else {
            this.startBombermanGame();
        }
    }

    startSnakeGame() {
        console.log('Starting Snake game...');
        this.clearGameObjects();

        // Snake plays on an empty fixed-size grid — clear any bomberman walls
        this.state.indestructibleWalls.splice(0, this.state.indestructibleWalls.length);
        this.state.destructibleWalls.splice(0, this.state.destructibleWalls.length);
        this.wallHiddenBombs = [];
        this.wallLookup.clear();
        this.indestructibleLookup.clear();
        this.spawnPoints = [];

        this.state.gridWidth = SNAKE_CONFIG.width;
        this.state.gridHeight = SNAKE_CONFIG.height;
        this.participantsAtStart = this.state.players.size;

        for (const [sessionId, player] of this.state.players) {
            player.isSpectator = false;
            player.ready = false;
            player.alive = true;
            player.killedBy = '';
            player.protectedUntil = 0;
            player.isMoving = false;
            this.respawnSnake(sessionId, player);
            const internal = this.playerInternal.get(sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        }

        this.generateFood(5);
        this.state.phase = 'playing';
        this.updateMetadata();
    }

    startBombermanGame() {
        console.log('Starting Bomberman game...');
        this.clearGameObjects();

        // Grid size is fixed for the whole game, based on player count at start
        const playerCount = this.state.players.size;
        const { cols, rows } = this.calculateGridSize(playerCount);
        this.cols = cols;
        this.rows = rows;
        this.state.gridWidth = cols * CONFIG.scale;
        this.state.gridHeight = rows * CONFIG.scale;

        this.generateEnvironment();
        this.participantsAtStart = playerCount;

        for (const [sessionId, player] of this.state.players) {
            player.isSpectator = false;
            player.ready = false;
            const pos = this.getRandomEmptyPosition();
            this.resetPlayer(player, pos);
            const internal = this.playerInternal.get(sessionId);
            if (internal) {
                internal.currentDirections = [];
                internal.pendingDirections = [];
                internal.lastStepDirection = null;
                internal.pendingBomb = false;
                internal.lastMoveTime = Date.now();
                internal.lastActivityTime = Date.now();
            }
            const persistentId = this.sessionToPersistentId.get(sessionId);
            if (persistentId) {
                this.persistentPlayers.set(persistentId, this.serializePlayer(player));
            }
        }

        this.state.phase = 'playing';
        this.updateMetadata();
    }

    returnToLobby() {
        console.log('Returning everyone to the waiting room...');
        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
            this.restartTimeout = null;
        }

        this.clearGameObjects();
        this.state.indestructibleWalls.splice(0, this.state.indestructibleWalls.length);
        this.state.destructibleWalls.splice(0, this.state.destructibleWalls.length);
        this.wallHiddenBombs = [];
        this.wallLookup.clear();
        this.indestructibleLookup.clear();

        for (const [sessionId, player] of this.state.players) {
            player.ready = false;
            player.isSpectator = false;
            player.alive = false;
            player.killedBy = '';
            player.isMoving = false;
            player.score = 0;
            player.segments.splice(0, player.segments.length);
            const internal = this.playerInternal.get(sessionId);
            if (internal) {
                internal.currentDirections = [];
                internal.pendingDirections = [];
                internal.pendingBomb = false;
                internal.lastActivityTime = Date.now();
            }
        }

        // Invalidate mid-game reconnection snapshots: the game they belonged
        // to is over, so returning players join the lobby fresh.
        for (const [, saved] of this.persistentPlayers) {
            saved.alive = false;
        }

        this.state.phase = 'lobby';
        this.updateMetadata();
    }

    // ── Game loop ─────────────────────────────────────────────────────

    updateGameState() {
        // Nothing to simulate while waiting in the lobby
        if (this.state.phase !== 'playing') return;

        if (this.state.gameType === 'snake') {
            this.updateSnakeState();
        } else {
            this.updateBombermanState();
        }
    }

    // ── Snake game loop ───────────────────────────────────────────────

    updateSnakeState() {
        const now = Date.now();

        // Pause if there's a winner (waiting for return to lobby)
        if (this.state.winnerId) return;

        // Only spectators left — nothing to watch, back to the lobby
        let participantCount = 0;
        for (const [, p] of this.state.players) {
            if (!p.isSpectator) participantCount++;
        }
        if (participantCount === 0) {
            this.returnToLobby();
            return;
        }

        for (const [sessionId, player] of this.state.players) {
            if (!player.alive || player.isSpectator || player.segments.length === 0) continue;

            const internal = this.playerInternal.get(sessionId);
            if (!internal) continue;

            const moveInterval = SNAKE_CONFIG.baseMoveInterval * Math.pow(SNAKE_CONFIG.speedFactor, player.score);
            if (now - internal.snakeLastMoveTime < moveInterval) continue;
            internal.snakeLastMoveTime = now;

            // Apply pending direction
            if (internal.snakePendingDirection) {
                internal.snakeDirection = internal.snakePendingDirection;
                internal.snakePendingDirection = null;
            }

            const head = player.segments[0];
            let newX = head.x + internal.snakeDirection.x * SNAKE_CONFIG.scale;
            let newY = head.y + internal.snakeDirection.y * SNAKE_CONFIG.scale;

            // Wrap around
            if (newX >= SNAKE_CONFIG.width) newX = 0;
            if (newX < 0) newX = SNAKE_CONFIG.width - SNAKE_CONFIG.scale;
            if (newY >= SNAKE_CONFIG.height) newY = 0;
            if (newY < 0) newY = SNAKE_CONFIG.height - SNAKE_CONFIG.scale;

            // Check food collision
            let ateFood = false;
            for (let i = this.state.food.length - 1; i >= 0; i--) {
                const f = this.state.food[i];
                if (newX === f.x && newY === f.y) {
                    ateFood = true;
                    player.score++;

                    const client = this.clients.find(c => c.sessionId === sessionId);
                    if (client) client.send('playEatSound');

                    // Win condition
                    if (player.score >= SNAKE_CONFIG.winningScore) {
                        this.state.winnerId = sessionId;
                        console.log(`Snake player ${sessionId} wins!`);
                        this.broadcast('playWinSound');
                        this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
                    }

                    this.state.food.splice(i, 1);
                    if (!this.state.winnerId) {
                        this.generateFood(1);
                    }
                    break;
                }
            }

            // Move snake: remember tail, shift segments forward, update head
            const tailPos = {
                x: player.segments[player.segments.length - 1].x,
                y: player.segments[player.segments.length - 1].y,
            };
            for (let i = player.segments.length - 1; i > 0; i--) {
                player.segments[i].x = player.segments[i - 1].x;
                player.segments[i].y = player.segments[i - 1].y;
            }
            player.segments[0].x = newX;
            player.segments[0].y = newY;

            // Grow if ate food
            if (ateFood) {
                const newSeg = new Position();
                newSeg.x = tailPos.x;
                newSeg.y = tailPos.y;
                player.segments.push(newSeg);
            }

            // Check collisions with all snakes (including self)
            let collisionDetected = false;
            for (const [otherId, otherPlayer] of this.state.players) {
                if (otherPlayer.isSpectator) continue;
                const startIdx = otherId === sessionId ? 1 : 0;
                for (let i = startIdx; i < otherPlayer.segments.length; i++) {
                    if (player.segments[0].x === otherPlayer.segments[i].x &&
                        player.segments[0].y === otherPlayer.segments[i].y) {
                        collisionDetected = true;
                        break;
                    }
                }
                if (collisionDetected) break;
            }

            if (collisionDetected) {
                const client = this.clients.find(c => c.sessionId === sessionId);
                if (client) client.send('playDieSound');
                this.respawnSnake(sessionId, player);
            }
        }
    }

    respawnSnake(sessionId, player) {
        const pos = this.randomSnakePosition();
        player.segments.splice(0, player.segments.length);
        const seg = new Position();
        seg.x = pos.x;
        seg.y = pos.y;
        player.segments.push(seg);
        player.score = 0;

        const internal = this.playerInternal.get(sessionId);
        if (internal) {
            internal.snakeDirection = { x: 1, y: 0 };
            internal.snakePendingDirection = null;
            internal.snakeLastMoveTime = Date.now();
        }
    }

    generateFood(count) {
        const cols = Math.floor(SNAKE_CONFIG.width / SNAKE_CONFIG.scale);
        const rows = Math.floor(SNAKE_CONFIG.height / SNAKE_CONFIG.scale);

        const occupied = new Set();
        for (const [, player] of this.state.players) {
            for (let i = 0; i < player.segments.length; i++) {
                occupied.add(`${player.segments[i].x},${player.segments[i].y}`);
            }
        }
        for (let i = 0; i < this.state.food.length; i++) {
            occupied.add(`${this.state.food[i].x},${this.state.food[i].y}`);
        }

        for (let n = 0; n < count; n++) {
            let x, y, placed = false;

            for (let attempt = 0; attempt < 100; attempt++) {
                x = Math.floor(Math.random() * cols) * SNAKE_CONFIG.scale;
                y = Math.floor(Math.random() * rows) * SNAKE_CONFIG.scale;
                if (!occupied.has(`${x},${y}`)) {
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                for (let gx = 0; gx < cols && !placed; gx++) {
                    for (let gy = 0; gy < rows && !placed; gy++) {
                        x = gx * SNAKE_CONFIG.scale;
                        y = gy * SNAKE_CONFIG.scale;
                        if (!occupied.has(`${x},${y}`)) {
                            placed = true;
                        }
                    }
                }
            }

            if (placed) {
                occupied.add(`${x},${y}`);
                const f = new Position();
                f.x = x;
                f.y = y;
                this.state.food.push(f);
            }
        }
    }

    randomSnakePosition() {
        return {
            x: Math.floor(Math.random() * (SNAKE_CONFIG.width / SNAKE_CONFIG.scale)) * SNAKE_CONFIG.scale,
            y: Math.floor(Math.random() * (SNAKE_CONFIG.height / SNAKE_CONFIG.scale)) * SNAKE_CONFIG.scale,
        };
    }

    // ── Bomberman game loop ───────────────────────────────────────────

    updateBombermanState() {
        const now = Date.now();

        // Process pending direction changes from message handlers
        for (const [sessionId, internal] of this.playerInternal) {
            if (internal.pendingDirectionChanged) {
                const changed = JSON.stringify(internal.currentDirections) !== JSON.stringify(internal.pendingDirections);
                internal.currentDirections = internal.pendingDirections;
                // Step immediately on a real direction change, but not on
                // key auto-repeat resending the same held keys
                if (changed && internal.currentDirections.length > 0) {
                    internal.lastMoveTime = now - CONFIG.moveInterval;
                }
                internal.pendingDirectionChanged = false;
            }
        }

        // Pause game logic if there's a winner
        if (this.state.winnerId) return;

        // Track walls to destroy
        const wallsToDestroy = new Set();

        // ── Bomb explosions ──────────────────────────────────────────
        const bombsToExplode = new Set();
        const bombsQueue = [];

        // Check fuse timers
        for (let i = 0; i < this.state.bombs.length; i++) {
            const bomb = this.state.bombs[i];
            if (now - bomb.placedTime >= CONFIG.bombFuseTime) {
                if (!bombsToExplode.has(bomb)) {
                    bombsToExplode.add(bomb);
                    bombsQueue.push(bomb);
                }
            }
        }

        // Chain reactions
        let head = 0;
        while (head < bombsQueue.length) {
            const bomb = bombsQueue[head];
            head++;

            const player = this.state.players.get(bomb.playerId);
            const range = player ? player.bombRange : 1;
            const hitBombs = this.createExplosion(bomb.x, bomb.y, wallsToDestroy, range, bomb.playerId, now);

            for (const hitBomb of hitBombs) {
                if (!bombsToExplode.has(hitBomb)) {
                    bombsToExplode.add(hitBomb);
                    bombsQueue.push(hitBomb);
                }
            }

            // Decrement active bombs
            if (player && player.activeBombs > 0) {
                player.activeBombs--;
            }
        }

        // Remove exploded bombs
        if (bombsToExplode.size > 0) {
            for (const bomb of bombsToExplode) {
                this.bombLookup.delete(`${bomb.x},${bomb.y}`);
            }
            // Filter in-place by rebuilding
            const remaining = [];
            for (let i = 0; i < this.state.bombs.length; i++) {
                if (!bombsToExplode.has(this.state.bombs[i])) {
                    remaining.push(this.state.bombs[i]);
                }
            }
            this.state.bombs.splice(0, this.state.bombs.length, ...remaining);
            this.broadcast('playExplosionSound');
        }

        // ── Wall destruction ─────────────────────────────────────────
        if (wallsToDestroy.size > 0) {
            const remaining = [];
            for (let i = 0; i < this.state.destructibleWalls.length; i++) {
                const wall = this.state.destructibleWalls[i];
                const key = `${wall.x},${wall.y}`;
                if (wallsToDestroy.has(key)) {
                    this.wallLookup.delete(key);

                    // Spawn pickups/powerups/lava
                    const hasHidden = this.wallHiddenBombs[i];
                    if (hasHidden) {
                        const pickup = new Pickup();
                        pickup.x = wall.x;
                        pickup.y = wall.y;
                        pickup.pickupType = 'bomb';
                        this.state.bombPickups.push(pickup);
                    } else {
                        this.spawnWallDrop(wall.x, wall.y);
                    }
                } else {
                    remaining.push({ wall, hiddenBomb: this.wallHiddenBombs[i] });
                }
            }
            // Rebuild walls and hidden bomb flags
            this.state.destructibleWalls.splice(0, this.state.destructibleWalls.length);
            this.wallHiddenBombs = [];
            for (const item of remaining) {
                this.state.destructibleWalls.push(item.wall);
                this.wallHiddenBombs.push(item.hiddenBomb);
            }
        }

        // ── Remove expired explosions ────────────────────────────────
        {
            const remaining = [];
            for (let i = 0; i < this.state.explosions.length; i++) {
                const e = this.state.explosions[i];
                if (now - e.createdTime < CONFIG.explosionDuration) {
                    remaining.push(e);
                }
            }
            if (remaining.length !== this.state.explosions.length) {
                this.state.explosions.splice(0, this.state.explosions.length, ...remaining);
            }
        }

        // ── Process bomb placements ──────────────────────────────────
        for (const [sessionId, internal] of this.playerInternal) {
            if (internal.pendingBomb) {
                internal.pendingBomb = false;
                const player = this.state.players.get(sessionId);
                if (player && player.alive && player.activeBombs < player.maxBombs) {
                    const key = `${player.x},${player.y}`;
                    if (!this.bombLookup.has(key)) {
                        const bomb = new Bomb();
                        bomb.x = player.x;
                        bomb.y = player.y;
                        bomb.placedTime = now;
                        bomb.playerId = sessionId;
                        bomb.fuseTime = CONFIG.bombFuseTime;
                        this.state.bombs.push(bomb);
                        this.bombLookup.set(key, bomb);
                        player.activeBombs++;
                    }
                }
            }
        }

        // ── Move players ─────────────────────────────────────────────
        for (const [sessionId, player] of this.state.players) {
            if (!player.alive) continue;

            const internal = this.playerInternal.get(sessionId);
            if (!internal) continue;

            const speedMultiplier = Math.pow(0.9, player.speedBoosts);
            const playerMoveInterval = CONFIG.moveInterval * speedMultiplier;

            if (internal.currentDirections.length > 0 && now - internal.lastMoveTime >= playerMoveInterval) {
                internal.lastMoveTime = now;
                player.lastMoveTime = now;

                // Candidate order: most recent key first; with multiple keys
                // held, put the direction used last step at the back so free
                // directions alternate (staircase) and blocked ones fall back
                // to the other held key
                let candidates = internal.currentDirections.slice().reverse();
                if (candidates.length > 1 && internal.lastStepDirection) {
                    const last = candidates.find(d => d.x === internal.lastStepDirection.x && d.y === internal.lastStepDirection.y);
                    if (last) {
                        candidates = candidates.filter(d => d !== last);
                        candidates.push(last);
                    }
                }

                let newX = null;
                let newY = null;
                for (const dir of candidates) {
                    const tryX = player.x + dir.x * CONFIG.scale;
                    const tryY = player.y + dir.y * CONFIG.scale;

                    if (tryX < 0 || tryX >= this.state.gridWidth || tryY < 0 || tryY >= this.state.gridHeight) continue;

                    const targetKey = `${tryX},${tryY}`;
                    if (this.wallLookup.has(targetKey)) continue;

                    const bombAtTarget = this.bombLookup.get(targetKey);
                    if (bombAtTarget && (player.x !== bombAtTarget.x || player.y !== bombAtTarget.y)) continue;

                    newX = tryX;
                    newY = tryY;
                    internal.lastStepDirection = dir;
                    break;
                }

                if (newX !== null) {
                    player.x = newX;
                    player.y = newY;

                    // Bomb pickup collection
                    for (let i = this.state.bombPickups.length - 1; i >= 0; i--) {
                        const p = this.state.bombPickups[i];
                        if (p.x === newX && p.y === newY) {
                            player.maxBombs++;
                            this.state.bombPickups.splice(i, 1);
                            const client = this.clients.find(c => c.sessionId === sessionId);
                            if (client) client.send('playLevelUpSound');
                            break;
                        }
                    }

                    // Powerup collection
                    for (let i = this.state.powerups.length - 1; i >= 0; i--) {
                        const p = this.state.powerups[i];
                        if (p.x === newX && p.y === newY) {
                            if (p.pickupType === 'flame') {
                                player.bombRange++;
                            } else if (p.pickupType === 'speed') {
                                if (player.speedBoosts < CONFIG.maxSpeedBoosts) player.speedBoosts++;
                            } else if (p.pickupType === 'invisibility') {
                                player.invisibleUntil = now + CONFIG.invisibilityDuration;
                            } else if (p.pickupType === 'life') {
                                player.lives++;
                            }
                            this.state.powerups.splice(i, 1);
                            const client = this.clients.find(c => c.sessionId === sessionId);
                            if (client) client.send('playLevelUpSound');
                            break;
                        }
                    }
                }
            }

            // Update synced movement state
            player.isMoving = internal.currentDirections.length > 0;

            // Update invisibility flag
            player.invisible = !!(player.invisibleUntil && player.invisibleUntil > now);
        }

        // ── Explosion death checks ───────────────────────────────────
        for (let i = 0; i < this.state.explosions.length; i++) {
            const explosion = this.state.explosions[i];
            for (const [sessionId, player] of this.state.players) {
                if (player.alive && player.x === explosion.x && player.y === explosion.y) {
                    if (!player.protectedUntil || now > player.protectedUntil) {
                        if (player.lives > 0) {
                            player.lives--;
                            player.protectedUntil = now + 2000;
                        } else {
                            player.alive = false;
                            player.killedBy = explosion.playerId === sessionId ? 'self' : explosion.playerId;
                        }
                    }
                }
            }
        }

        // ── Lava death checks (instant kill) ─────────────────────────
        for (let i = 0; i < this.state.lavaTiles.length; i++) {
            const lava = this.state.lavaTiles[i];
            for (const [sessionId, player] of this.state.players) {
                if (player.alive && player.x === lava.x && player.y === lava.y) {
                    if (!player.protectedUntil || now > player.protectedUntil) {
                        player.alive = false;
                        player.killedBy = 'lava';
                    }
                }
            }
        }

        // ── Win condition (spectators don't count) ───────────────────
        if (!this.state.winnerId) {
            let participantCount = 0;
            let aliveCount = 0;
            let lastAliveId = '';
            for (const [id, p] of this.state.players) {
                if (p.isSpectator) continue;
                participantCount++;
                if (p.alive) { aliveCount++; lastAliveId = id; }
            }

            if (participantCount === 0) {
                // Only spectators left — nothing to watch, back to the lobby
                this.returnToLobby();
            } else if (aliveCount === 1 && this.participantsAtStart > 1) {
                this.state.winnerId = lastAliveId;
                console.log(`Player ${lastAliveId} wins!`);
                this.broadcast('playWinSound');
                this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
            } else if (aliveCount === 0) {
                console.log('All players eliminated - Draw!');
                this.state.winnerId = 'draw';
                this.restartTimeout = setTimeout(() => this.returnToLobby(), 3000);
            }
        }

        // Sync to persistent storage
        for (const [sessionId, player] of this.state.players) {
            const persistentId = this.sessionToPersistentId.get(sessionId);
            if (persistentId) {
                this.persistentPlayers.set(persistentId, this.serializePlayer(player));
            }
        }
    }

    // ── Explosion logic ──────────────────────────────────────────────

    createExplosion(centerX, centerY, wallsToDestroy, bombRange, playerId, now) {
        const explosionTiles = [];
        const scale = CONFIG.scale;
        const bombsToChainExplode = [];

        explosionTiles.push({ x: centerX, y: centerY });

        const centerKey = `${centerX},${centerY}`;
        if (this.wallLookup.has(centerKey) && !this.indestructibleLookup.has(centerKey)) {
            wallsToDestroy.add(centerKey);
        }

        const directions = [
            { x: 1, y: 0 }, { x: -1, y: 0 },
            { x: 0, y: 1 }, { x: 0, y: -1 }
        ];

        for (const dir of directions) {
            for (let i = 1; i <= bombRange; i++) {
                const x = centerX + dir.x * scale * i;
                const y = centerY + dir.y * scale * i;

                if (x < 0 || x >= this.state.gridWidth || y < 0 || y >= this.state.gridHeight) break;

                const key = `${x},${y}`;

                if (this.lavaLookup.has(key)) break;

                if (this.wallLookup.has(key)) {
                    if (this.indestructibleLookup.has(key)) break;
                    explosionTiles.push({ x, y });
                    wallsToDestroy.add(key);
                    break;
                }

                explosionTiles.push({ x, y });
            }
        }

        for (const tile of explosionTiles) {
            const explosion = new Explosion();
            explosion.x = tile.x;
            explosion.y = tile.y;
            explosion.createdTime = now;
            explosion.playerId = playerId;
            this.state.explosions.push(explosion);

            const bombAtTile = this.bombLookup.get(`${tile.x},${tile.y}`);
            if (bombAtTile) {
                bombsToChainExplode.push(bombAtTile);
            }
        }

        return bombsToChainExplode;
    }

    // ── Environment generation ────────────────────────────────────────

    calculateGridSize(playerCount) {
        const baseCols = 32;
        const baseRows = 27;
        let scaleFactor;
        if (playerCount <= 4) scaleFactor = 0.5;
        else if (playerCount <= 12) scaleFactor = 0.75;
        else scaleFactor = 1.0;
        return {
            cols: Math.floor(baseCols * scaleFactor),
            rows: Math.floor(baseRows * scaleFactor)
        };
    }

    generateEnvironment() {
        this.state.indestructibleWalls.splice(0, this.state.indestructibleWalls.length);
        this.state.destructibleWalls.splice(0, this.state.destructibleWalls.length);
        this.wallHiddenBombs = [];

        const cols = this.cols || Math.floor(this.state.gridWidth / CONFIG.scale);
        const rows = this.rows || Math.floor(this.state.gridHeight / CONFIG.scale);
        const scale = CONFIG.scale;

        // Spawn zones
        const spawnZones = [
            { x: 0, y: 0, pattern: 'top-left' },
            { x: cols - 1, y: 0, pattern: 'top-right' },
            { x: 0, y: rows - 1, pattern: 'bottom-left' },
            { x: cols - 1, y: rows - 1, pattern: 'bottom-right' },
            { x: Math.floor(cols / 2), y: 0, pattern: 'top-left' },
            { x: Math.floor(cols / 2), y: rows - 1, pattern: 'bottom-left' },
            { x: 0, y: Math.floor(rows / 2), pattern: 'top-left' },
            { x: cols - 1, y: Math.floor(rows / 2), pattern: 'top-right' }
        ];

        const isInSafeZone = (col, row) => {
            return spawnZones.some(zone => {
                const dx = col - zone.x;
                const dy = row - zone.y;
                switch (zone.pattern) {
                    case 'top-left':
                        return (dx >= 0 && dx <= 3 && dy === 0) || (dx === 0 && dy >= 0 && dy <= 3);
                    case 'top-right':
                        return (dx >= -3 && dx <= 0 && dy === 0) || (dx === 0 && dy >= 0 && dy <= 3);
                    case 'bottom-left':
                        return (dx >= 0 && dx <= 3 && dy === 0) || (dx === 0 && dy >= -3 && dy <= 0);
                    case 'bottom-right':
                        return (dx >= -3 && dx <= 0 && dy === 0) || (dx === 0 && dy >= -3 && dy <= 0);
                    default: return false;
                }
            });
        };

        this.spawnPoints = spawnZones.map(zone => ({ x: zone.x * scale, y: zone.y * scale }));

        // Indestructible walls + lava replacements
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (isInSafeZone(col, row)) continue;
                if (row % 2 === 0 && col % 2 === 0 && row > 0 && row < rows - 1 && col > 0 && col < cols - 1) {
                    if (Math.random() < CONFIG.lavaWallReplacementRate) {
                        const lava = new Wall();
                        lava.x = col * scale;
                        lava.y = row * scale;
                        this.state.lavaTiles.push(lava);
                    } else {
                        const wall = new Wall();
                        wall.x = col * scale;
                        wall.y = row * scale;
                        this.state.indestructibleWalls.push(wall);
                    }
                }
            }
        }

        // Edge pocket walls
        // Set of positions that must not receive pocket/destructible walls:
        // indestructible walls plus lava tiles (so walls aren't placed on top of
        // lava, which would make the lava unreachable and un-lethal).
        const indestructibleSet = new Set();
        for (let i = 0; i < this.state.indestructibleWalls.length; i++) {
            const w = this.state.indestructibleWalls[i];
            indestructibleSet.add(`${w.x},${w.y}`);
        }
        for (let i = 0; i < this.state.lavaTiles.length; i++) {
            const l = this.state.lavaTiles[i];
            indestructibleSet.add(`${l.x},${l.y}`);
        }

        const pocketWallDistance = 4;
        const addPocketWall = (col, row) => {
            if (isInSafeZone(col, row)) return;
            const key = `${col * scale},${row * scale}`;
            if (indestructibleSet.has(key)) return;
            const wall = new Wall();
            wall.x = col * scale;
            wall.y = row * scale;
            this.state.destructibleWalls.push(wall);
            this.wallHiddenBombs.push(false);
        };

        // Track pocket wall positions
        const pocketPositions = new Set();
        const addPocketWithTracking = (col, row) => {
            if (isInSafeZone(col, row)) return;
            const key = `${col * scale},${row * scale}`;
            if (indestructibleSet.has(key)) return;
            if (pocketPositions.has(key)) return;
            pocketPositions.add(key);
            addPocketWall(col, row);
        };

        for (let col = pocketWallDistance; col < cols - pocketWallDistance; col += 2) {
            if (col < Math.floor(cols / 2) - 2 || col > Math.floor(cols / 2) + 2) {
                addPocketWithTracking(col, 2);
                addPocketWithTracking(col, rows - 3);
            }
        }
        for (let row = pocketWallDistance; row < rows - pocketWallDistance; row += 2) {
            if (row < Math.floor(rows / 2) - 2 || row > Math.floor(rows / 2) + 2) {
                addPocketWithTracking(2, row);
                addPocketWithTracking(cols - 3, row);
            }
        }

        // Destructible walls
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (isInSafeZone(col, row)) continue;
                const key = `${col * scale},${row * scale}`;
                if (indestructibleSet.has(key)) continue;
                if (pocketPositions.has(key)) continue;

                let density = CONFIG.destructibleWallDensity;
                const isEdge = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;
                if (isEdge) density = 0.7;

                if (Math.random() < density) {
                    const wall = new Wall();
                    wall.x = col * scale;
                    wall.y = row * scale;
                    this.state.destructibleWalls.push(wall);
                    this.wallHiddenBombs.push(Math.random() < CONFIG.hiddenBombChance);
                }
            }
        }

        this.rebuildWallLookup();
        console.log(`Generated ${this.state.indestructibleWalls.length} indestructible, ${this.state.destructibleWalls.length} destructible walls`);
    }

    rebuildWallLookup() {
        this.wallLookup.clear();
        this.indestructibleLookup.clear();
        for (let i = 0; i < this.state.indestructibleWalls.length; i++) {
            const w = this.state.indestructibleWalls[i];
            const key = `${w.x},${w.y}`;
            this.wallLookup.add(key);
            this.indestructibleLookup.add(key);
        }
        for (let i = 0; i < this.state.destructibleWalls.length; i++) {
            const w = this.state.destructibleWalls[i];
            this.wallLookup.add(`${w.x},${w.y}`);
        }
        this.lavaLookup.clear();
        for (let i = 0; i < this.state.lavaTiles.length; i++) {
            const l = this.state.lavaTiles[i];
            this.lavaLookup.add(`${l.x},${l.y}`);
        }
        this.bombLookup.clear();
        for (let i = 0; i < this.state.bombs.length; i++) {
            const b = this.state.bombs[i];
            this.bombLookup.set(`${b.x},${b.y}`, b);
        }
    }

    spawnWallDrop(x, y) {
        const roll = Math.random();
        const rates = CONFIG;
        if (roll < rates.lavaTileSpawnRate) {
            const lava = new Wall();
            lava.x = x; lava.y = y;
            this.state.lavaTiles.push(lava);
            this.lavaLookup.add(`${x},${y}`);
        } else if (roll < rates.lavaTileSpawnRate + rates.invisibilityPowerupChance) {
            const p = new Pickup(); p.x = x; p.y = y; p.pickupType = 'invisibility';
            this.state.powerups.push(p);
        } else if (roll < rates.lavaTileSpawnRate + rates.invisibilityPowerupChance + rates.flamePowerupChance) {
            const p = new Pickup(); p.x = x; p.y = y; p.pickupType = 'flame';
            this.state.powerups.push(p);
        } else if (roll < rates.lavaTileSpawnRate + rates.invisibilityPowerupChance + rates.flamePowerupChance + rates.speedPowerupChance) {
            const p = new Pickup(); p.x = x; p.y = y; p.pickupType = 'speed';
            this.state.powerups.push(p);
        } else if (roll < rates.lavaTileSpawnRate + rates.invisibilityPowerupChance + rates.flamePowerupChance + rates.speedPowerupChance + rates.lifePowerupChance) {
            const p = new Pickup(); p.x = x; p.y = y; p.pickupType = 'life';
            this.state.powerups.push(p);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    getAvailableColor() {
        for (const color of COLORS) {
            if (!this.usedColors.has(color)) return color;
        }
        return COLORS[0];
    }

    getRandomEmptyPosition() {
        if (this.spawnPoints && this.spawnPoints.length > 0) {
            const spawnCounts = this.spawnPoints.map(sp => {
                let count = 0;
                for (const [, p] of this.state.players) {
                    if (p.x === sp.x && p.y === sp.y) count++;
                }
                return count;
            });
            const minCount = Math.min(...spawnCounts);
            const available = this.spawnPoints.filter((_, i) => spawnCounts[i] === minCount);
            return available[Math.floor(Math.random() * available.length)];
        }

        const cols = Math.floor(this.state.gridWidth / CONFIG.scale);
        const rows = Math.floor(this.state.gridHeight / CONFIG.scale);
        for (let attempt = 0; attempt < 100; attempt++) {
            const x = Math.floor(Math.random() * cols) * CONFIG.scale;
            const y = Math.floor(Math.random() * rows) * CONFIG.scale;
            const key = `${x},${y}`;
            if (!this.wallLookup.has(key) && !this.bombLookup.has(key) && !this.lavaLookup.has(key)) {
                return { x, y };
            }
        }
        return { x: 0, y: 0 };
    }

    resetPlayer(player, pos) {
        player.x = pos.x;
        player.y = pos.y;
        player.maxBombs = 1;
        player.activeBombs = 0;
        player.bombRange = CONFIG.baseExplosionRange;
        player.speedBoosts = 0;
        player.invisibleUntil = 0;
        player.protectedUntil = Date.now() + 2000;
        player.lives = 0;
        player.alive = true;
        player.killedBy = '';
        player.lastMoveTime = Date.now();
        player.isMoving = false;
        player.invisible = false;
    }

    clearGameObjects() {
        this.state.bombs.splice(0, this.state.bombs.length);
        this.state.explosions.splice(0, this.state.explosions.length);
        this.state.bombPickups.splice(0, this.state.bombPickups.length);
        this.state.powerups.splice(0, this.state.powerups.length);
        this.state.lavaTiles.splice(0, this.state.lavaTiles.length);
        this.state.food.splice(0, this.state.food.length);
        this.state.winnerId = '';
        this.bombLookup.clear();
        this.lavaLookup.clear();
    }

    serializePlayer(player) {
        return {
            x: player.x, y: player.y,
            color: player.color,
            playerName: player.playerName,
            maxBombs: player.maxBombs,
            activeBombs: player.activeBombs,
            bombRange: player.bombRange,
            speedBoosts: player.speedBoosts,
            invisibleUntil: player.invisibleUntil,
            lives: player.lives,
            alive: player.alive,
        };
    }

    checkInactivity() {
        // Only kick idle players who are actively in a game; people waiting
        // in the lobby or spectating aren't expected to send input.
        if (this.state.phase !== 'playing') return;
        const now = Date.now();
        for (const [sessionId, internal] of this.playerInternal) {
            const player = this.state.players.get(sessionId);
            if (!player || !player.alive || player.isSpectator) continue;
            if (now - internal.lastActivityTime > CONFIG.inactivityTimeout) {
                console.log(`Bomberman player ${sessionId} timed out`);
                const client = this.clients.find(c => c.sessionId === sessionId);
                if (client) client.leave();
            }
        }
    }

    onDispose() {
        console.log('GameRoom disposed');
        if (this.restartTimeout) clearTimeout(this.restartTimeout);
        for (const [, handle] of this.cleanupTimeouts) clearTimeout(handle);
    }
}

module.exports = { GameRoom, GameState };
