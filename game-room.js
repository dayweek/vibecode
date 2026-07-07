const { Room, CloseCode } = require('colyseus');
const { ArraySchema, MapSchema } = require('@colyseus/schema');
const { Player, GameState } = require('./schema');
const { BOMBERMAN_CONFIG, bombermanMethods } = require('./bomberman-room');
const { snakeMethods } = require('./snake-room');
const { HANGMAN_CONFIG, hangmanMethods } = require('./hangman-room');

// ── Room-level constants ─────────────────────────────────────────────

const COLORS = [
    '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
    '#FFA500', '#800080', '#FFFFFF', '#008000', '#ADD8E6', '#FFC0CB',
    '#A52A2A', '#808080', '#FFD700', '#40E0D0', '#FA8072', '#90EE90',
    '#E6E6FA', '#D2B48C'
];

const ROOM_CONFIG = {
    updateInterval: 100,
    maxPlayers: 20,
    inactivityTimeout: 60000,
};

// ── Room ─────────────────────────────────────────────────────────────
// One room type plays all three games. The lobby lifecycle, join/leave and
// reconnection logic live here; the per-game logic is mixed into the
// prototype from bomberman-room.js, snake-room.js and hangman-room.js.

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
        this.state.hangmanRevealed = '';
        this.state.hangmanGuessed = '';
        this.state.hangmanTurn = '';
        this.state.hangmanTheme = 'classic';
        this.state.hangmanRound = 0;
        this.state.hangmanTotalRounds = HANGMAN_CONFIG.defaultRounds;
        this.state.hangmanScoreA = 0;
        this.state.hangmanScoreB = 0;
        this.state.hangmanWrongA = 0;
        this.state.hangmanWrongB = 0;

        this.maxClients = ROOM_CONFIG.maxPlayers;

        // Internal state not synced to clients
        this.usedColors = new Set();
        this.wallLookup = new Set();
        this.indestructibleLookup = new Set();
        this.bombLookup = new Map();
        this.lavaLookup = new Set();
        this.spawnPoints = [];
        this.restartTimeout = null;

        // Hangman internals (the word itself is never synced to clients)
        this.hangmanWord = '';
        this.hangmanWords = [];
        this.hangmanRoundOver = false;
        this.hangmanRoundTimeout = null;

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
        this.setSimulationInterval(() => this.updateGameState(), ROOM_CONFIG.updateInterval);

        // Inactivity check
        this.clock.setInterval(() => this.checkInactivity(), 5000);

        // ── Message handlers ──────────────────────────────────────────

        this.registerBombermanMessages();
        this.registerSnakeMessages();
        this.registerHangmanMessages();

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
            if (!['bomberman', 'snake', 'hangman'].includes(gameType)) return;
            this.state.gameType = gameType;
            this.updateMetadata();
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
            // Hangman needs two non-empty teams with everyone assigned
            if (this.state.gameType === 'hangman' && !this.hangmanTeamsValid()) return;
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
            player.team = savedPlayer.team || '';
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
            player.bombRange = BOMBERMAN_CONFIG.baseExplosionRange;
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
            player.team = '';
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
        } else if (this.state.gameType === 'hangman') {
            this.startHangmanGame();
        } else {
            this.startBombermanGame();
        }
    }

    returnToLobby() {
        console.log('Returning everyone to the waiting room...');
        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
            this.restartTimeout = null;
        }
        if (this.hangmanRoundTimeout) {
            clearTimeout(this.hangmanRoundTimeout);
            this.hangmanRoundTimeout = null;
        }

        // Reset hangman round state (team assignments survive for a rematch)
        this.hangmanWord = '';
        this.hangmanWords = [];
        this.hangmanRoundOver = false;
        this.state.hangmanRevealed = '';
        this.state.hangmanGuessed = '';
        this.state.hangmanTurn = '';
        this.state.hangmanRound = 0;
        this.state.hangmanScoreA = 0;
        this.state.hangmanScoreB = 0;
        this.state.hangmanWrongA = 0;
        this.state.hangmanWrongB = 0;

        this.clearGameObjects();
        this.clearBoard();

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
        } else if (this.state.gameType === 'hangman') {
            this.updateHangmanState();
        } else {
            this.updateBombermanState();
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    getAvailableColor() {
        for (const color of COLORS) {
            if (!this.usedColors.has(color)) return color;
        }
        return COLORS[0];
    }

    // Clear transient game objects (bombs, explosions, pickups, food, winner)
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

    // Clear the bomberman board (walls + lookups); snake and hangman play on
    // an empty board, and the lobby holds no board at all
    clearBoard() {
        this.state.indestructibleWalls.splice(0, this.state.indestructibleWalls.length);
        this.state.destructibleWalls.splice(0, this.state.destructibleWalls.length);
        this.wallHiddenBombs = [];
        this.wallLookup.clear();
        this.indestructibleLookup.clear();
        this.spawnPoints = [];
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
            team: player.team,
        };
    }

    checkInactivity() {
        // Only kick idle players who are actively in a game; people waiting
        // in the lobby or spectating aren't expected to send input.
        if (this.state.phase !== 'playing') return;
        // Hangman is turn-based: the waiting team idles legitimately
        if (this.state.gameType === 'hangman') return;
        const now = Date.now();
        for (const [sessionId, internal] of this.playerInternal) {
            const player = this.state.players.get(sessionId);
            if (!player || !player.alive || player.isSpectator) continue;
            if (now - internal.lastActivityTime > ROOM_CONFIG.inactivityTimeout) {
                console.log(`Bomberman player ${sessionId} timed out`);
                const client = this.clients.find(c => c.sessionId === sessionId);
                if (client) client.leave();
            }
        }
    }

    onDispose() {
        console.log('GameRoom disposed');
        if (this.restartTimeout) clearTimeout(this.restartTimeout);
        if (this.hangmanRoundTimeout) clearTimeout(this.hangmanRoundTimeout);
        for (const [, handle] of this.cleanupTimeouts) clearTimeout(handle);
    }
}

// Mix the per-game logic into the room
Object.assign(GameRoom.prototype, bombermanMethods, snakeMethods, hangmanMethods);

module.exports = { GameRoom, GameState };
