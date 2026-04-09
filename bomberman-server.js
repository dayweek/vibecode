// Bomberman game server logic

// Available colors for players
const COLORS = [
    '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
    '#FFA500', '#800080', '#FFFFFF', '#008000', '#ADD8E6', '#FFC0CB',
    '#A52A2A', '#808080', '#FFD700', '#40E0D0', '#FA8072', '#90EE90',
    '#E6E6FA', '#D2B48C'
];

class BombermanGame {
    constructor(io) {
        this.io = io;
        this.persistentPlayers = new Map(); // Map of persistentId -> player data for reconnection
        this.socketToPersistentId = new Map(); // Map of socket.id -> persistentId

        // Input queues — drained at the start of each game tick to avoid race conditions
        this.pendingDisconnects = [];
        this.pendingBombRequests = [];
        this.pendingMoveChanges = [];

        // Spatial lookup structures for O(1) collision checks
        this.wallLookup = new Set();           // "x,y" keys for all wall tiles (indestructible + destructible)
        this.indestructibleLookup = new Set(); // "x,y" keys for indestructible walls only
        this.bombLookup = new Map();           // "x,y" -> bomb object
        this.lavaLookup = new Set();           // "x,y" keys for lava tiles

        // Timeout handles for cleanup
        this.gameLoopTimeout = null;
        this.restartTimeout = null;
        this.cleanupTimeouts = new Map(); // persistentId -> timeout handle

        this.gameState = {
            players: new Map(),
            bombPickups: [],
            powerups: [], // Flame powerups
            bombs: [],
            explosions: [],
            indestructibleWalls: [], // Permanent walls
            destructibleWalls: [], // Walls that can be destroyed
            lavaTiles: [], // Permanent lava hazards spawned from destroyed walls
            width: 1024,
            height: 864,
            scale: 32,
            cols: 32,
            rows: 27,
            updateInterval: 100, // ms per game update tick
            moveInterval: 195, // ms between player moves (30% slower than original 150ms)
            usedColors: new Set(),
            winnerId: null,
            bombPickupSpawnRate: 0.02, // Chance per update to spawn a pickup
            maxBombPickups: 10,
            bombFuseTime: 3000, // 3 seconds
            explosionDuration: 500, // 0.5 seconds
            baseExplosionRange: 1, // Base explosion range for new players
            destructibleWallDensity: 0.55, // 55% of non-indestructible tiles
            hiddenBombChance: 0.333, // 33.3% of destructible walls contain bombs (2x flame powerups)
            flamePowerupChance: 0.25, // 25% chance to spawn flame powerup when wall destroyed
            speedPowerupChance: 0.25, // 25% chance to spawn speed powerup when wall destroyed
            invisibilityPowerupChance: 0.05, // 5% chance to spawn invisibility powerup (rare)
            lifePowerupChance: 0.05, // 5% chance to spawn life powerup (rare - protects from 1 explosion)
            invisibilityDuration: 10000, // 10 seconds
            lavaTileSpawnRate: 0.05, // 5% chance to spawn lava when wall destroyed
            lavaWallReplacementRate: 0.02, // 2% of indestructible walls become lava
            maxSpeedBoosts: 5, // Maximum speed boosts a player can collect
            maxPlayers: 20 // Maximum expected players for full-size grid
        };

        // Initialize grid size based on initial player count (0 at this point)
        this.updateGridSize();
        this.generateEnvironment();
        this.spawnInitialBombPickups();
        this.setupNamespace();
        this.startGameLoop();
        this.startInactivityCheck();
    }

    calculateGridSize(playerCount) {
        // Scale grid based on player count
        // 1-4 players: 50% size, 5-12 players: 75% size, 13-20 players: 100% size
        const baseCols = 32;
        const baseRows = 27;

        let scaleFactor;
        if (playerCount <= 4) {
            scaleFactor = 0.5; // 16x14
        } else if (playerCount <= 12) {
            scaleFactor = 0.75; // 24x20
        } else {
            scaleFactor = 1.0; // 32x27
        }

        const cols = Math.floor(baseCols * scaleFactor);
        const rows = Math.floor(baseRows * scaleFactor);

        return { cols, rows };
    }

    updateGridSize() {
        const playerCount = this.gameState.players.size;
        const { cols, rows } = this.calculateGridSize(playerCount);

        // Only regenerate if size changed
        if (cols !== this.gameState.cols || rows !== this.gameState.rows) {
            this.gameState.cols = cols;
            this.gameState.rows = rows;
            this.gameState.width = cols * this.gameState.scale;
            this.gameState.height = rows * this.gameState.scale;

            console.log(`Grid resized for ${playerCount} players: ${cols}x${rows}`);

            // Regenerate environment with new size
            this.generateEnvironment();

            // Reposition existing players to valid spawn points
            this.gameState.players.forEach(player => {
                const pos = this.getRandomEmptyPosition();
                player.x = pos.x;
                player.y = pos.y;
                player.activeBombs = 0; // Reset active bombs since we cleared them
            });

            // Clear bombs, pickups, and powerups
            this.gameState.bombs = [];
            this.gameState.explosions = [];
            this.gameState.bombPickups = [];
            this.gameState.powerups = [];
            this.gameState.lavaTiles = [];
            this.bombLookup.clear();
            this.lavaLookup.clear();

            return true; // Grid was resized
        }

        return false; // No resize needed
    }

    generateEnvironment() {
        // Clear existing walls
        this.gameState.indestructibleWalls = [];
        this.gameState.destructibleWalls = [];

        const { cols, rows, scale } = this.gameState;

        // Define spawn safe zones with L-shaped clear areas
        // Each spawn point needs: spawn tile + 3 tiles in one direction + 3 tiles in perpendicular direction
        const spawnZones = [
            // Top-left corner - L shape going right and down
            { x: 0, y: 0, pattern: 'top-left' },
            // Top-right corner - L shape going left and down
            { x: cols - 1, y: 0, pattern: 'top-right' },
            // Bottom-left corner - L shape going right and up
            { x: 0, y: rows - 1, pattern: 'bottom-left' },
            // Bottom-right corner - L shape going left and up
            { x: cols - 1, y: rows - 1, pattern: 'bottom-right' },
            // Mid positions with L shapes
            { x: Math.floor(cols / 2), y: 0, pattern: 'top-left' },
            { x: Math.floor(cols / 2), y: rows - 1, pattern: 'bottom-left' },
            { x: 0, y: Math.floor(rows / 2), pattern: 'top-left' },
            { x: cols - 1, y: Math.floor(rows / 2), pattern: 'top-right' }
        ];

        const isInSafeZone = (col, row) => {
            return spawnZones.some(zone => {
                // Check if position is part of the L-shaped safe zone
                const dx = col - zone.x;
                const dy = row - zone.y;

                switch (zone.pattern) {
                    case 'top-left':
                        // Horizontal arm: 0-3 to right, Vertical arm: 0-3 down
                        return (dx >= 0 && dx <= 3 && dy === 0) || (dx === 0 && dy >= 0 && dy <= 3);
                    case 'top-right':
                        // Horizontal arm: 0-3 to left, Vertical arm: 0-3 down
                        return (dx >= -3 && dx <= 0 && dy === 0) || (dx === 0 && dy >= 0 && dy <= 3);
                    case 'bottom-left':
                        // Horizontal arm: 0-3 to right, Vertical arm: 0-3 up
                        return (dx >= 0 && dx <= 3 && dy === 0) || (dx === 0 && dy >= -3 && dy <= 0);
                    case 'bottom-right':
                        // Horizontal arm: 0-3 to left, Vertical arm: 0-3 up
                        return (dx >= -3 && dx <= 0 && dy === 0) || (dx === 0 && dy >= -3 && dy <= 0);
                    default:
                        return false;
                }
            });
        };

        // Store spawn points for player spawning
        this.spawnPoints = spawnZones.map(zone => ({
            x: zone.x * scale,
            y: zone.y * scale
        }));

        // Step 1: Place indestructible walls in a grid pattern
        // Only place on even rows AND even cols to ensure all areas are accessible
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // Skip safe zones
                if (isInSafeZone(col, row)) continue;

                // Modified checkerboard: only on even row AND even col positions
                // This ensures that between any two indestructible walls, there's always
                // at least one tile that can be cleared (destructible or empty)
                if (row % 2 === 0 && col % 2 === 0) {
                    // Don't place indestructible walls on edges to ensure border accessibility
                    if (row > 0 && row < rows - 1 && col > 0 && col < cols - 1) {
                        // 5% chance to place lava instead of indestructible wall
                        if (Math.random() < this.gameState.lavaWallReplacementRate) {
                            this.gameState.lavaTiles.push({
                                x: col * scale,
                                y: row * scale
                            });
                        } else {
                            this.gameState.indestructibleWalls.push({
                                x: col * scale,
                                y: row * scale
                            });
                        }
                    }
                }
            }
        }

        // Step 1.5: Create edge pocket walls to separate spawn zones
        // Add walls near edges (not on edges) to create pockets
        const pocketWallDistance = 4; // Distance from edge to place pocket walls

        // Top and bottom edge pockets
        for (let col = pocketWallDistance; col < cols - pocketWallDistance; col += 2) {
            // Top pocket walls (skip middle spawn point area)
            if (col < Math.floor(cols / 2) - 2 || col > Math.floor(cols / 2) + 2) {
                if (!isInSafeZone(col, 2)) {
                    // Check if there's already an indestructible wall at this position
                    const hasIndestructible = this.gameState.indestructibleWalls.some(
                        w => w.x === col * scale && w.y === 2 * scale
                    );
                    if (!hasIndestructible) {
                        this.gameState.destructibleWalls.push({
                            x: col * scale,
                            y: 2 * scale,
                            hasHiddenBomb: false
                        });
                    }
                }
            }
            // Bottom pocket walls (skip middle spawn point area)
            if (col < Math.floor(cols / 2) - 2 || col > Math.floor(cols / 2) + 2) {
                if (!isInSafeZone(col, rows - 3)) {
                    // Check if there's already an indestructible wall at this position
                    const hasIndestructible = this.gameState.indestructibleWalls.some(
                        w => w.x === col * scale && w.y === (rows - 3) * scale
                    );
                    if (!hasIndestructible) {
                        this.gameState.destructibleWalls.push({
                            x: col * scale,
                            y: (rows - 3) * scale,
                            hasHiddenBomb: false
                        });
                    }
                }
            }
        }

        // Left and right edge pockets
        for (let row = pocketWallDistance; row < rows - pocketWallDistance; row += 2) {
            // Left pocket walls (skip middle spawn point area)
            if (row < Math.floor(rows / 2) - 2 || row > Math.floor(rows / 2) + 2) {
                if (!isInSafeZone(2, row)) {
                    // Check if there's already an indestructible wall at this position
                    const hasIndestructible = this.gameState.indestructibleWalls.some(
                        w => w.x === 2 * scale && w.y === row * scale
                    );
                    if (!hasIndestructible) {
                        this.gameState.destructibleWalls.push({
                            x: 2 * scale,
                            y: row * scale,
                            hasHiddenBomb: false
                        });
                    }
                }
            }
            // Right pocket walls (skip middle spawn point area)
            if (row < Math.floor(rows / 2) - 2 || row > Math.floor(rows / 2) + 2) {
                if (!isInSafeZone(cols - 3, row)) {
                    // Check if there's already an indestructible wall at this position
                    const hasIndestructible = this.gameState.indestructibleWalls.some(
                        w => w.x === (cols - 3) * scale && w.y === row * scale
                    );
                    if (!hasIndestructible) {
                        this.gameState.destructibleWalls.push({
                            x: (cols - 3) * scale,
                            y: row * scale,
                            hasHiddenBomb: false
                        });
                    }
                }
            }
        }

        // Step 2: Place destructible walls randomly (including edges)
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // Skip safe zones
                if (isInSafeZone(col, row)) continue;

                // Skip if there's already an indestructible wall
                const hasIndestructible = this.gameState.indestructibleWalls.some(
                    w => w.x === col * scale && w.y === row * scale
                );
                if (hasIndestructible) continue;

                // Skip if there's already a pocket wall at this position
                const hasPocketWall = this.gameState.destructibleWalls.some(
                    w => w.x === col * scale && w.y === row * scale
                );
                if (hasPocketWall) continue;

                // Higher density for edge walls to create better separation
                let density = this.gameState.destructibleWallDensity;
                const isEdge = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;
                if (isEdge) {
                    density = 0.7; // 70% density on edges for better separation
                }

                // Place destructible wall with probability
                if (Math.random() < density) {
                    const hasHiddenBomb = Math.random() < this.gameState.hiddenBombChance;
                    this.gameState.destructibleWalls.push({
                        x: col * scale,
                        y: row * scale,
                        hasHiddenBomb: hasHiddenBomb
                    });
                }
            }
        }

        console.log(`Generated ${this.gameState.indestructibleWalls.length} indestructible walls`);
        console.log(`Generated ${this.gameState.destructibleWalls.length} destructible walls`);

        // Rebuild spatial lookups
        this.rebuildWallLookup();
    }

    rebuildWallLookup() {
        this.wallLookup.clear();
        this.indestructibleLookup.clear();
        this.gameState.indestructibleWalls.forEach(w => {
            const key = `${w.x},${w.y}`;
            this.wallLookup.add(key);
            this.indestructibleLookup.add(key);
        });
        this.gameState.destructibleWalls.forEach(w => this.wallLookup.add(`${w.x},${w.y}`));
        this.lavaLookup.clear();
        this.gameState.lavaTiles.forEach(l => this.lavaLookup.add(`${l.x},${l.y}`));
        this.bombLookup.clear();
        this.gameState.bombs.forEach(b => this.bombLookup.set(`${b.x},${b.y}`, b));
    }

    spawnInitialBombPickups() {
        // Don't spawn any initial bomb pickups
        // Bombs only come from hidden drops in destructible walls
    }

    getAvailableColor() {
        for (const color of COLORS) {
            if (!this.gameState.usedColors.has(color)) {
                return color;
            }
        }
        console.warn("All primary colors are in use. Reusing colors.");
        return COLORS[0];
    }

    getRandomEmptyPosition() {
        // Use predefined spawn points for players
        if (this.spawnPoints && this.spawnPoints.length > 0) {
            // Count how many players are at each spawn point
            const spawnCounts = this.spawnPoints.map(spawnPoint => {
                let count = 0;
                this.gameState.players.forEach(player => {
                    if (player.x === spawnPoint.x && player.y === spawnPoint.y) {
                        count++;
                    }
                });
                return count;
            });

            // Find spawn point with minimum players (to spread players out)
            let minCount = Math.min(...spawnCounts);
            const availableSpawns = this.spawnPoints.filter((_, index) => spawnCounts[index] === minCount);

            // Randomly select from spawn points with minimum players
            const selectedSpawn = availableSpawns[Math.floor(Math.random() * availableSpawns.length)];
            return { x: selectedSpawn.x, y: selectedSpawn.y };
        }

        // Fallback: random position (used for bomb pickups)
        const cols = Math.floor(this.gameState.width / this.gameState.scale);
        const rows = Math.floor(this.gameState.height / this.gameState.scale);

        let attempts = 0;
        const maxAttempts = 100;

        while (attempts < maxAttempts) {
            const x = Math.floor(Math.random() * cols) * this.gameState.scale;
            const y = Math.floor(Math.random() * rows) * this.gameState.scale;

            // Check if position is occupied by a player
            let occupied = false;
            this.gameState.players.forEach(player => {
                if (player.x === x && player.y === y) {
                    occupied = true;
                }
            });

            const key = `${x},${y}`;

            // Use spatial lookups for O(1) checks
            if (!occupied && this.wallLookup.has(key)) {
                occupied = true;
            }
            if (!occupied && this.bombLookup.has(key)) {
                occupied = true;
            }
            if (!occupied && this.lavaLookup.has(key)) {
                occupied = true;
            }
            if (!occupied && this.gameState.bombPickups.some(p => p.x === x && p.y === y)) {
                occupied = true;
            }

            if (!occupied) {
                return { x, y };
            }

            attempts++;
        }

        // Fallback: return null if no position found
        return null;
    }

    updateGameState() {
        const now = Date.now();

        // Drain pending disconnects safely before iterating players
        while (this.pendingDisconnects.length > 0) {
            const playerId = this.pendingDisconnects.shift();
            this._processDisconnect(playerId);
        }

        // Drain pending move changes
        // Only keep the last direction per player (deduplicates rapid inputs)
        const lastMovePerPlayer = new Map();
        while (this.pendingMoveChanges.length > 0) {
            const change = this.pendingMoveChanges.shift();
            lastMovePerPlayer.set(change.playerId, change.direction);
        }
        lastMovePerPlayer.forEach((direction, playerId) => {
            const player = this.gameState.players.get(playerId);
            if (player && player.alive) {
                player.currentDirection = direction;
                if (direction) {
                    player.lastMoveTime = now - this.gameState.moveInterval;
                }
            }
        });

        // Pause game logic if there's a winner
        if (this.gameState.winnerId) return;

        // Track walls to destroy in this tick (to handle simultaneous explosions correctly)
        // Store as "x,y" strings
        const wallsToDestroy = new Set();

        // Update bombs (check for explosions)
        const bombsToExplode = new Set();
        const bombsQueue = [];

        // 1. Identify natural explosions (fuse expired)
        this.gameState.bombs.forEach(bomb => {
            const timeElapsed = now - bomb.placedTime;
            if (timeElapsed >= this.gameState.bombFuseTime) {
                if (!bombsToExplode.has(bomb)) {
                    bombsToExplode.add(bomb);
                    bombsQueue.push(bomb);
                }
            }
        });

        // 2. Process chain reactions
        // Execute explosions for all bombs in queue, adding any chained bombs to the queue
        let head = 0;
        while(head < bombsQueue.length) {
            const bomb = bombsQueue[head];
            head++;
            
            // Get the player to determine bomb range
            const placingPlayer = this.gameState.players.get(bomb.playerId);
            const range = placingPlayer ? placingPlayer.bombRange : 1;

            // createExplosion now returns an array of bombs hit by this explosion
            // It modifies game state (adds explosion tiles) but DOES NOT remove bombs or recurse
            const hitBombs = this.createExplosion(bomb.x, bomb.y, wallsToDestroy, range, bomb.playerId);
            
            hitBombs.forEach(hitBomb => {
                if (!bombsToExplode.has(hitBomb)) {
                    bombsToExplode.add(hitBomb);
                    bombsQueue.push(hitBomb);
                }
            });
            
            // Decrement activeBombs for the player who placed it
            const player = this.gameState.players.get(bomb.playerId);
            if (player && player.activeBombs > 0) {
                player.activeBombs--;
            }
        }

        // 3. Remove all exploded bombs from game state
        if (bombsToExplode.size > 0) {
            bombsToExplode.forEach(bomb => this.bombLookup.delete(`${bomb.x},${bomb.y}`));
            this.gameState.bombs = this.gameState.bombs.filter(bomb => !bombsToExplode.has(bomb));

            // Emit explosion sound to all players (once per tick, even for chain reactions)
            this.io.of('/bomberman').emit('playExplosionSound');
        }

        // Process deferred wall destruction
        if (wallsToDestroy.size > 0) {
            // Filter out destroyed walls and spawn pickups
            this.gameState.destructibleWalls = this.gameState.destructibleWalls.filter(wall => {
                const key = `${wall.x},${wall.y}`;
                if (wallsToDestroy.has(key)) {
                    // This wall is destroyed
                    // Drop bomb pickup if wall contained one
                    if (wall.hasHiddenBomb) {
                        this.gameState.bombPickups.push({ x: wall.x, y: wall.y });
                    }
                    // Random chance to spawn lava or powerups
                    else {
                        const roll = Math.random();

                        // 2% chance to spawn lava tile
                        if (roll < this.gameState.lavaTileSpawnRate) {
                            this.gameState.lavaTiles.push({
                                x: wall.x,
                                y: wall.y
                            });
                            this.lavaLookup.add(`${wall.x},${wall.y}`);
                        }
                        // Remaining chances for powerups (check in order: invisibility, flame, speed, life)
                        else if (roll < this.gameState.lavaTileSpawnRate + this.gameState.invisibilityPowerupChance) {
                            this.gameState.powerups.push({
                                x: wall.x,
                                y: wall.y,
                                type: 'invisibility' // Makes player invisible for 10 seconds
                            });
                        } else if (roll < this.gameState.lavaTileSpawnRate + this.gameState.invisibilityPowerupChance + this.gameState.flamePowerupChance) {
                            this.gameState.powerups.push({
                                x: wall.x,
                                y: wall.y,
                                type: 'flame' // Increases bomb explosion range
                            });
                        } else if (roll < this.gameState.lavaTileSpawnRate + this.gameState.invisibilityPowerupChance + this.gameState.flamePowerupChance + this.gameState.speedPowerupChance) {
                            this.gameState.powerups.push({
                                x: wall.x,
                                y: wall.y,
                                type: 'speed' // Increases movement speed by 10%
                            });
                        } else if (roll < this.gameState.lavaTileSpawnRate + this.gameState.invisibilityPowerupChance + this.gameState.flamePowerupChance + this.gameState.speedPowerupChance + this.gameState.lifePowerupChance) {
                            this.gameState.powerups.push({
                                x: wall.x,
                                y: wall.y,
                                type: 'life' // Protects from 1 explosion
                            });
                        }
                    }
                    this.wallLookup.delete(key); // Update spatial lookup
                    return false; // Remove from array
                }
                return true; // Keep in array
            });
        }

        // Update explosions (remove expired ones)
        this.gameState.explosions = this.gameState.explosions.filter(explosion => {
            const timeElapsed = now - explosion.createdTime;
            return timeElapsed < this.gameState.explosionDuration;
        });

        // Process pending bomb placements (queued from event handlers)
        while (this.pendingBombRequests.length > 0) {
            const socketId = this.pendingBombRequests.shift();
            const player = this.gameState.players.get(socketId);
            if (player && player.alive && player.activeBombs < player.maxBombs) {
                const key = `${player.x},${player.y}`;
                if (!this.bombLookup.has(key)) {
                    const bomb = {
                        x: player.x,
                        y: player.y,
                        placedTime: now,
                        playerId: socketId
                    };
                    this.gameState.bombs.push(bomb);
                    this.bombLookup.set(key, bomb);
                    player.activeBombs++;
                    player.lastBombPlacedTime = now;
                }
            }
        }

        // Move players
        this.gameState.players.forEach((player, playerId) => {
            if (!player.alive) return;

            // Calculate move interval based on speed boosts (10% faster per boost)
            const speedMultiplier = Math.pow(0.9, player.speedBoosts); // 0.9^speedBoosts
            const playerMoveInterval = this.gameState.moveInterval * speedMultiplier;

            // Check if enough time has passed to move
            // Use currentDirection for continuous movement instead of pendingMove
            if (player.currentDirection && now - player.lastMoveTime >= playerMoveInterval) {
                player.lastMoveTime = now;

                const newX = player.x + player.currentDirection.x * this.gameState.scale;
                const newY = player.y + player.currentDirection.y * this.gameState.scale;

                // Check boundaries (no wrapping)
                if (newX >= 0 && newX < this.gameState.width && newY >= 0 && newY < this.gameState.height) {
                    // Players can pass through each other - no player collision check
                    let collision = false;
                    const targetKey = `${newX},${newY}`;

                    // Check collision with walls (O(1) lookup)
                    if (this.wallLookup.has(targetKey)) {
                        collision = true;
                    }

                    // Note: Lava tiles do NOT block movement - players can walk onto them and die

                    // Check collision with bombs (O(1) lookup)
                    // Solid Bomb Rule: Can walk off a bomb, but cannot walk onto it
                    if (!collision) {
                        const bombAtTarget = this.bombLookup.get(targetKey);
                        if (bombAtTarget) {
                            if (player.x !== bombAtTarget.x || player.y !== bombAtTarget.y) {
                                collision = true;
                            }
                        }
                    }

                    if (!collision) {
                        player.x = newX;
                        player.y = newY;

                        // Check for bomb pickup collection
                        const pickupIndex = this.gameState.bombPickups.findIndex(
                            p => p.x === newX && p.y === newY
                        );

                        if (pickupIndex !== -1) {
                            player.maxBombs++; // Increase maximum simultaneous bombs
                            this.gameState.bombPickups.splice(pickupIndex, 1);

                            // Emit level-up sound to this player only
                            const playerSocket = this.io.of('/bomberman').sockets.get(playerId);
                            if (playerSocket) playerSocket.emit('playLevelUpSound');
                        }

                        // Check for powerup collection
                        const powerupIndex = this.gameState.powerups.findIndex(
                            p => p.x === newX && p.y === newY
                        );

                        if (powerupIndex !== -1) {
                            const powerup = this.gameState.powerups[powerupIndex];
                            if (powerup.type === 'flame') {
                                player.bombRange++; // Increase bomb explosion range
                            } else if (powerup.type === 'speed') {
                                if (player.speedBoosts < this.gameState.maxSpeedBoosts) {
                                    player.speedBoosts++; // Increase speed (max 5)
                                }
                            } else if (powerup.type === 'invisibility') {
                                // Activate invisibility for 10 seconds
                                player.invisibleUntil = Date.now() + this.gameState.invisibilityDuration;
                            } else if (powerup.type === 'life') {
                                // Grant 1 extra life (protection from 1 explosion)
                                player.lives++;
                            }
                            this.gameState.powerups.splice(powerupIndex, 1);

                            // Emit level-up sound to this player only
                            const playerSocket = this.io.of('/bomberman').sockets.get(playerId);
                            if (playerSocket) playerSocket.emit('playLevelUpSound');
                        }
                    }
                }

                player.pendingMove = null;
            }
        });

        // Check for player deaths from explosions
        this.gameState.explosions.forEach(explosion => {
            this.gameState.players.forEach((player, playerId) => {
                if (player.alive && player.x === explosion.x && player.y === explosion.y) {
                    // Check spawn protection
                    if (!player.protectedUntil || Date.now() > player.protectedUntil) {
                        // Check if player has extra lives
                        if (player.lives > 0) {
                            // Consume one life instead of dying
                            player.lives--;
                            // Grant temporary protection (2 seconds) after losing a life
                            player.protectedUntil = Date.now() + 2000;
                        } else {
                            // No lives left - player dies
                            player.alive = false;

                            // Track who killed this player
                            if (explosion.playerId === playerId) {
                                player.killedBy = 'self'; // Killed by own bomb
                            } else {
                                player.killedBy = explosion.playerId; // Killed by another player
                            }

                            // Emit death sound (disabled)
                            // const playerSocket = this.io.of('/bomberman').sockets.get(playerId);
                            // if (playerSocket) playerSocket.emit('playDieSound');
                        }
                    }
                }
            });
        });

        // Check for player deaths from lava tiles — lava is always instant kill
        this.gameState.lavaTiles.forEach(lava => {
            this.gameState.players.forEach((player, playerId) => {
                if (player.alive && player.x === lava.x && player.y === lava.y) {
                    if (!player.protectedUntil || Date.now() > player.protectedUntil) {
                        player.alive = false;
                        player.killedBy = 'lava';
                    }
                }
            });
        });

        // Check win condition
        const alivePlayers = Array.from(this.gameState.players.values()).filter(p => p.alive);

        if (this.gameState.players.size > 1) {
            if (alivePlayers.length === 1) {
                // One player alive - they win
                this.gameState.winnerId = Array.from(this.gameState.players.entries())
                    .find(([id, player]) => player.alive)?.[0];

                if (this.gameState.winnerId) {
                    console.log(`Player ${this.gameState.winnerId} wins!`);
                    this.io.of('/bomberman').emit('playWinSound');
                }
            } else if (alivePlayers.length === 0 && !this.gameState.winnerId) {
                // All players dead (last player killed themselves) - no winner, draw
                console.log('All players eliminated - Draw! Restarting game...');
                this.gameState.winnerId = 'draw'; // Special value to indicate draw

                // Auto-restart after 3 seconds (tracked for cancellation)
                this.restartTimeout = setTimeout(() => {
                    this.restartGame();
                }, 3000);
            }
        }

        // Sync active players to persistent storage
        this.gameState.players.forEach((player, socketId) => {
            const persistentId = this.socketToPersistentId.get(socketId);
            if (persistentId) {
                this.persistentPlayers.set(persistentId, { ...player });
            }
        });
    }

    createExplosion(centerX, centerY, wallsToDestroy, bombRange, playerId) {
        const explosionTiles = [];
        const scale = this.gameState.scale;
        const bombsToChainExplode = []; // Track bombs hit by this explosion

        // Center tile always explodes
        explosionTiles.push({ x: centerX, y: centerY });

        // Check if center destroys a destructible wall (O(1) lookup)
        const centerKey = `${centerX},${centerY}`;
        if (this.wallLookup.has(centerKey) && !this.indestructibleLookup.has(centerKey)) {
            wallsToDestroy.add(centerKey);
        }

        // Cross pattern in 4 directions
        const directions = [
            { x: 1, y: 0 },   // Right
            { x: -1, y: 0 },  // Left
            { x: 0, y: 1 },   // Down
            { x: 0, y: -1 }   // Up
        ];

        directions.forEach(dir => {
            for (let i = 1; i <= bombRange; i++) {
                const x = centerX + dir.x * scale * i;
                const y = centerY + dir.y * scale * i;

                // Check boundaries
                if (x < 0 || x >= this.gameState.width || y < 0 || y >= this.gameState.height) {
                    break;
                }

                const key = `${x},${y}`;

                // Check for lava tile - explosion stops
                if (this.lavaLookup.has(key)) {
                    break;
                }

                // Check for walls using lookup
                if (this.wallLookup.has(key)) {
                    if (this.indestructibleLookup.has(key)) {
                        break; // Stop — indestructible wall blocks
                    }

                    // Destructible wall — add explosion, mark for destruction, stop
                    explosionTiles.push({ x, y });
                    wallsToDestroy.add(key);
                    break;
                }

                // No wall, explosion continues
                explosionTiles.push({ x, y });
            }
        });

        // Add explosions with timestamp and player ID
        const now = Date.now();
        explosionTiles.forEach(tile => {
            this.gameState.explosions.push({
                x: tile.x,
                y: tile.y,
                createdTime: now,
                playerId: playerId // Track who caused this explosion
            });

            // Check if there's a bomb at this explosion tile (O(1) lookup)
            const bombAtTile = this.bombLookup.get(`${tile.x},${tile.y}`);
            if (bombAtTile) {
                bombsToChainExplode.push(bombAtTile);
            }
        });

        // Return the list of bombs hit by this explosion
        // The chain reaction is handled iteratively in updateGameState
        return bombsToChainExplode;
    }

    restartGame() {
        console.log('Restarting game...');

        // Clear pending restart timeout
        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
            this.restartTimeout = null;
        }

        // Reset winner
        this.gameState.winnerId = null;

        // Clear game objects
        this.gameState.bombs = [];
        this.gameState.explosions = [];
        this.gameState.bombPickups = [];
        this.gameState.powerups = [];
        this.gameState.lavaTiles = [];
        this.bombLookup.clear();

        // Resize grid if player count changed thresholds, then regenerate
        this.updateGridSize();
        this.generateEnvironment();

        // Reset all players
        this.gameState.players.forEach((player) => {
            const pos = this.getRandomEmptyPosition();
            player.x = pos.x;
            player.y = pos.y;
            player.maxBombs = 1;
            player.activeBombs = 0;
            player.bombRange = this.gameState.baseExplosionRange;
            player.speedBoosts = 0;
            player.invisibleUntil = 0;
            player.protectedUntil = Date.now() + 2000;
            player.lives = 0;
            player.alive = true;
            player.killedBy = null;
            player.currentDirection = null;
            player.lastMoveTime = Date.now();
            player.lastActivityTime = Date.now();
        });

        // Spawn initial bomb pickups
        this.spawnInitialBombPickups();

        // Update persistent storage
        this.gameState.players.forEach((player, socketId) => {
            const persistentId = this.socketToPersistentId.get(socketId);
            if (persistentId) {
                this.persistentPlayers.set(persistentId, { ...player });
            }
        });

        // Broadcast new state
        this.broadcastGameState();
    }

    broadcastGameState() {
        const now = Date.now();

        // Snapshot players to avoid iteration issues from concurrent disconnects
        const playerSnapshot = new Map(this.gameState.players);

        // Build player list once with invisible flag — client handles visibility
        const allPlayers = Array.from(playerSnapshot.entries()).map(([id, p]) => ({
            id,
            x: p.x,
            y: p.y,
            color: p.color,
            playerName: p.playerName || '',
            maxBombs: p.maxBombs,
            activeBombs: p.activeBombs,
            bombRange: p.bombRange,
            speedBoosts: p.speedBoosts,
            invisibleUntil: p.invisibleUntil,
            protectedUntil: p.protectedUntil || 0,
            lives: p.lives || 0,
            alive: p.alive,
            killedBy: p.killedBy || null,
            lastMoveTime: p.lastMoveTime,
            isMoving: !!p.currentDirection,
            invisible: !!(p.invisibleUntil && p.invisibleUntil > now)
        }));

        // Single broadcast to entire room (instead of per-player)
        const state = {
            players: allPlayers,
            bombPickups: this.gameState.bombPickups,
            powerups: this.gameState.powerups,
            bombs: this.gameState.bombs.map(bomb => ({
                x: bomb.x,
                y: bomb.y,
                placedTime: bomb.placedTime,
                fuseTime: this.gameState.bombFuseTime
            })),
            explosions: this.gameState.explosions,
            indestructibleWalls: this.gameState.indestructibleWalls,
            destructibleWalls: this.gameState.destructibleWalls.map(w => ({
                x: w.x,
                y: w.y
            })),
            lavaTiles: this.gameState.lavaTiles,
            winnerId: this.gameState.winnerId,
            width: this.gameState.width,
            height: this.gameState.height,
            timestamp: now
        };

        this.io.of('/bomberman').emit('gameState', state);
    }

    handleDisconnect(playerId) {
        console.log(`Queuing disconnect for Bomberman player ${playerId}...`);
        if (!this.pendingDisconnects.includes(playerId)) {
            this.pendingDisconnects.push(playerId);
        }
    }

    _processDisconnect(playerId) {
        const player = this.gameState.players.get(playerId);
        if (player) {
            const persistentId = this.socketToPersistentId.get(playerId);
            if (persistentId) {
                console.log(`Saving player state for ${persistentId}`);
                this.persistentPlayers.set(persistentId, {
                    ...player,
                    disconnectedAt: Date.now()
                });

                // Clear any existing cleanup timeout for this persistentId
                if (this.cleanupTimeouts.has(persistentId)) {
                    clearTimeout(this.cleanupTimeouts.get(persistentId));
                }

                // Clean up after 5 minutes (tracked for cancellation)
                const timeoutHandle = setTimeout(() => {
                    const savedPlayer = this.persistentPlayers.get(persistentId);
                    if (savedPlayer && savedPlayer.disconnectedAt) {
                        console.log(`Removing saved state for ${persistentId} after timeout`);
                        this.persistentPlayers.delete(persistentId);
                        this.gameState.usedColors.delete(savedPlayer.color);
                    }
                    this.cleanupTimeouts.delete(persistentId);
                }, 5 * 60 * 1000);
                this.cleanupTimeouts.set(persistentId, timeoutHandle);

                this.socketToPersistentId.delete(playerId);
            } else {
                this.gameState.usedColors.delete(player.color);
            }

            this.gameState.players.delete(playerId);
            this.io.of('/bomberman').emit('playerLeft', playerId);
        }
    }

    startGameLoop() {
        const tick = () => {
            const start = Date.now();
            this.updateGameState();
            this.broadcastGameState();
            const elapsed = Date.now() - start;
            this.gameLoopTimeout = setTimeout(tick, Math.max(0, this.gameState.updateInterval - elapsed));
        };
        tick();
    }

    startInactivityCheck() {
        const INACTIVITY_TIMEOUT = 60000; // 60 seconds
        setInterval(() => {
            const now = Date.now();
            this.gameState.players.forEach((player, playerId) => {
                if (now - player.lastActivityTime > INACTIVITY_TIMEOUT) {
                    console.log(`Bomberman player ${playerId} timed out due to inactivity.`);
                    const targetSocket = this.io.of('/bomberman').sockets.get(playerId);
                    if (targetSocket) {
                        targetSocket.disconnect(true);
                    }
                    this.handleDisconnect(playerId); // Queues for next tick
                }
            });
        }, 5000);
    }

    setupNamespace() {
        const bombermanNamespace = this.io.of('/bomberman');

        bombermanNamespace.on('connection', (socket) => {
            console.log('New Bomberman player connected:', socket.id);

            let playerCreated = false;

            // Handle reconnection
            socket.on('reconnect_player', (data) => {
                if (playerCreated) return; // Already created player for this socket

                // Handle both old format (string) and new format (object)
                const persistentId = typeof data === 'string' ? data : data.persistentId;
                const playerName = typeof data === 'object' ? data.playerName : '';

                console.log(`Reconnect request from ${socket.id} with persistentId: ${persistentId}, name: ${playerName}`);

                // Check if we have saved data for this persistent ID
                const savedPlayer = this.persistentPlayers.get(persistentId);

                if (savedPlayer && savedPlayer.alive) {
                    // Restore the player
                    console.log(`Restoring player ${persistentId} at position (${savedPlayer.x}, ${savedPlayer.y})`);

                    // Update the socket mapping
                    this.socketToPersistentId.set(socket.id, persistentId);

                    // Restore player with new socket ID and update name if provided
                    const restoredPlayer = {
                        ...savedPlayer,
                        playerName: playerName || savedPlayer.playerName || '',
                        lastActivityTime: Date.now(),
                        protectedUntil: Date.now() + 2000
                    };

                    this.gameState.players.set(socket.id, restoredPlayer);
                    socket.emit('playerColor', restoredPlayer.color);

                    playerCreated = true;
                } else {
                    // New player - create fresh
                    const color = this.getAvailableColor();
                    this.gameState.usedColors.add(color);

                    socket.emit('playerColor', color);

                    const pos = this.getRandomEmptyPosition();

                    const newPlayer = {
                        x: pos.x,
                        y: pos.y,
                        color: color,
                        playerName: playerName || '',
                        maxBombs: 1,
                        activeBombs: 0,
                        bombRange: 1,
                        speedBoosts: 0,
                        invisibleUntil: 0,
                        protectedUntil: Date.now() + 2000,
                        lives: 0,
                        alive: true,
                        lastMoveTime: Date.now(),
                        lastActivityTime: Date.now(),
                        currentDirection: null,
                        lastBombPlacedTime: 0
                    };

                    this.gameState.players.set(socket.id, newPlayer);
                    this.socketToPersistentId.set(socket.id, persistentId);
                    this.persistentPlayers.set(persistentId, newPlayer);

                    playerCreated = true;
                }

                // Send initial game state
                socket.emit('init', {
                    playerId: socket.id,
                    gameState: {
                        players: Array.from(this.gameState.players.entries()).map(([id, player]) => ({
                            id,
                            x: player.x,
                            y: player.y,
                            color: player.color,
                            playerName: player.playerName || '',
                            maxBombs: player.maxBombs,
                            activeBombs: player.activeBombs,
                            bombRange: player.bombRange,
                            speedBoosts: player.speedBoosts,
                            invisibleUntil: player.invisibleUntil,
                            protectedUntil: player.protectedUntil || 0,
                            lives: player.lives || 0,
                            alive: player.alive,
                            killedBy: player.killedBy || null
                        })),
                        bombPickups: this.gameState.bombPickups,
                        powerups: this.gameState.powerups,
                        bombs: this.gameState.bombs,
                        explosions: this.gameState.explosions,
                        indestructibleWalls: this.gameState.indestructibleWalls,
                        destructibleWalls: this.gameState.destructibleWalls.map(w => ({ x: w.x, y: w.y })),
                        lavaTiles: this.gameState.lavaTiles,
                        width: this.gameState.width,
                        height: this.gameState.height
                    }
                });

                // Notify all players
                bombermanNamespace.emit('playerJoined', {
                    playerId: socket.id,
                    playerData: this.gameState.players.get(socket.id)
                });
                bombermanNamespace.emit('playNewSound');
            });

            // Fallback: if no reconnect_player event received within 1 second, create new player
            setTimeout(() => {
                if (!playerCreated) {
                    console.log(`No reconnect event received for ${socket.id}, creating new player`);
                    socket.emit('reconnect_player', null); // Trigger with null ID
                }
            }, 1000);

            // Handle movement start — queue for game loop processing
            socket.on('moveStart', (direction) => {
                const player = this.gameState.players.get(socket.id);
                if (player && player.alive) {
                    player.lastActivityTime = Date.now();
                    this.pendingMoveChanges.push({ playerId: socket.id, direction });
                }
            });

            // Handle movement stop — queue for game loop processing
            socket.on('moveStop', () => {
                const player = this.gameState.players.get(socket.id);
                if (player) {
                    player.lastActivityTime = Date.now();
                    this.pendingMoveChanges.push({ playerId: socket.id, direction: null });
                }
            });

            // Handle bomb placement — queue for game loop processing
            socket.on('placeBomb', () => {
                const player = this.gameState.players.get(socket.id);
                if (player && player.alive) {
                    player.lastActivityTime = Date.now();
                    this.pendingBombRequests.push(socket.id);
                }
            });

            // Handle player name update
            socket.on('update_player_name', (newName) => {
                const player = this.gameState.players.get(socket.id);
                if (player) {
                    player.playerName = newName || '';
                    console.log(`Player ${socket.id} updated name to: ${newName}`);

                    // Update persistent storage
                    const persistentId = this.socketToPersistentId.get(socket.id);
                    if (persistentId) {
                        this.persistentPlayers.set(persistentId, { ...player });
                    }
                }
            });

            // Handle reset request
            socket.on('resetGame', () => {
                console.log(`Bomberman reset request from ${socket.id}`);
                const resetInitiatorId = socket.id;

                // Disconnect all other players
                this.gameState.players.forEach((player, id) => {
                    if (id !== resetInitiatorId) {
                        const targetSocket = bombermanNamespace.sockets.get(id);
                        if (targetSocket) {
                            this.gameState.usedColors.delete(player.color);
                            targetSocket.disconnect(true);
                            this.gameState.players.delete(id);
                        }
                    }
                });

                // Update grid size and then regenerate environment
                this.updateGridSize();
                this.generateEnvironment();

                // Reset the initiator
                const playerToKeep = this.gameState.players.get(resetInitiatorId);
                if (playerToKeep) {
                    const pos = this.getRandomEmptyPosition();
                    playerToKeep.x = pos.x;
                    playerToKeep.y = pos.y;
                    playerToKeep.maxBombs = 1;
                    playerToKeep.activeBombs = 0;
                    playerToKeep.bombRange = 1;
                    playerToKeep.speedBoosts = 0;
                    playerToKeep.invisibleUntil = 0;
                    playerToKeep.protectedUntil = Date.now() + 2000;
                    playerToKeep.lives = 0;
                    playerToKeep.alive = true;
                    playerToKeep.killedBy = null;
                    playerToKeep.currentDirection = null;
                    playerToKeep.lastMoveTime = Date.now();
                    playerToKeep.lastActivityTime = Date.now();
                }

                // Clear game state
                this.gameState.bombs = [];
                this.gameState.explosions = [];
                this.gameState.bombPickups = [];
                this.gameState.powerups = [];
                this.gameState.winnerId = null;
                this.bombLookup.clear();

                // Respawn initial bomb pickups
                this.spawnInitialBombPickups();

                this.broadcastGameState();
            });

            // Handle restart request
            socket.on('requestRestart', () => {
                if (this.gameState.winnerId) {
                    console.log(`Bomberman restart requested by ${socket.id}`);

                    // Update grid size and then regenerate environment
                    this.updateGridSize();
                    this.generateEnvironment();

                    this.gameState.winnerId = null;
                    this.gameState.bombs = [];
                    this.gameState.explosions = [];
                    this.gameState.bombPickups = [];
                    this.gameState.powerups = [];
                    this.gameState.lavaTiles = [];
                    this.bombLookup.clear();

                    // Reset all players
                    this.gameState.players.forEach((player) => {
                        const pos = this.getRandomEmptyPosition();
                        player.x = pos.x;
                        player.y = pos.y;
                        player.maxBombs = 1;
                        player.activeBombs = 0;
                        player.bombRange = 1;
                        player.speedBoosts = 0;
                        player.invisibleUntil = 0;
                        player.protectedUntil = Date.now() + 2000;
                        player.lives = 0;
                        player.alive = true;
                        player.killedBy = null;
                        player.currentDirection = null;
                        player.lastMoveTime = Date.now();
                        player.lastActivityTime = Date.now();
                    });

                    // Respawn initial bomb pickups for the new round
                    this.spawnInitialBombPickups();

                    this.broadcastGameState();
                }
            });

            // Handle disconnection
            socket.on('disconnect', () => {
                console.log('Bomberman player disconnected:', socket.id);
                this.handleDisconnect(socket.id);
                socket.removeAllListeners();
            });
        });
    }
}

module.exports = BombermanGame;
