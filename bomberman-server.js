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
        this.gameState = {
            players: new Map(),
            bombPickups: [],
            powerups: [], // Flame powerups
            bombs: [],
            explosions: [],
            indestructibleWalls: [], // Permanent walls
            destructibleWalls: [], // Walls that can be destroyed
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
            invisibilityDuration: 10000, // 10 seconds
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
                        this.gameState.indestructibleWalls.push({
                            x: col * scale,
                            y: row * scale
                        });
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
                    this.gameState.destructibleWalls.push({
                        x: col * scale,
                        y: 2 * scale,
                        hasHiddenBomb: false
                    });
                }
            }
            // Bottom pocket walls (skip middle spawn point area)
            if (col < Math.floor(cols / 2) - 2 || col > Math.floor(cols / 2) + 2) {
                if (!isInSafeZone(col, rows - 3)) {
                    this.gameState.destructibleWalls.push({
                        x: col * scale,
                        y: (rows - 3) * scale,
                        hasHiddenBomb: false
                    });
                }
            }
        }

        // Left and right edge pockets
        for (let row = pocketWallDistance; row < rows - pocketWallDistance; row += 2) {
            // Left pocket walls (skip middle spawn point area)
            if (row < Math.floor(rows / 2) - 2 || row > Math.floor(rows / 2) + 2) {
                if (!isInSafeZone(2, row)) {
                    this.gameState.destructibleWalls.push({
                        x: 2 * scale,
                        y: row * scale,
                        hasHiddenBomb: false
                    });
                }
            }
            // Right pocket walls (skip middle spawn point area)
            if (row < Math.floor(rows / 2) - 2 || row > Math.floor(rows / 2) + 2) {
                if (!isInSafeZone(cols - 3, row)) {
                    this.gameState.destructibleWalls.push({
                        x: (cols - 3) * scale,
                        y: row * scale,
                        hasHiddenBomb: false
                    });
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

            // Check if position has a bomb pickup
            if (!occupied && this.gameState.bombPickups.some(p => p.x === x && p.y === y)) {
                occupied = true;
            }

            // Check if position has a bomb
            if (!occupied && this.gameState.bombs.some(b => b.x === x && b.y === y)) {
                occupied = true;
            }

            // Check if position has an indestructible wall
            if (!occupied && this.gameState.indestructibleWalls.some(w => w.x === x && w.y === y)) {
                occupied = true;
            }

            // Check if position has a destructible wall
            if (!occupied && this.gameState.destructibleWalls.some(w => w.x === x && w.y === y)) {
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
            const hitBombs = this.createExplosion(bomb.x, bomb.y, wallsToDestroy, range);
            
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
            this.gameState.bombs = this.gameState.bombs.filter(bomb => !bombsToExplode.has(bomb));
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
                    // Random chance to spawn powerups (check in order: invisibility, flame, speed)
                    else {
                        const roll = Math.random();
                        if (roll < this.gameState.invisibilityPowerupChance) {
                            this.gameState.powerups.push({
                                x: wall.x,
                                y: wall.y,
                                type: 'invisibility' // Makes player invisible for 10 seconds
                            });
                        } else if (roll < this.gameState.invisibilityPowerupChance + this.gameState.flamePowerupChance) {
                            this.gameState.powerups.push({
                                x: wall.x,
                                y: wall.y,
                                type: 'flame' // Increases bomb explosion range
                            });
                        } else if (roll < this.gameState.invisibilityPowerupChance + this.gameState.flamePowerupChance + this.gameState.speedPowerupChance) {
                            this.gameState.powerups.push({
                                x: wall.x,
                                y: wall.y,
                                type: 'speed' // Increases movement speed by 10%
                            });
                        }
                    }
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

                    // Check collision with indestructible walls
                    if (!collision && this.gameState.indestructibleWalls.some(w => w.x === newX && w.y === newY)) {
                        collision = true;
                    }

                    // Check collision with destructible walls
                    if (!collision && this.gameState.destructibleWalls.some(w => w.x === newX && w.y === newY)) {
                        collision = true;
                    }

                    // Check collision with bombs
                    // Solid Bomb Rule: Can walk off a bomb, but cannot walk onto it
                    if (!collision) {
                        const bombAtTarget = this.gameState.bombs.find(b => b.x === newX && b.y === newY);
                        if (bombAtTarget) {
                            // There is a bomb at the target tile.
                            // Only allow movement if the player is currently standing on that same bomb (walking off it).
                            // If the player is NOT currently on that bomb, it's a collision (blocked).
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

                            // Emit sound effect
                            const playerSocket = this.io.of('/bomberman').sockets.get(playerId);
                            if (playerSocket) playerSocket.emit('playEatSound');
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
                            }
                            this.gameState.powerups.splice(powerupIndex, 1);

                            // Emit sound effect
                            const playerSocket = this.io.of('/bomberman').sockets.get(playerId);
                            if (playerSocket) playerSocket.emit('playEatSound');
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
                    player.alive = false;

                    // Emit death sound (disabled)
                    // const playerSocket = this.io.of('/bomberman').sockets.get(playerId);
                    // if (playerSocket) playerSocket.emit('playDieSound');
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

                // Auto-restart after 3 seconds
                setTimeout(() => {
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

    createExplosion(centerX, centerY, wallsToDestroy, bombRange) {
        const explosionTiles = [];
        const scale = this.gameState.scale;
        const bombsToChainExplode = []; // Track bombs hit by this explosion

        // Center tile always explodes
        explosionTiles.push({ x: centerX, y: centerY });

        // Check if center destroys a destructible wall
        // Use logic similar to checkAndDestroyWall but adding to Set
        const centerWallIndex = this.gameState.destructibleWalls.findIndex(
            w => w.x === centerX && w.y === centerY
        );
        if (centerWallIndex !== -1) {
             wallsToDestroy.add(`${centerX},${centerY}`);
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
                    break; // Stop this direction
                }

                // Check for indestructible wall - explosion stops
                const hasIndestructible = this.gameState.indestructibleWalls.some(
                    w => w.x === x && w.y === y
                );
                if (hasIndestructible) {
                    break; // Stop this direction
                }

                // Check for destructible wall
                const destructibleIndex = this.gameState.destructibleWalls.findIndex(
                    w => w.x === x && w.y === y
                );

                if (destructibleIndex !== -1) {
                    // Add explosion at this tile
                    explosionTiles.push({ x, y });

                    // Mark wall for destruction
                    wallsToDestroy.add(`${x},${y}`);

                    break; // Stop this direction after hitting destructible wall
                }

                // No wall, explosion continues
                explosionTiles.push({ x, y });
            }
        });

        // Add explosions with timestamp
        const now = Date.now();
        explosionTiles.forEach(tile => {
            this.gameState.explosions.push({
                x: tile.x,
                y: tile.y,
                createdTime: now
            });

            // Check if there's a bomb at this explosion tile
            const bombIndex = this.gameState.bombs.findIndex(
                b => b.x === tile.x && b.y === tile.y
            );
            if (bombIndex !== -1) {
                bombsToChainExplode.push(this.gameState.bombs[bombIndex]);
            }
        });

        // Return the list of bombs hit by this explosion
        // The chain reaction is handled iteratively in updateGameState
        return bombsToChainExplode;
    }

    restartGame() {
        console.log('Restarting game...');

        // Reset winner
        this.gameState.winnerId = null;

        // Clear game objects
        this.gameState.bombs = [];
        this.gameState.explosions = [];
        this.gameState.bombPickups = [];
        this.gameState.powerups = [];

        // Regenerate environment (walls)
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
            player.alive = true;
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

        // Send customized state to each player (for invisibility)
        this.gameState.players.forEach((_, socketId) => {
            const socket = this.io.of('/bomberman').sockets.get(socketId);
            if (!socket) return;

            // Filter players: show all players except invisible ones (unless it's the invisible player viewing)
            const visiblePlayers = Array.from(this.gameState.players.entries())
                .filter(([id, p]) => {
                    // Always show yourself
                    if (id === socketId) return true;
                    // Show others only if they're not invisible
                    return !p.invisibleUntil || p.invisibleUntil <= now;
                })
                .map(([id, p]) => ({
                    id,
                    x: p.x,
                    y: p.y,
                    color: p.color,
                    maxBombs: p.maxBombs,
                    activeBombs: p.activeBombs,
                    bombRange: p.bombRange,
                    speedBoosts: p.speedBoosts,
                    invisibleUntil: p.invisibleUntil,
                    alive: p.alive,
                    lastMoveTime: p.lastMoveTime,
                    isMoving: !!p.currentDirection
                }));

            const state = {
                players: visiblePlayers,
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
                winnerId: this.gameState.winnerId,
                width: this.gameState.width,
                height: this.gameState.height,
                timestamp: now
            };

            socket.emit('gameState', state);
        });
    }

    handleDisconnect(playerId) {
        console.log(`Disconnecting Bomberman player ${playerId}...`);
        const player = this.gameState.players.get(playerId);
        if (player) {
            // Save player state for reconnection
            const persistentId = this.socketToPersistentId.get(playerId);
            if (persistentId) {
                console.log(`Saving player state for ${persistentId}`);
                this.persistentPlayers.set(persistentId, {
                    ...player,
                    disconnectedAt: Date.now()
                });

                // Clean up after 5 minutes
                setTimeout(() => {
                    const savedPlayer = this.persistentPlayers.get(persistentId);
                    if (savedPlayer && savedPlayer.disconnectedAt) {
                        console.log(`Removing saved state for ${persistentId} after timeout`);
                        this.persistentPlayers.delete(persistentId);
                        this.gameState.usedColors.delete(savedPlayer.color);
                    }
                }, 5 * 60 * 1000); // 5 minutes

                this.socketToPersistentId.delete(playerId);
            } else {
                // No persistent ID, release color immediately
                this.gameState.usedColors.delete(player.color);
            }

            this.gameState.players.delete(playerId);
            this.io.of('/bomberman').emit('playerLeft', playerId);
        }
    }

    startGameLoop() {
        setInterval(() => {
            this.updateGameState();
            this.broadcastGameState();
        }, this.gameState.updateInterval);
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
                    this.handleDisconnect(playerId);
                }
            });
        }, 5000); // Check every 5 seconds
    }

    setupNamespace() {
        const bombermanNamespace = this.io.of('/bomberman');

        bombermanNamespace.on('connection', (socket) => {
            console.log('New Bomberman player connected:', socket.id);

            let playerCreated = false;

            // Handle reconnection
            socket.on('reconnect_player', (persistentId) => {
                if (playerCreated) return; // Already created player for this socket

                console.log(`Reconnect request from ${socket.id} with persistentId: ${persistentId}`);

                // Check if we have saved data for this persistent ID
                const savedPlayer = this.persistentPlayers.get(persistentId);

                if (savedPlayer && savedPlayer.alive) {
                    // Restore the player
                    console.log(`Restoring player ${persistentId} at position (${savedPlayer.x}, ${savedPlayer.y})`);

                    // Update the socket mapping
                    this.socketToPersistentId.set(socket.id, persistentId);

                    // Restore player with new socket ID
                    const restoredPlayer = {
                        ...savedPlayer,
                        lastActivityTime: Date.now()
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
                        maxBombs: 1,
                        activeBombs: 0,
                        bombRange: 1,
                        speedBoosts: 0,
                        invisibleUntil: 0,
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
                            maxBombs: player.maxBombs,
                            activeBombs: player.activeBombs,
                            bombRange: player.bombRange,
                            speedBoosts: player.speedBoosts,
                            invisibleUntil: player.invisibleUntil,
                            alive: player.alive
                        })),
                        bombPickups: this.gameState.bombPickups,
                        powerups: this.gameState.powerups,
                        bombs: this.gameState.bombs,
                        explosions: this.gameState.explosions,
                        indestructibleWalls: this.gameState.indestructibleWalls,
                        destructibleWalls: this.gameState.destructibleWalls.map(w => ({ x: w.x, y: w.y })),
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

            // Handle movement start
            socket.on('moveStart', (direction) => {
                const player = this.gameState.players.get(socket.id);
                if (player && player.alive) {
                    player.lastActivityTime = Date.now();
                    player.currentDirection = direction;
                    // Reset move timer to allow immediate direction change
                    player.lastMoveTime = Date.now() - this.gameState.moveInterval;
                }
            });

            // Handle movement stop
            socket.on('moveStop', () => {
                const player = this.gameState.players.get(socket.id);
                if (player) {
                    player.lastActivityTime = Date.now();
                    player.currentDirection = null;
                }
            });

            // Handle bomb placement
            socket.on('placeBomb', () => {
                const player = this.gameState.players.get(socket.id);
                if (player && player.alive && player.activeBombs < player.maxBombs) {
                    player.lastActivityTime = Date.now();

                    // Check if there's already a bomb at this position
                    const bombExists = this.gameState.bombs.some(
                        b => b.x === player.x && b.y === player.y
                    );

                    if (!bombExists) {
                        this.gameState.bombs.push({
                            x: player.x,
                            y: player.y,
                            placedTime: Date.now(),
                            playerId: socket.id
                        });

                        player.activeBombs++; // Increment active bomb count
                        player.lastBombPlacedTime = Date.now(); // Track when bomb was placed
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
                    playerToKeep.alive = true;
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
                        player.alive = true;
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
            });
        });
    }
}

module.exports = BombermanGame;
