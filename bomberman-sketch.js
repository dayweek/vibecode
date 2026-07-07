// ── Bomberman client: assets, state sync, rendering and input ──────
// Loaded alongside game-sketch.js (shared globals, p5 global mode).

let scl = 32; // Tile size
let bombPickups = []; // Bomb pickups on the map
let powerups = []; // Flame powerups on the map
let bombs = []; // Active bombs
let explosions = []; // Active explosions
let indestructibleWalls = []; // Permanent walls
let destructibleWalls = []; // Destructible walls
let lavaTiles = []; // Lava hazards
let keysPressed = {}; // Track which keys are currently pressed
let directionKeys = []; // Track order of pressed direction keys

const serverMoveInterval = 195; // Matches server's moveInterval (30% slower)

// Player character sprites (also used for lobby/room-browser avatars)
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
let lavaSprite = null; // Lava tiles

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

// Called from preload() in game-sketch.js
function preloadBombermanAssets() {
    // Load all character sprites
    for (let i = 0; i < characterFiles.length; i++) {
        characterSprites[i] = loadImage('bomberman-assets/characters/' + characterFiles[i]);
    }

    // Load wall and bomb sprites
    boxSprite = loadImage('bomberman-assets/box.png'); // Destructible walls
    wallCenterSprite = loadImage('bomberman-assets/wall_center.png'); // Indestructible walls
    bombSprite = loadImage('bomberman-assets/weapon_bomb.png');
    lavaSprite = loadImage('bomberman-assets/floor/lava.png');

    // Load floor sprites
    for (let i = 0; i < floorFiles.length; i++) {
        floorImages[i] = loadImage('bomberman-assets/floor/' + floorFiles[i]);
    }
}

// Called from room.onStateChange in game-sketch.js
function syncBombermanState(state) {
    bombPickups = schemaArrayToPlain(state.bombPickups, ['x', 'y', 'pickupType']);
    powerups = schemaArrayToPlain(state.powerups, ['x', 'y', 'pickupType']);
    bombs = schemaArrayToPlain(state.bombs, ['x', 'y', 'placedTime', 'playerId', 'fuseTime']);
    explosions = schemaArrayToPlain(state.explosions, ['x', 'y', 'createdTime', 'playerId']);
    indestructibleWalls = schemaArrayToPlain(state.indestructibleWalls, ['x', 'y']);
    destructibleWalls = schemaArrayToPlain(state.destructibleWalls, ['x', 'y']);
    lavaTiles = schemaArrayToPlain(state.lavaTiles, ['x', 'y']);
}

// ── Rendering ───────────────────────────────────────────────────────

function drawBombermanGame() {
    // Draw floor
    drawFloor();

    // Draw walls
    drawWalls();

    // Draw lava tiles
    drawLavaTiles();

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

function drawLavaTiles() {
    lavaTiles.forEach(lava => {
        if (lavaSprite) {
            image(lavaSprite, lava.x, lava.y, scl, scl);
        } else {
            // Fallback: orange-red square
            fill(255, 69, 0);
            noStroke();
            rect(lava.x, lava.y, scl, scl);
        }
    });
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
        if (powerup.pickupType === 'flame') {
            // Draw flame powerup as a red/orange circle
            fill(255, 69, 0); // Red-orange
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw a flame symbol (F)
            fill(255, 255, 0); // Yellow text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("F", powerup.x + scl/2, powerup.y + scl/2);
        } else if (powerup.pickupType === 'speed') {
            // Draw speed powerup as a cyan circle
            fill(0, 255, 255); // Cyan
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw a speed symbol (S)
            fill(0, 0, 0); // Black text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("S", powerup.x + scl/2, powerup.y + scl/2);
        } else if (powerup.pickupType === 'invisibility') {
            // Draw invisibility powerup as a purple circle with glow
            fill(138, 43, 226); // Purple
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw an invisibility symbol (I)
            fill(255, 255, 255); // White text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("I", powerup.x + scl/2, powerup.y + scl/2);
        } else if (powerup.pickupType === 'life') {
            // Draw life powerup as a pink/red circle (heart color)
            fill(255, 20, 147); // Deep pink
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw a life symbol (heart/L)
            fill(255, 255, 255); // White text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("♥", powerup.x + scl/2, powerup.y + scl/2);
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
        // Draw the character sprite scaled to 32x32
        ctx.imageSmoothingEnabled = false; // Pixelated rendering
        ctx.drawImage(sprite.canvas, 0, 0, 32, 32);
        // Show the avatar display
        yourColorDiv.style.display = 'block';
    }
}

// Advance a player's render position toward its server position using a
// velocity model: accelerate when a run starts, cruise at the server's move
// speed across intermediate tiles, and brake to a stop only once the server
// reports the player is no longer moving (i.e. on the final tile).
function updateRenderPosition(player, dt) {
    if (player.renderSpeed === undefined) player.renderSpeed = 0;
    if (!player.waypoints) player.waypoints = [];

    // Remaining distance along the tile-by-tile waypoint path (segments are
    // axis-aligned, so Manhattan distance equals the path length)
    let dist = 0;
    let px = player.renderX;
    let py = player.renderY;
    for (const w of player.waypoints) {
        dist += Math.abs(w.x - px) + Math.abs(w.y - py);
        px = w.x;
        py = w.y;
    }

    // Fell too far behind (e.g. tab was inactive): fast-forward to the end
    if (dist > scl * 3) {
        player.waypoints = [];
        player.renderX = player.targetX;
        player.renderY = player.targetY;
        player.renderSpeed = 0;
        return;
    }

    if (dist < 0.01) {
        player.renderX = player.targetX;
        player.renderY = player.targetY;
        player.waypoints = [];
        // Keep momentum between tiles while the run continues so mid-run
        // patch jitter doesn't re-trigger acceleration on every tile
        if (!player.isMoving) player.renderSpeed = 0;
        return;
    }

    // Speed boosts shorten the server's move interval; match it so the
    // renderer keeps pace with boosted players
    const moveInterval = serverMoveInterval * Math.pow(0.9, player.speedBoosts || 0);
    const cruiseSpeed = scl / moveInterval; // px per ms
    const accel = cruiseSpeed / 150; // reach cruise speed in ~150ms
    const brakeDecel = (cruiseSpeed * cruiseSpeed) / scl; // stop over ~half a tile

    let desiredSpeed;
    if (player.isMoving) {
        // Slight overspeed, growing if we fall behind the server, so the
        // render position catches up instead of lagging further
        const catchUp = dist > scl ? 1 + (dist / scl - 1) * 0.5 : 1;
        desiredSpeed = cruiseSpeed * 1.05 * catchUp;
    } else {
        // Run is over: follow a braking curve that comes to rest exactly
        // at the final tile
        desiredSpeed = Math.min(cruiseSpeed * 1.05, Math.sqrt(2 * brakeDecel * dist));
    }

    if (player.renderSpeed < desiredSpeed) {
        player.renderSpeed = Math.min(desiredSpeed, player.renderSpeed + accel * dt);
    } else {
        player.renderSpeed = desiredSpeed;
    }

    // Advance along the waypoint path, turning at tile corners instead of
    // cutting diagonally toward the newest position
    let step = Math.min(dist, player.renderSpeed * dt);
    while (step > 0.0001 && player.waypoints.length > 0) {
        const w = player.waypoints[0];
        const dx = w.x - player.renderX;
        const dy = w.y - player.renderY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= step) {
            player.renderX = w.x;
            player.renderY = w.y;
            step -= d;
            player.waypoints.shift();
        } else {
            player.renderX += (dx / d) * step;
            player.renderY += (dy / d) * step;
            step = 0;
        }
    }
}

let _lastPlayersDrawTime = 0;

function drawPlayers() {
    const now = Date.now();
    // Frame delta in ms, capped so tab-switch stalls don't cause jumps
    const dt = _lastPlayersDrawTime ? Math.min(now - _lastPlayersDrawTime, 50) : 16;
    _lastPlayersDrawTime = now;

    players.forEach((player, id) => {
        if (!player || !player.alive || !player.color) return;

        // Skip invisible players (unless it's the local player)
        if (player.invisible && id !== playerId) return;

        // Assign character sprite to new players
        if (!playerCharacterMap.has(id)) {
            playerCharacterMap.set(id, nextCharacterIndex % characterSprites.length);
            nextCharacterIndex++;

            // Update avatar display if this is the local player
            if (id === playerId) {
                updateAvatarDisplay();
            }
        }

        updateRenderPosition(player, dt);

        // Get the character sprite for this player
        const characterIndex = playerCharacterMap.get(id);
        const sprite = characterSprites[characterIndex];

        // Check for spawn protection
        const isProtected = player.protectedUntil && player.protectedUntil > now;
        const shouldBlink = isProtected && Math.floor(now / 200) % 2 === 0;

        if (sprite) {
            // Draw character sprite (16x16 scaled to 32x32)
            if (shouldBlink) {
                tint(255, 255, 255, 128); // 50% transparency for blink
            }
            image(sprite, player.renderX, player.renderY, scl, scl);
            noTint();
        } else {
            // Fallback: Draw player as a colored square
            if (shouldBlink) {
                // Extract RGB and add alpha for blinking
                const r = red(player.color);
                const g = green(player.color);
                const b = blue(player.color);
                fill(r, g, b, 128);
            } else {
                fill(player.color);
            }
            noStroke();
            rect(player.renderX, player.renderY, scl, scl);

            // Draw a face or indicator
            fill(255);
            ellipse(player.renderX + scl * 0.35, player.renderY + scl * 0.35, scl * 0.15, scl * 0.15);
            ellipse(player.renderX + scl * 0.65, player.renderY + scl * 0.35, scl * 0.15, scl * 0.15);
        }

        // Draw shield indicator for protected players
        if (isProtected) {
            noFill();
            stroke(100, 200, 255, 180);
            strokeWeight(2);
            ellipse(player.renderX + scl/2, player.renderY + scl/2, scl * 1.2, scl * 1.2);
            noStroke();
        }
    });
}

// Cached DOM elements and values for drawUI (avoid querying DOM every frame).
// Also reused by the snake HUD in snake-sketch.js.
let _uiCache = {
    playersAliveEl: null,
    invisibilityEl: null,
    livesCountEl: null,
    lastAlive: -1,
    lastInvisible: null,
    lastLives: -1,
    initialized: false
};

function _initUICache() {
    _uiCache.playersAliveEl = document.getElementById('players-alive');
    _uiCache.invisibilityEl = document.getElementById('invisibility-status');
    _uiCache.livesCountEl = document.getElementById('lives-count');
    _uiCache.initialized = true;
}

function drawUI() {
    if (!_uiCache.initialized) _initUICache();

    // Update players alive (only when changed)
    const alivePlayers = Array.from(players.values()).filter(p => p.alive).length;
    if (_uiCache.playersAliveEl && alivePlayers !== _uiCache.lastAlive) {
        _uiCache.lastAlive = alivePlayers;
        _uiCache.playersAliveEl.textContent = `${alivePlayers} Alive`;
    }

    // Update invisibility status (only when changed)
    if (_uiCache.invisibilityEl && players.has(playerId)) {
        const myPlayer = players.get(playerId);
        const now = Date.now();
        const isInvisible = !!(myPlayer.invisibleUntil && myPlayer.invisibleUntil > now);
        if (isInvisible !== _uiCache.lastInvisible) {
            _uiCache.lastInvisible = isInvisible;
            _uiCache.invisibilityEl.style.display = isInvisible ? 'block' : 'none';
        }
    }

    // Update lives (only when changed)
    if (_uiCache.livesCountEl && players.has(playerId)) {
        const lives = players.get(playerId).lives || 0;
        if (lives !== _uiCache.lastLives) {
            _uiCache.lastLives = lives;
            _uiCache.livesCountEl.textContent = lives;
        }
    }

    // Update active bombs display (only when player is dead)
    updateActiveBombsDisplay();
}

function updateActiveBombsDisplay() {
    const activeBombsDisplay = document.getElementById('active-bombs-display');
    const activeBombsList = document.getElementById('active-bombs-list');

    if (!activeBombsDisplay || !activeBombsList || !players.has(playerId)) {
        return;
    }

    const myPlayer = players.get(playerId);

    // Only show when player is dead
    if (!myPlayer || myPlayer.alive) {
        activeBombsDisplay.style.display = 'none';
        return;
    }

    // Show the display
    activeBombsDisplay.style.display = 'block';

    // Build the death message
    let html = '';

    // Show who killed you (always show something to debug)
    if (myPlayer.killedBy === 'self') {
        html += `<div style="background-color: #550000; padding: 8px 12px; border-radius: 5px; margin-bottom: 10px; border: 2px solid #AA0000; text-align: center;">`;
        html += `<span style="color: #FF6666; font-weight: bold; font-size: 14px;">💥 You killed yourself!</span>`;
        html += `</div>`;
    } else if (myPlayer.killedBy === 'lava') {
        html += `<div style="background-color: #552200; padding: 8px 12px; border-radius: 5px; margin-bottom: 10px; border: 2px solid #FF6600; text-align: center;">`;
        html += `<span style="color: #FF9933; font-weight: bold; font-size: 14px;">🌋 Killed by lava!</span>`;
        html += `</div>`;
    } else if (myPlayer.killedBy) {
        const killer = players.get(myPlayer.killedBy);
        if (killer) {
            const killerName = killer.playerName || `Player ${myPlayer.killedBy.substring(0, 6)}...`;
            const characterIndex = playerCharacterMap.get(myPlayer.killedBy);
            const sprite = characterSprites[characterIndex];

            html += `<div style="background-color: #330033; padding: 8px 12px; border-radius: 5px; margin-bottom: 10px; border: 2px solid #AA00AA; display: flex; align-items: center; gap: 8px; justify-content: center;">`;

            // Add killer's character sprite
            if (sprite) {
                html += `<canvas id="killer-avatar" width="24" height="24" style="image-rendering: pixelated;"></canvas>`;
            }

            html += `<span style="color: #FF66FF; font-weight: bold; font-size: 14px;">💀 Killed by ${killerName}</span>`;
            html += `</div>`;

            // Draw killer sprite after HTML is inserted
            setTimeout(() => {
                const canvas = document.getElementById('killer-avatar');
                if (sprite && canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, 24, 24);
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(sprite.canvas, 0, 0, 24, 24);
                }
            }, 0);
        }
    } else {
        // Fallback message if killedBy is not set
        html += `<div style="background-color: #333333; padding: 8px 12px; border-radius: 5px; margin-bottom: 10px; border: 2px solid #666666; text-align: center;">`;
        html += `<span style="color: #FFFFFF; font-weight: bold; font-size: 14px;">☠️ You died!</span>`;
        html += `</div>`;
    }

    // Count active bombs per player
    const bombCounts = new Map();
    bombs.forEach(bomb => {
        const count = bombCounts.get(bomb.playerId) || 0;
        bombCounts.set(bomb.playerId, count + 1);
    });

    // Show active bombs if any
    if (bombCounts.size > 0) {
        html += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #444;">`;
        html += `<div style="color: #999; font-size: 11px; margin-bottom: 5px;">Active Bombs:</div>`;
        html += `<div style="display: flex; flex-wrap: wrap; gap: 8px;">`;

        bombCounts.forEach((count, playerIdKey) => {
            const player = players.get(playerIdKey);
            if (player) {
                const displayName = player.playerName || `Player ${playerIdKey.substring(0, 6)}...`;
                const characterIndex = playerCharacterMap.get(playerIdKey);
                const sprite = characterSprites[characterIndex];

                html += `<div style="background-color: #333; padding: 5px 8px; border-radius: 3px; display: flex; align-items: center; gap: 6px;">`;

                // Add character sprite if available
                if (sprite) {
                    html += `<canvas id="bomb-avatar-${playerIdKey}" width="16" height="16" style="image-rendering: pixelated;"></canvas>`;
                }

                html += `<span style="color: #fff;">${displayName}:</span>`;
                html += `<span style="color: #FFD700; font-weight: bold;">${count} 💣</span>`;
                html += `</div>`;
            }
        });

        html += `</div></div>`;
    }

    activeBombsList.innerHTML = html;

    // Draw character sprites onto the canvases
    bombCounts.forEach((count, playerIdKey) => {
        const characterIndex = playerCharacterMap.get(playerIdKey);
        const sprite = characterSprites[characterIndex];
        const canvas = document.getElementById(`bomb-avatar-${playerIdKey}`);

        if (sprite && canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 16, 16);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(sprite.canvas, 0, 0, 16, 16);
        }
    });
}

// ── Input (dispatched from keyPressed/keyReleased in game-sketch.js) ─

function bombermanKeyPressed() {
    const localPlayer = players.get(playerId);
    if (!localPlayer.alive) return false;

    // Track key press
    keysPressed[keyCode] = true;

    // Handle space bar for bombs (separate from directional keys)
    if (key === ' ' || keyCode === 32) {
        room.send('placeBomb');
        return false;
    }

    // Movement with arrow keys and WASD (using keyCodes for layout independence)
    let direction = null;
    if (keyCode === UP_ARROW || keyCode === 87) { // UP or W
        direction = { x: 0, y: -1 };
    } else if (keyCode === DOWN_ARROW || keyCode === 83) { // DOWN or S
        direction = { x: 0, y: 1 };
    } else if (keyCode === LEFT_ARROW || keyCode === 65) { // LEFT or A
        direction = { x: -1, y: 0 };
    } else if (keyCode === RIGHT_ARROW || keyCode === 68) { // RIGHT or D
        direction = { x: 1, y: 0 };
    }

    // If a direction key was pressed, add it to the array if not already there
    if (direction) {
        // Remove this key if it's already in the array (to update its position)
        directionKeys = directionKeys.filter(k => k.keyCode !== keyCode);
        // Add to the end (most recent)
        directionKeys.push({ keyCode, direction });
        // Send all held directions so the server can combine them
        // (e.g. holding up + right moves up and right around obstacles)
        room.send('setDirections', directionKeys.map(k => k.direction));
    }

    return false; // Prevent default behavior
}

function bombermanKeyReleased() {
    const localPlayer = players.get(playerId);
    if (!localPlayer || !localPlayer.alive) return false;

    // Remove key from tracking
    keysPressed[keyCode] = false;

    // Remove this key from directionKeys array
    directionKeys = directionKeys.filter(k => k.keyCode !== keyCode);

    // Send the remaining held directions (empty list stops movement)
    room.send('setDirections', directionKeys.map(k => k.direction));

    return false; // Prevent default behavior
}
