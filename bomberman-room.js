const { Bomb, Explosion, Pickup, Wall } = require('./schema');

// ── Bomberman configuration ─────────────────────────────────────────

const BOMBERMAN_CONFIG = {
    scale: 32,
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
};

const CONFIG = BOMBERMAN_CONFIG;

// ── Bomberman server logic ──────────────────────────────────────────
// Mixed into GameRoom.prototype (see game-room.js), so `this` is the room.

const bombermanMethods = {

    registerBombermanMessages() {
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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },
};

module.exports = { BOMBERMAN_CONFIG, bombermanMethods };
