let scl = 32; // Tile size
let socket;
let playerId;
let players = new Map(); // Map of playerId -> player data
let bombPickups = []; // Bomb pickups on the map
let powerups = []; // Flame powerups on the map
let bombs = []; // Active bombs
let explosions = []; // Active explosions
let indestructibleWalls = []; // Permanent walls
let destructibleWalls = []; // Destructible walls
let winnerId = null;
let winnerDetectedTime = null;
let winDelaySeconds = 3;
let keysPressed = {}; // Track which keys are currently pressed
let directionKeys = []; // Track order of pressed direction keys

// Variable for player color
let myColor = null;

// Player character sprites
let characterSprites = [];
const characterFiles = [
    'npc_knight_blue.png',
    'npc_knight_yellow.png',
    'npc_knight_green.png',
    'npc_mage.png',
    'npc_sage.png',
    'npc_merchant.png',
    'npc_merchant_2.png',
    'npc_wrestler.png',
    'monster_dark_knight.png',
    'monster_orc_armored.png',
    'monster_skelet.png',
    'monster_zombie_small.png',
    'monster_imp.png',
    'monster_bies.png',
    'monster_rokita.png',
    'monster_demonolog.png',
    'monster_necromancer.png',
    'monster_tentackle.png',
    'monster_elemental_fire_small.png',
    'monster_elemental_air_small.png'
];

// Map player IDs to character indices
let playerCharacterMap = new Map();
let nextCharacterIndex = 0;

// Wall sprites
let boxSprite = null; // Destructible wall
let wallCenterSprite = null; // Indestructible wall
let bombSprite = null; // Bomb

// Floor assets
let floorImages = [];
const floorFiles = [
    'floor_light.png',
    'floor_mud_e.png', 'floor_mud_mid_1.png', 'floor_mud_mid_2.png',
    'floor_mud_n_1.png', 'floor_mud_n_2.png', 'floor_mud_ne.png',
    'floor_mud_nw.png', 'floor_mud_s_1.png', 'floor_mud_s_2.png',
    'floor_mud_se.png', 'floor_mud_sw.png', 'floor_mud_w.png'
];
let floorGrid = [];

const serverMoveInterval = 195; // Matches server's moveInterval (30% slower)

function preload() {
    // Load all character sprites
    for (let i = 0; i < characterFiles.length; i++) {
        characterSprites[i] = loadImage('bomberman-assets/characters/' + characterFiles[i]);
    }

    // Load wall and bomb sprites
    boxSprite = loadImage('bomberman-assets/box.png');
    wallCenterSprite = loadImage('bomberman-assets/wall_center.png');
    bombSprite = loadImage('bomberman-assets/weapon_bomb.png');

    // Load floor sprites
    for (let i = 0; i < floorFiles.length; i++) {
        floorImages[i] = loadImage('bomberman-assets/floor/' + floorFiles[i]);
    }
}

function setup() {
    const canvas = createCanvas(960, 800); // 20% wider
    canvas.parent('game-container');
    frameRate(30);

    // Connect to Socket.io server
    socket = io('/bomberman');

    socket.on('connect', () => {
        console.log('Connected to Bomberman server');
        myColor = null;
        // Hide color display on reconnect
        const yourColorDiv = document.getElementById('your-color');
        if (yourColorDiv) yourColorDiv.style.display = 'none';
    });

    // Listen for player color assignment
    socket.on('playerColor', (color) => {
        myColor = color;
        console.log(`Your color is: ${myColor}`);

        // Update the color display in the left panel
        const colorDisplay = document.getElementById('color-display');
        const yourColorDiv = document.getElementById('your-color');
        if (colorDisplay && yourColorDiv) {
            colorDisplay.style.backgroundColor = color;
            yourColorDiv.style.display = 'block';
        }
    });

    socket.on('init', (data) => {
        playerId = data.playerId;
        // Initialize all players
        data.gameState.players.forEach(player => {
            // Initialize smooth animation properties
            player.renderX = player.x;
            player.renderY = player.y;
            player.targetX = player.x;
            player.targetY = player.y;
            player.moveStartTime = Date.now();
            players.set(player.id, player);
        });
        bombPickups = data.gameState.bombPickups || [];
        powerups = data.gameState.powerups || [];
        bombs = data.gameState.bombs || [];
        explosions = data.gameState.explosions || [];
        indestructibleWalls = data.gameState.indestructibleWalls || [];
        destructibleWalls = data.gameState.destructibleWalls || [];

        // Set canvas size from server
        if (data.gameState.width && data.gameState.height) {
            if (width !== data.gameState.width || height !== data.gameState.height) {
                resizeCanvas(data.gameState.width, data.gameState.height);
            }
        }
    });

    socket.on('gameState', (state) => {
        // Update all players
        const currentIds = new Set();
        state.players.forEach(serverPlayer => {
            currentIds.add(serverPlayer.id);
            if (players.has(serverPlayer.id)) {
                // Update existing player
                const localPlayer = players.get(serverPlayer.id);

                // Initialize animation properties if needed
                if (localPlayer.renderX === undefined) {
                    localPlayer.renderX = serverPlayer.x;
                    localPlayer.renderY = serverPlayer.y;
                }

                // Check if position changed (player moved to new tile)
                if (localPlayer.targetX !== serverPlayer.x || localPlayer.targetY !== serverPlayer.y) {
                    // Set current render position as starting point
                    localPlayer.startX = localPlayer.renderX;
                    localPlayer.startY = localPlayer.renderY;
                    // Set new target
                    localPlayer.targetX = serverPlayer.x;
                    localPlayer.targetY = serverPlayer.y;
                    localPlayer.moveStartTime = Date.now();
                }

                // Update other properties
                localPlayer.color = serverPlayer.color;
                localPlayer.alive = serverPlayer.alive;
                localPlayer.activeBombs = serverPlayer.activeBombs;
                localPlayer.maxBombs = serverPlayer.maxBombs;
                localPlayer.bombRange = serverPlayer.bombRange;
                localPlayer.speedBoosts = serverPlayer.speedBoosts;
                localPlayer.invisibleUntil = serverPlayer.invisibleUntil;
                localPlayer.isMoving = serverPlayer.isMoving;

            } else {
                // New player
                serverPlayer.renderX = serverPlayer.x;
                serverPlayer.renderY = serverPlayer.y;
                serverPlayer.targetX = serverPlayer.x;
                serverPlayer.targetY = serverPlayer.y;
                serverPlayer.startX = serverPlayer.x;
                serverPlayer.startY = serverPlayer.y;
                serverPlayer.moveStartTime = Date.now();
                players.set(serverPlayer.id, serverPlayer);
            }
        });

        // Remove disconnected players
        for (const [id] of players) {
            if (!currentIds.has(id)) {
                players.delete(id);
            }
        }

        bombPickups = state.bombPickups || [];
        powerups = state.powerups || [];
        bombs = state.bombs || [];
        explosions = state.explosions || [];
        indestructibleWalls = state.indestructibleWalls || [];
        destructibleWalls = state.destructibleWalls || [];

        // Update canvas size if grid dimensions changed
        if (state.width && state.height) {
            if (width !== state.width || height !== state.height) {
                resizeCanvas(state.width, state.height);
                generateFloorGrid(); // Regenerate floor on resize
            }
        }

        // Check if this is the first time we're detecting a winner
        if (state.winnerId && !winnerId) {
            winnerDetectedTime = Date.now();
        }

        // Reset winner tracking when game restarts
        if (!state.winnerId && winnerId) {
            winnerDetectedTime = null;
        }

        winnerId = state.winnerId;
    });

    socket.on('playerLeft', (id) => {
        players.delete(id);
        playerCharacterMap.delete(id);
    });

    socket.on('playerJoined', (data) => {
        if (data.playerId !== playerId) {
            // Initialize smooth animation properties
            data.playerData.renderX = data.playerData.x;
            data.playerData.renderY = data.playerData.y;
            data.playerData.targetX = data.playerData.x;
            data.playerData.targetY = data.playerData.y;
            data.playerData.startX = data.playerData.x;
            data.playerData.startY = data.playerData.y;
            data.playerData.moveStartTime = Date.now();
            players.set(data.playerId, data.playerData);
        }
    });

    // Sound effect listeners
    // socket.on('playEatSound', () => {
    //     const eatSound = document.getElementById('eatSound');
    //     if (eatSound) {
    //         eatSound.currentTime = 0;
    //         eatSound.play().catch(e => console.error("Error playing eat sound:", e));
    //     }
    // });

    socket.on('playDieSound', () => {
        const dieSound = document.getElementById('dieSound');
        if (dieSound) {
            dieSound.currentTime = 0;
            dieSound.play().catch(e => console.error("Error playing die sound:", e));
        }
    });

    // socket.on('playNewSound', () => {
    //     const newSound = document.getElementById('newSound');
    //     if (newSound) {
    //         newSound.currentTime = 0;
    //         newSound.play().catch(e => console.error("Error playing new sound:", e));
    //     }
    // });

    socket.on('playWinSound', () => {
        const winSound = document.getElementById('winSound');
        if (winSound) {
            winSound.currentTime = 0;
            winSound.play().catch(e => console.error("Error playing win sound:", e));
        }
    });

    // Reset button listener
    const resetButton = document.getElementById('resetButton');
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            if (socket && playerId) {
                socket.emit('resetGame');
            }
        });
    }

    // Music toggle listener
    const toggleMusicButton = document.getElementById('toggleMusicButton');
    const backgroundMusic = document.getElementById('backgroundMusic');

    if (toggleMusicButton && backgroundMusic) {
        let isMusicPlaying = false; // Music off by default
        toggleMusicButton.textContent = 'Play Music';

        // No initial play, music starts paused

        toggleMusicButton.addEventListener('click', () => {
            if (isMusicPlaying) {
                backgroundMusic.pause();
                toggleMusicButton.textContent = 'Play Music';
            } else {
                backgroundMusic.play().catch(error => {
                    console.error("Error playing music:", error);
                });
                toggleMusicButton.textContent = 'Pause Music';
            }
            isMusicPlaying = !isMusicPlaying;
        });
    }
}

function draw() {
    // Draw floor
    drawFloor();

    // Draw walls
    drawWalls();

    // Draw bomb pickups
    drawBombPickups();

    // Draw powerups
    drawPowerups();

    // Draw explosions (behind players)
    drawExplosions();

    // Draw bombs
    drawBombs();

    // Draw all players
    drawPlayers();

    // Draw UI
    drawUI();

    // Draw winner message if applicable
    if (winnerId) {
        drawWinnerMessage();
    }
}

function generateFloorGrid() {
    const cols = ceil(width / scl);
    const rows = ceil(height / scl);
    floorGrid = [];
    for (let x = 0; x < cols; x++) {
        floorGrid[x] = [];
        for (let y = 0; y < rows; y++) {
            // Weighted random: 80% light floor, 20% others
            let r = random(1);
            let index = 0;
            if (r > 0.8) {
                index = floor(random(1, floorImages.length));
            }
            floorGrid[x][y] = index;
        }
    }
}

function drawFloor() {
    if (floorGrid.length === 0 || floorGrid.length !== ceil(width / scl) || (floorGrid[0] && floorGrid[0].length !== ceil(height / scl))) {
        generateFloorGrid();
    }

    for (let x = 0; x < floorGrid.length; x++) {
        for (let y = 0; y < floorGrid[x].length; y++) {
            let imgIndex = floorGrid[x][y];
            if (floorImages[imgIndex]) {
                image(floorImages[imgIndex], x * scl, y * scl, scl, scl);
            }
        }
    }
}

function drawWalls() {
    // Draw indestructible walls
    if (wallCenterSprite) {
        indestructibleWalls.forEach(wall => {
            image(wallCenterSprite, wall.x, wall.y, scl, scl);
        });
    } else {
        // Fallback: Draw as dark gray
        fill(80, 80, 80);
        noStroke();
        indestructibleWalls.forEach(wall => {
            rect(wall.x, wall.y, scl, scl);
        });
    }

    // Draw destructible walls
    if (boxSprite) {
        destructibleWalls.forEach(wall => {
            image(boxSprite, wall.x, wall.y, scl, scl);
        });
    } else {
        // Fallback: Draw as brown
        fill(139, 90, 43);
        noStroke();
        destructibleWalls.forEach(wall => {
            rect(wall.x, wall.y, scl, scl);

            // Add texture lines
            stroke(100, 60, 30);
            strokeWeight(2);
            line(wall.x, wall.y + scl/3, wall.x + scl, wall.y + scl/3);
            line(wall.x, wall.y + 2*scl/3, wall.x + scl, wall.y + 2*scl/3);
        });
    }
}

function drawBombPickups() {
    fill(255, 215, 0); // Gold
    noStroke();

    bombPickups.forEach(pickup => {
        // Draw as a circle in the center of the tile
        ellipse(pickup.x + scl/2, pickup.y + scl/2, scl * 0.6, scl * 0.6);

        // Draw a small "B" for bomb
        fill(0);
        textSize(20);
        textAlign(CENTER, CENTER);
        text("B", pickup.x + scl/2, pickup.y + scl/2);
        fill(255, 215, 0);
    });
}

function drawPowerups() {
    powerups.forEach(powerup => {
        if (powerup.type === 'flame') {
            // Draw flame powerup as a red/orange circle
            fill(255, 69, 0); // Red-orange
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw a flame symbol (F)
            fill(255, 255, 0); // Yellow text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("F", powerup.x + scl/2, powerup.y + scl/2);
        } else if (powerup.type === 'speed') {
            // Draw speed powerup as a cyan circle
            fill(0, 255, 255); // Cyan
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw a speed symbol (S)
            fill(0, 0, 0); // Black text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("S", powerup.x + scl/2, powerup.y + scl/2);
        } else if (powerup.type === 'invisibility') {
            // Draw invisibility powerup as a purple circle with glow
            fill(138, 43, 226); // Purple
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw an invisibility symbol (I)
            fill(255, 255, 255); // White text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("I", powerup.x + scl/2, powerup.y + scl/2);
        }
    });
}

function drawBombs() {
    if (bombSprite) {
        bombs.forEach(bomb => {
            image(bombSprite, bomb.x, bomb.y, scl, scl);
        });
    } else {
        // Fallback: Draw as black circle
        bombs.forEach(bomb => {
            fill(0);
            noStroke();
            ellipse(bomb.x + scl/2, bomb.y + scl/2, scl * 0.7, scl * 0.7);
        });
    }
}

function drawExplosions() {
    fill(255, 100, 0, 180); // Orange with transparency
    noStroke();

    explosions.forEach(explosion => {
        rect(explosion.x, explosion.y, scl, scl);
    });
}

function updateAvatarDisplay() {
    // Update the avatar display canvas with the player's character
    if (!playerId || !playerCharacterMap.has(playerId)) return;

    const characterIndex = playerCharacterMap.get(playerId);
    const sprite = characterSprites[characterIndex];

    if (!sprite) return;

    const avatarCanvas = document.getElementById('avatar-display');
    const yourColorDiv = document.getElementById('your-color');

    if (avatarCanvas && yourColorDiv) {
        const ctx = avatarCanvas.getContext('2d');
        // Clear the canvas
        ctx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
        // Draw the character sprite scaled to 64x64
        ctx.imageSmoothingEnabled = false; // Pixelated rendering
        ctx.drawImage(sprite.canvas, 0, 0, 64, 64);
        // Show the avatar display
        yourColorDiv.style.display = 'block';
    }
}

function drawPlayers() {
    const now = Date.now();
    const animationDuration = serverMoveInterval; // Match server's move interval (150ms)

    players.forEach((player, id) => {
        if (!player || !player.alive || !player.color) return;

        // Assign character sprite to new players
        if (!playerCharacterMap.has(id)) {
            playerCharacterMap.set(id, nextCharacterIndex % characterSprites.length);
            nextCharacterIndex++;

            // Update avatar display if this is the local player
            if (id === playerId) {
                updateAvatarDisplay();
            }
        }

        // Calculate smooth interpolation from start to target position
        const elapsed = now - player.moveStartTime;
        const t = Math.min(elapsed / animationDuration, 1.0); // Clamp to 1.0

        // Use easeOutCubic for smooth deceleration
        const eased = 1 - Math.pow(1 - t, 3);

        // Interpolate between start and target
        player.renderX = lerp(player.startX || player.targetX, player.targetX, eased);
        player.renderY = lerp(player.startY || player.targetY, player.targetY, eased);

        // Get the character sprite for this player
        const characterIndex = playerCharacterMap.get(id);
        const sprite = characterSprites[characterIndex];

        if (sprite) {
            // Draw character sprite (16x16 scaled to 32x32)
            image(sprite, player.renderX, player.renderY, scl, scl);
        } else {
            // Fallback: Draw player as a colored square
            fill(player.color);
            noStroke();
            rect(player.renderX, player.renderY, scl, scl);

            // Draw a face or indicator
            fill(255);
            ellipse(player.renderX + scl * 0.35, player.renderY + scl * 0.35, scl * 0.15, scl * 0.15);
            ellipse(player.renderX + scl * 0.65, player.renderY + scl * 0.35, scl * 0.15, scl * 0.15);
        }
    });
}

function drawUI() {
    // Update HTML elements instead of drawing on canvas
    const alivePlayers = Array.from(players.values()).filter(p => p.alive).length;
    const playersAliveElement = document.getElementById('players-alive');
    if (playersAliveElement) {
        playersAliveElement.textContent = `${alivePlayers} Alive`;
    }

    // Update invisibility status
    const invisibilityStatus = document.getElementById('invisibility-status');
    if (invisibilityStatus && players.has(playerId)) {
        const myPlayer = players.get(playerId);
        const now = Date.now();
        const isInvisible = myPlayer.invisibleUntil && myPlayer.invisibleUntil > now;

        if (isInvisible) {
            invisibilityStatus.style.display = 'block';
        } else {
            invisibilityStatus.style.display = 'none';
        }
    }
}

function drawWinnerMessage() {
    const winner = players.get(winnerId);
    const winnerName = winnerId === playerId ? "You" : `Player ${winnerId.substring(0, 6)}...`;
    const message = winner ? `${winnerName} wins!` : "Game Over!";

    fill(0, 0, 0, 150);
    rect(0, height / 2 - 50, width, 100);

    fill(255);
    textSize(32);
    textAlign(CENTER, CENTER);
    text(message, width / 2, height / 2 - 10);

    textSize(16);
    if (winnerDetectedTime) {
        const elapsedTime = (Date.now() - winnerDetectedTime) / 1000;
        const remainingTime = Math.max(0, winDelaySeconds - elapsedTime);

        if (remainingTime > 0) {
            text(`Next game starts in ${Math.ceil(remainingTime)} seconds...`, width / 2, height / 2 + 30);
        } else {
            text("Press any key to restart", width / 2, height / 2 + 30);
        }
    } else {
        text("Press any key to restart", width / 2, height / 2 + 30);
    }
}

function keyPressed() {
    // Prevent default for arrow keys to disable scrolling
    if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, 32].includes(keyCode)) {
        event.preventDefault();
    }

    // Handle restart if there's a winner
    if (winnerId) {
        if (winnerDetectedTime) {
            const elapsedTime = (Date.now() - winnerDetectedTime) / 1000;
            if (elapsedTime >= winDelaySeconds) {
                socket.emit('requestRestart');
                winnerDetectedTime = null;
            }
        } else {
            socket.emit('requestRestart');
        }
        return false;
    }

    if (!players.has(playerId)) return false;

    const localPlayer = players.get(playerId);
    if (!localPlayer.alive) return false;

    // Track key press
    keysPressed[keyCode] = true;

    // Handle space bar for bombs (separate from directional keys)
    if (key === ' ' || keyCode === 32) {
        socket.emit('placeBomb');
        return false;
    }

    // Movement with arrow keys
    let direction = null;
    if (keyCode === UP_ARROW) {
        direction = { x: 0, y: -1 };
    } else if (keyCode === DOWN_ARROW) {
        direction = { x: 0, y: 1 };
    } else if (keyCode === LEFT_ARROW) {
        direction = { x: -1, y: 0 };
    } else if (keyCode === RIGHT_ARROW) {
        direction = { x: 1, y: 0 };
    }

    // If a direction key was pressed, add it to the array if not already there
    if (direction) {
        // Remove this key if it's already in the array (to update its position)
        directionKeys = directionKeys.filter(k => k.keyCode !== keyCode);
        // Add to the end (most recent)
        directionKeys.push({ keyCode, direction });
        // Emit moveStart with the most recent direction
        socket.emit('moveStart', direction);
    }

    return false; // Prevent default behavior
}

function keyReleased() {
    // Prevent default for arrow keys
    if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, 32].includes(keyCode)) {
        event.preventDefault();
    }

    if (!players.has(playerId)) return false;

    const localPlayer = players.get(playerId);
    if (!localPlayer || !localPlayer.alive) return false;

    // Remove key from tracking
    keysPressed[keyCode] = false;

    // Remove this key from directionKeys array
    directionKeys = directionKeys.filter(k => k.keyCode !== keyCode);

    // If there are still direction keys pressed, switch to the most recent one
    if (directionKeys.length > 0) {
        const mostRecent = directionKeys[directionKeys.length - 1];
        socket.emit('moveStart', mostRecent.direction);
    } else {
        // No direction keys pressed, stop movement
        socket.emit('moveStop');
    }

    return false; // Prevent default behavior
}
