const { Room } = require('colyseus');
const { Schema, type, ArraySchema, MapSchema } = require('@colyseus/schema');

// ── Schema definitions ──────────────────────────────────────────────

class Position extends Schema {}
type('number')(Position.prototype, 'x');
type('number')(Position.prototype, 'y');

class Food extends Schema {}
type('number')(Food.prototype, 'x');
type('number')(Food.prototype, 'y');

class Player extends Schema {}
type('string')(Player.prototype, 'color');
type('number')(Player.prototype, 'score');
type([Position])(Player.prototype, 'segments');

class SnakeState extends Schema {}
type({ map: Player })(SnakeState.prototype, 'players');
type([Food])(SnakeState.prototype, 'food');
type('string')(SnakeState.prototype, 'winnerId');

// ── Constants ────────────────────────────────────────────────────────

const COLORS = [
    '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
    '#FFA500', '#800080', '#FFFFFF', '#008000', '#ADD8E6', '#FFC0CB',
    '#A52A2A', '#808080', '#FFD700', '#40E0D0', '#FA8072', '#90EE90',
    '#E6E6FA', '#D2B48C'
];

const CONFIG = {
    width: 800,
    height: 800,
    scale: 20,
    updateInterval: 50,
    baseMoveInterval: 200,
    speedFactor: 0.95,
    winningScore: 20,
    inactivityTimeout: 20000,
};

// ── Room ─────────────────────────────────────────────────────────────

class SnakeRoom extends Room {

    onCreate(options) {
        this.setState(new SnakeState());
        this.state.players = new MapSchema();
        this.state.food = new ArraySchema();
        this.state.winnerId = '';

        this.maxClients = 20;

        // Internal per-player state
        this.playerInternal = new Map();
        this.usedColors = new Set();

        // Generate initial food
        this.generateFood(5);

        // Game loop
        this.setSimulationInterval(() => this.updateGameState(), CONFIG.updateInterval);

        // Inactivity check
        this.clock.setInterval(() => this.checkInactivity(), 1000);

        // ── Message handlers ──────────────────────────────────────────

        this.onMessage('direction', (client, direction) => {
            const internal = this.playerInternal.get(client.sessionId);
            if (!internal) return;

            internal.lastActivityTime = Date.now();

            const player = this.state.players.get(client.sessionId);
            if (!player || player.segments.length === 0) return;

            const currentDirection = internal.pendingDirection || internal.direction;

            // Prevent 180-degree turns if snake has more than one segment
            const isOpposite = currentDirection.x === -direction.x && currentDirection.y === -direction.y;
            if (!(player.segments.length > 1 && isOpposite)) {
                internal.pendingDirection = { x: direction.x, y: direction.y };
            }
        });

        this.onMessage('resetGame', (client) => {
            const resetInitiatorId = client.sessionId;
            const playerToKeep = this.state.players.get(resetInitiatorId);
            if (!playerToKeep) return;

            // Disconnect all other players
            for (const [id, player] of this.state.players) {
                if (id !== resetInitiatorId) {
                    const otherClient = this.clients.find(c => c.sessionId === id);
                    if (otherClient) {
                        this.usedColors.delete(player.color);
                        otherClient.leave();
                    }
                }
            }

            // Reset the initiator
            const pos = this.randomPosition();
            playerToKeep.segments.splice(0, playerToKeep.segments.length);
            const seg = new Position();
            seg.x = pos.x;
            seg.y = pos.y;
            playerToKeep.segments.push(seg);
            playerToKeep.score = 0;

            const internal = this.playerInternal.get(resetInitiatorId);
            if (internal) {
                internal.direction = { x: 1, y: 0 };
                internal.pendingDirection = null;
                internal.lastMoveTime = Date.now();
            }
        });

        this.onMessage('requestRestart', (client) => {
            if (!this.state.winnerId) return;

            this.state.winnerId = '';
            this.state.food.splice(0, this.state.food.length);
            this.generateFood(5);

            for (const [sessionId, player] of this.state.players) {
                const pos = this.randomPosition();
                player.segments.splice(0, player.segments.length);
                const seg = new Position();
                seg.x = pos.x;
                seg.y = pos.y;
                player.segments.push(seg);
                player.score = 0;

                const internal = this.playerInternal.get(sessionId);
                if (internal) {
                    internal.direction = { x: 1, y: 0 };
                    internal.pendingDirection = null;
                    internal.lastMoveTime = Date.now();
                    internal.lastActivityTime = Date.now();
                }
            }
        });
    }

    onJoin(client, options) {
        console.log(`Snake player joined: ${client.sessionId}`);

        const color = this.getAvailableColor();
        this.usedColors.add(color);

        const pos = this.randomPosition();
        const player = new Player();
        player.color = color;
        player.score = 0;
        player.segments = new ArraySchema();
        const seg = new Position();
        seg.x = pos.x;
        seg.y = pos.y;
        player.segments.push(seg);

        this.state.players.set(client.sessionId, player);

        this.playerInternal.set(client.sessionId, {
            direction: { x: 1, y: 0 },
            pendingDirection: null,
            lastMoveTime: Date.now(),
            lastActivityTime: Date.now(),
        });

        this.broadcast('playNewSound');
    }

    onLeave(client, consented) {
        const player = this.state.players.get(client.sessionId);
        if (player) {
            this.usedColors.delete(player.color);
        }
        this.state.players.delete(client.sessionId);
        this.playerInternal.delete(client.sessionId);
    }

    // ── Game loop ─────────────────────────────────────────────────────

    updateGameState() {
        const now = Date.now();

        // Pause if there's a winner
        if (this.state.winnerId) return;

        for (const [sessionId, player] of this.state.players) {
            const internal = this.playerInternal.get(sessionId);
            if (!internal) continue;

            const moveInterval = CONFIG.baseMoveInterval * Math.pow(CONFIG.speedFactor, player.score);

            if (now - internal.lastMoveTime >= moveInterval) {
                internal.lastMoveTime = now;

                // Apply pending direction
                if (internal.pendingDirection) {
                    internal.direction = internal.pendingDirection;
                    internal.pendingDirection = null;
                }

                const head = player.segments[0];
                let newX = head.x + internal.direction.x * CONFIG.scale;
                let newY = head.y + internal.direction.y * CONFIG.scale;

                // Wrap around
                if (newX >= CONFIG.width) newX = 0;
                if (newX < 0) newX = CONFIG.width - CONFIG.scale;
                if (newY >= CONFIG.height) newY = 0;
                if (newY < 0) newY = CONFIG.height - CONFIG.scale;

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
                        if (player.score >= CONFIG.winningScore) {
                            this.state.winnerId = sessionId;
                            console.log(`Snake player ${sessionId} wins!`);
                            this.broadcast('playWinSound');
                        }

                        this.state.food.splice(i, 1);
                        if (!this.state.winnerId) {
                            this.generateFood(1);
                        }
                        break;
                    }
                }

                // Move snake
                const tailPos = player.segments.length > 0
                    ? { x: player.segments[player.segments.length - 1].x, y: player.segments[player.segments.length - 1].y }
                    : null;

                // Shift segments forward
                for (let i = player.segments.length - 1; i > 0; i--) {
                    player.segments[i].x = player.segments[i - 1].x;
                    player.segments[i].y = player.segments[i - 1].y;
                }
                // Update head
                player.segments[0].x = newX;
                player.segments[0].y = newY;

                // Grow if ate food
                if (ateFood && tailPos) {
                    const newSeg = new Position();
                    newSeg.x = tailPos.x;
                    newSeg.y = tailPos.y;
                    player.segments.push(newSeg);
                }

                // Check collisions with all snakes (including self)
                let collisionDetected = false;
                for (const [otherId, otherPlayer] of this.state.players) {
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

                    // Reset player
                    const pos = this.randomPosition();
                    player.segments.splice(0, player.segments.length);
                    const seg = new Position();
                    seg.x = pos.x;
                    seg.y = pos.y;
                    player.segments.push(seg);
                    player.score = 0;
                    internal.direction = { x: 1, y: 0 };
                    internal.pendingDirection = null;
                    internal.lastMoveTime = now;
                }
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    generateFood(count) {
        const cols = Math.floor(CONFIG.width / CONFIG.scale);
        const rows = Math.floor(CONFIG.height / CONFIG.scale);

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
                x = Math.floor(Math.random() * cols) * CONFIG.scale;
                y = Math.floor(Math.random() * rows) * CONFIG.scale;
                if (!occupied.has(`${x},${y}`)) {
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                for (let gx = 0; gx < cols && !placed; gx++) {
                    for (let gy = 0; gy < rows && !placed; gy++) {
                        x = gx * CONFIG.scale;
                        y = gy * CONFIG.scale;
                        if (!occupied.has(`${x},${y}`)) {
                            placed = true;
                        }
                    }
                }
            }

            if (placed) {
                occupied.add(`${x},${y}`);
                const f = new Food();
                f.x = x;
                f.y = y;
                this.state.food.push(f);
            }
        }
    }

    getAvailableColor() {
        for (const color of COLORS) {
            if (!this.usedColors.has(color)) return color;
        }
        return COLORS[0];
    }

    randomPosition() {
        return {
            x: Math.floor(Math.random() * (CONFIG.width / CONFIG.scale)) * CONFIG.scale,
            y: Math.floor(Math.random() * (CONFIG.height / CONFIG.scale)) * CONFIG.scale,
        };
    }

    checkInactivity() {
        const now = Date.now();
        for (const [sessionId, internal] of this.playerInternal) {
            if (now - internal.lastActivityTime > CONFIG.inactivityTimeout) {
                console.log(`Snake player ${sessionId} timed out`);
                const client = this.clients.find(c => c.sessionId === sessionId);
                if (client) client.leave();
            }
        }
    }

    onDispose() {
        console.log('SnakeRoom disposed');
    }
}

module.exports = { SnakeRoom, SnakeState };
