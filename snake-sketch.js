// ── Snake client: state sync, rendering and input ──────────────────
// Loaded alongside game-sketch.js (shared globals, p5 global mode).

let snakeFood = [];
const SNAKE_SCL = 20; // Snake tile size
const SNAKE_TICK = 100; // Server update interval for head interpolation

// Called from room.onStateChange in game-sketch.js
function syncSnakeState(state) {
    snakeFood = state.food ? schemaArrayToPlain(state.food, ['x', 'y']) : [];
}

// Sync snake score/segments onto the local player, with head-position
// interpolation bookkeeping for smooth rendering
function syncSnakeFields(localPlayer, serverPlayer) {
    localPlayer.score = serverPlayer.score || 0;
    localPlayer.segments = serverPlayer.segments
        ? schemaArrayToPlain(serverPlayer.segments, ['x', 'y'])
        : [];

    if (localPlayer.segments.length === 0) return;

    const head = localPlayer.segments[0];
    if (localPlayer.sRenderX === undefined) {
        localPlayer.sRenderX = head.x;
        localPlayer.sRenderY = head.y;
        localPlayer.sStartX = head.x;
        localPlayer.sStartY = head.y;
        localPlayer.sTargetX = head.x;
        localPlayer.sTargetY = head.y;
        localPlayer.sMoveTime = Date.now();
    } else if (localPlayer.sTargetX !== head.x || localPlayer.sTargetY !== head.y) {
        const jump = Math.abs(head.x - localPlayer.sTargetX) + Math.abs(head.y - localPlayer.sTargetY);
        if (jump > SNAKE_SCL * 2) {
            // Respawn or screen wrap: snap instead of sliding across the map
            localPlayer.sRenderX = head.x;
            localPlayer.sRenderY = head.y;
            localPlayer.sStartX = head.x;
            localPlayer.sStartY = head.y;
        } else {
            localPlayer.sStartX = localPlayer.sRenderX;
            localPlayer.sStartY = localPlayer.sRenderY;
        }
        localPlayer.sTargetX = head.x;
        localPlayer.sTargetY = head.y;
        localPlayer.sMoveTime = Date.now();
    }
}

// ── Rendering ───────────────────────────────────────────────────────

function drawSnakeGame() {
    background(51);
    const now = Date.now();

    // Draw all snakes with head interpolation
    players.forEach((player, id) => {
        if (!player || !player.color || !player.segments || player.segments.length === 0) return;

        fill(player.color);
        noStroke();

        if (player.sMoveTime !== undefined) {
            const t = Math.min((now - player.sMoveTime) / SNAKE_TICK, 1.0);
            player.sRenderX = lerp(player.sStartX ?? player.sTargetX, player.sTargetX, t);
            player.sRenderY = lerp(player.sStartY ?? player.sTargetY, player.sTargetY, t);
        }

        player.segments.forEach((segment, i) => {
            if (i === 0 && player.sRenderX !== undefined) {
                rect(player.sRenderX, player.sRenderY, SNAKE_SCL, SNAKE_SCL);
            } else {
                rect(segment.x, segment.y, SNAKE_SCL, SNAKE_SCL);
            }
        });
    });

    // Draw food
    fill(255, 0, 100);
    noStroke();
    snakeFood.forEach(f => {
        rect(f.x, f.y, SNAKE_SCL, SNAKE_SCL);
    });

    drawSnakeScores();

    // Players HUD box (reuses the bomberman cache)
    if (!_uiCache.initialized) _initUICache();
    let playing = 0;
    players.forEach(p => { if (!p.isSpectator) playing++; });
    if (_uiCache.playersAliveEl && playing !== _uiCache.lastAlive) {
        _uiCache.lastAlive = playing;
        _uiCache.playersAliveEl.textContent = `${playing} Playing`;
    }

    // Draw winner message if applicable
    if (winnerId) {
        drawWinnerMessage();
    }
}

function drawSnakeScores() {
    textSize(16);
    textAlign(LEFT, BASELINE);
    let y = 20;
    players.forEach((player, id) => {
        if (player.isSpectator) return;
        fill(player.color);
        const name = player.playerName || 'Anonymous';
        text(`${name}${id === playerId ? ' (you)' : ''}: ${player.score || 0}`, 10, y);
        y += 20;
    });

    const me = players.get(playerId);
    if (me && !me.isSpectator) {
        fill(255);
        textSize(20);
        text('Score: ' + (me.score || 0), 10, height - 10);
    }
}

// ── Input (dispatched from keyPressed in game-sketch.js) ────────────

// Snake: single keypress steers, no key-hold tracking
function snakeKeyPressed() {
    let direction = null;
    if (keyCode === UP_ARROW || keyCode === 87) {
        direction = { x: 0, y: -1 };
    } else if (keyCode === DOWN_ARROW || keyCode === 83) {
        direction = { x: 0, y: 1 };
    } else if (keyCode === LEFT_ARROW || keyCode === 65) {
        direction = { x: -1, y: 0 };
    } else if (keyCode === RIGHT_ARROW || keyCode === 68) {
        direction = { x: 1, y: 0 };
    }
    if (direction) room.send('direction', direction);
    return false;
}
