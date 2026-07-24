// ── Space Hunt client: state sync, rendering and input ─────────────
// Loaded alongside game-sketch.js (shared globals, p5 global mode).
//
// The server is authoritative at a 100ms tick; we interpolate each ship's
// position and heading between ticks so flight looks smooth at 30fps.

let spaceAsteroids = [];
let spaceBullets = [];
const SPACE_TICK = 100; // server tick, ms — the interpolation window
const SPACE_ENTITY_CORRECTION = 0.38;
let _spaceStars = null; // cached starfield, generated once per canvas size
const _spaceFallbackEntityKeys = new WeakMap();
let _spaceNextFallbackEntityKey = 0;

// Held flight controls, mirrored to the server on every change
let spaceHeld = { t: false, l: false, r: false, f: false };

// Called from room.onStateChange in game-sketch.js
function syncSpacehuntState(state) {
    // Ships already interpolate between server patches. Bullets and asteroids
    // move too quickly to render their raw 10 Hz positions, so retain their
    // client render state and advance it every frame between authoritative
    // updates. The server snapshot only makes a small, wrap-safe correction.
    spaceAsteroids = syncSpaceEntities(
        state.asteroids, spaceAsteroids,
        ['id', 'x', 'y', 'vx', 'vy', 'radius'], false, 'asteroid'
    );
    spaceBullets = syncSpaceEntities(
        state.bullets, spaceBullets,
        ['id', 'x', 'y', 'vx', 'vy'], true, 'bullet'
    );
}

function syncSpaceEntities(schemaArray, currentEntities, fields, wraps, kind) {
    if (!schemaArray) return [];

    const previousByKey = new Map(currentEntities.map(entity => [entity.key, entity]));
    const now = performance.now();
    const synced = [];

    for (let i = 0; i < schemaArray.length; i++) {
        const serverEntity = schemaArray[i];
        const key = spaceEntityKey(serverEntity, kind);
        let entity = previousByKey.get(key);

        if (!entity) {
            const visualSeed = spaceVisualSeed(key);
            entity = {
                key,
                renderX: serverEntity.x,
                renderY: serverEntity.y,
                serverX: serverEntity.x,
                serverY: serverEntity.y,
                renderAt: now,
                // Stable client-only details make asteroid rotation/shape
                // consistent for its full lifetime.
                visualSeed,
                spin: ((visualSeed * 37) % 17 - 8) * 0.00035,
                renderAngle: (visualSeed * 2.399963229728653) % (Math.PI * 2),
            };
        } else {
            advanceSpaceEntity(entity, now, wraps);

            // A predicted entity is normally already at the next snapshot's
            // position. Blend any drift out instead of visibly snapping back.
            if (entity.serverX !== serverEntity.x || entity.serverY !== serverEntity.y) {
                const dx = wraps ? wrapDelta(serverEntity.x - entity.renderX, width) : serverEntity.x - entity.renderX;
                const dy = wraps ? wrapDelta(serverEntity.y - entity.renderY, height) : serverEntity.y - entity.renderY;
                const error = Math.hypot(dx, dy);
                if (error > 90) {
                    // A delayed patch, new round, or a backgrounded tab: be
                    // accurate immediately rather than easing in from stale state.
                    entity.renderX = serverEntity.x;
                    entity.renderY = serverEntity.y;
                } else {
                    entity.renderX += dx * SPACE_ENTITY_CORRECTION;
                    entity.renderY += dy * SPACE_ENTITY_CORRECTION;
                    if (wraps) {
                        entity.renderX = wrapSpaceCoordinate(entity.renderX, width);
                        entity.renderY = wrapSpaceCoordinate(entity.renderY, height);
                    }
                }
            }
        }

        for (const field of fields) entity[field] = serverEntity[field];
        entity.serverX = serverEntity.x;
        entity.serverY = serverEntity.y;
        synced.push(entity);
    }
    return synced;
}

function spaceEntityKey(serverEntity, kind) {
    // A fresh server provides an ID. The bullet fallback also supports a
    // client reloaded against an already-running server, which prevents every
    // simultaneous shot from being mistaken for the same render object.
    if (serverEntity.id !== undefined && serverEntity.id !== null) {
        return `${kind}:${serverEntity.id}`;
    }
    if (kind === 'bullet' && serverEntity.ownerId && serverEntity.born) {
        return `bullet:${serverEntity.ownerId}:${serverEntity.born}`;
    }
    let key = _spaceFallbackEntityKeys.get(serverEntity);
    if (!key) {
        key = `${kind}:local:${++_spaceNextFallbackEntityKey}`;
        _spaceFallbackEntityKeys.set(serverEntity, key);
    }
    return key;
}

function spaceVisualSeed(key) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function advanceSpaceEntity(entity, now, wraps) {
    const elapsed = Math.min(Math.max(now - entity.renderAt, 0), 250);
    const tickFraction = elapsed / SPACE_TICK;
    entity.renderX += (entity.vx || 0) * tickFraction;
    entity.renderY += (entity.vy || 0) * tickFraction;
    entity.renderAngle += entity.spin * elapsed;
    if (wraps) {
        entity.renderX = wrapSpaceCoordinate(entity.renderX, width);
        entity.renderY = wrapSpaceCoordinate(entity.renderY, height);
    }
    entity.renderAt = now;
}

function wrapSpaceCoordinate(value, size) {
    return ((value % size) + size) % size;
}

// Shortest signed distance across a toroidal axis, in [-size/2, size/2].
// Used to blend a predicted entity toward its next snapshot without snapping
// the long way around when it has crossed the wrap seam. (Mirrors the server.)
function wrapDelta(d, size) {
    d = ((d % size) + size) % size;
    if (d > size / 2) d -= size;
    return d;
}

// Smooth a ship's position + heading between server ticks. Called from the
// players loop in game-sketch.js (mirrors snake's syncSnakeFields).
function syncSpacehuntFields(localPlayer, serverPlayer) {
    const x = serverPlayer.x || 0;
    const y = serverPlayer.y || 0;
    const angle = serverPlayer.angle || 0;

    if (localPlayer.spRenderX === undefined) {
        localPlayer.spRenderX = x;
        localPlayer.spRenderY = y;
        localPlayer.spStartX = x;
        localPlayer.spStartY = y;
        localPlayer.spTargetX = x;
        localPlayer.spTargetY = y;
        localPlayer.spRenderAngle = angle;
        localPlayer.spStartAngle = angle;
        localPlayer.spTargetAngle = angle;
        localPlayer.spMoveTime = Date.now();
        return;
    }

    if (localPlayer.spTargetX !== x || localPlayer.spTargetY !== y ||
        localPlayer.spTargetAngle !== angle) {
        const jump = Math.abs(x - localPlayer.spTargetX) + Math.abs(y - localPlayer.spTargetY);
        if (jump > 120) {
            // Screen wrap or respawn: snap instead of sliding across the arena
            localPlayer.spRenderX = x;
            localPlayer.spRenderY = y;
            localPlayer.spStartX = x;
            localPlayer.spStartY = y;
        } else {
            localPlayer.spStartX = localPlayer.spRenderX;
            localPlayer.spStartY = localPlayer.spRenderY;
        }
        // Rotate along the shortest arc from where we're currently drawn
        localPlayer.spStartAngle = localPlayer.spRenderAngle;
        localPlayer.spTargetAngle = localPlayer.spStartAngle + shortestAngle(localPlayer.spStartAngle, angle);
        localPlayer.spTargetX = x;
        localPlayer.spTargetY = y;
        localPlayer.spMoveTime = Date.now();
    }
}

// Smallest signed rotation (radians) that takes `from` onto `to`
function shortestAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

// ── Rendering ───────────────────────────────────────────────────────

function drawSpacehuntGame() {
    const now = Date.now();
    const renderNow = performance.now();
    drawStarfield();

    // Asteroids
    push();
    spaceAsteroids.forEach(a => {
        advanceSpaceEntity(a, renderNow, false);
        drawAsteroid(a);
    });
    pop();

    // Bullets. Keep the renderer batched: rapid fire can put up to five
    // bullets per ship on screen, and changing p5 drawing state per bullet
    // was enough to make sustained firing hitch on lower-powered devices.
    push();
    // Red laser bolt: a glowing red streak with a hot, near-white core.
    stroke(255, 40, 40, 120);
    strokeWeight(3);
    spaceBullets.forEach(b => {
        advanceSpaceEntity(b, renderNow, true);
        const speed = Math.hypot(b.vx || 0, b.vy || 0) || 1;
        line(
            b.renderX - (b.vx / speed) * 12,
            b.renderY - (b.vy / speed) * 12,
            b.renderX,
            b.renderY
        );
    });
    noStroke();
    fill(255, 150, 150);
    spaceBullets.forEach(b => {
        ellipse(b.renderX, b.renderY, 6, 6);
    });
    pop();

    // Ships (interpolated). Draw wrapped copies near the edges so a ship
    // straddling a border shows on both sides.
    players.forEach((player, id) => {
        if (!player || player.isSpectator || !player.alive) return;
        if (player.spRenderX === undefined) return;

        const t = Math.min((now - player.spMoveTime) / SPACE_TICK, 1.0);
        player.spRenderX = lerp(player.spStartX ?? player.spTargetX, player.spTargetX, t);
        player.spRenderY = lerp(player.spStartY ?? player.spTargetY, player.spTargetY, t);
        player.spRenderAngle = lerp(player.spStartAngle ?? player.spTargetAngle, player.spTargetAngle, t);

        const protectedNow = player.protectedUntil && player.protectedUntil > now;
        // Blink while spawn-protected
        if (protectedNow && Math.floor(now / 150) % 2 === 0) return;

        const isMe = id === playerId;
        const edge = 44;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                if (ox !== 0 && player.spRenderX > edge && player.spRenderX < width - edge) continue;
                if (oy !== 0 && player.spRenderY > edge && player.spRenderY < height - edge) continue;
                drawShip(
                    player.spRenderX + ox * width,
                    player.spRenderY + oy * height,
                    player.spRenderAngle, player.color, isMe, player.isMoving
                );
            }
        }
    });

    drawSpaceScores();

    // "Respawning" notice for the local player while destroyed
    const me = players.get(playerId);
    if (me && !me.isSpectator && !me.alive && !winnerId) {
        push();
        textAlign(CENTER, CENTER);
        textSize(28);
        fill(255, 120, 120);
        text('💥 Destroyed — respawning...', width / 2, height / 2);
        pop();
    }

    // Players HUD box (reuses the bomberman cache)
    if (!_uiCache.initialized) _initUICache();
    let playing = 0;
    players.forEach(p => { if (!p.isSpectator) playing++; });
    if (_uiCache.playersAliveEl && playing !== _uiCache.lastAlive) {
        _uiCache.lastAlive = playing;
        _uiCache.playersAliveEl.textContent = `${playing} Playing`;
    }

    if (winnerId) drawWinnerMessage();
}

function drawAsteroid(asteroid) {
    push();
    translate(asteroid.renderX, asteroid.renderY);
    rotate(asteroid.renderAngle);
    fill(62, 65, 82);
    stroke(156, 160, 180);
    strokeWeight(2);
    beginShape();
    const points = 9;
    for (let i = 0; i < points; i++) {
        const phase = asteroid.visualSeed * 0.73 + i * 1.91;
        const radius = asteroid.radius * (0.78 + ((Math.sin(phase) + 1) * 0.11));
        const angle = i * Math.PI * 2 / points;
        vertex(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    endShape(CLOSE);
    noStroke();
    fill(112, 115, 135, 70);
    ellipse(-asteroid.radius * 0.2, -asteroid.radius * 0.25, asteroid.radius * 0.55, asteroid.radius * 0.32);
    pop();
}

function drawShip(x, y, angle, color, isMe, thrusting) {
    push();
    translate(x, y);
    rotate(angle);

    // Thrust flame
    if (thrusting && Math.floor(Date.now() / 60) % 2 === 0) {
        noStroke();
        fill(255, 160, 40);
        triangle(-11, -5, -11, 5, -20, 0);
    }

    // Hull: nose points along +x (matches server cos/sin heading)
    fill(color || '#ffffff');
    stroke(isMe ? 255 : 30);
    strokeWeight(isMe ? 2.5 : 1.5);
    triangle(14, 0, -11, -9, -11, 9);
    // Cockpit notch
    noStroke();
    fill(0, 0, 0, 90);
    triangle(-11, -4, -11, 4, -3, 0);
    pop();
}

function drawSpaceScores() {
    push();
    textSize(16);
    textAlign(LEFT, BASELINE);
    let y = 22;
    // Sort by score, highest first
    const ranked = [];
    players.forEach((player, id) => { if (!player.isSpectator) ranked.push([id, player]); });
    ranked.sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
    ranked.forEach(([id, player]) => {
        fill(player.color || '#ffffff');
        noStroke();
        const name = player.playerName || 'Anonymous';
        text(`${name}${id === playerId ? ' (you)' : ''}: ${player.score || 0} / 20`, 12, y);
        y += 20;
    });
    pop();
}

function drawStarfield() {
    if (!_spaceStars || _spaceStars.w !== width || _spaceStars.h !== height) {
        const stars = [];
        // Deterministic-ish sprinkle; regenerated only on resize
        for (let i = 0; i < 90; i++) {
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                r: Math.random() < 0.8 ? 1 : 2,
            });
        }
        _spaceStars = { w: width, h: height, stars };
    }
    background(8, 10, 24);
    push();
    noStroke();
    fill(200, 205, 230);
    _spaceStars.stars.forEach(s => rect(s.x, s.y, s.r, s.r));
    pop();
}

// ── Input (held flight controls, dispatched from game-sketch.js) ─────

function spacehuntSendHeld() {
    if (room) room.send('spaceInput', spaceHeld);
}

function spacehuntSetHeld(down) {
    let key = null;
    if (keyCode === UP_ARROW || keyCode === 87) key = 't';        // W / ↑ thrust
    else if (keyCode === LEFT_ARROW || keyCode === 65) key = 'l'; // A / ← rotate left
    else if (keyCode === RIGHT_ARROW || keyCode === 68) key = 'r';// D / → rotate right
    else if (keyCode === 32) key = 'f';                          // Space fire
    if (!key) return false;
    if (spaceHeld[key] !== down) {
        spaceHeld[key] = down;
        spacehuntSendHeld();
    }
    return false;
}

function spacehuntKeyPressed() {
    return spacehuntSetHeld(true);
}

function spacehuntKeyReleased() {
    return spacehuntSetHeld(false);
}
