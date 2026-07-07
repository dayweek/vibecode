const { Position } = require('./schema');

// ── Snake configuration ─────────────────────────────────────────────

const SNAKE_CONFIG = {
    width: 800,
    height: 800,
    scale: 20,
    baseMoveInterval: 200,
    speedFactor: 0.95,
    winningScore: 20,
};

// ── Snake server logic ──────────────────────────────────────────────
// Mixed into GameRoom.prototype (see game-room.js), so `this` is the room.

const snakeMethods = {

    registerSnakeMessages() {
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
    },

    startSnakeGame() {
        console.log('Starting Snake game...');
        this.clearGameObjects();

        // Snake plays on an empty fixed-size grid — clear any bomberman walls
        this.clearBoard();

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
    },

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
    },

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
    },

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
    },

    randomSnakePosition() {
        return {
            x: Math.floor(Math.random() * (SNAKE_CONFIG.width / SNAKE_CONFIG.scale)) * SNAKE_CONFIG.scale,
            y: Math.floor(Math.random() * (SNAKE_CONFIG.height / SNAKE_CONFIG.scale)) * SNAKE_CONFIG.scale,
        };
    },
};

module.exports = { SNAKE_CONFIG, snakeMethods };
