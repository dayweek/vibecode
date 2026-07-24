const { Bullet, Asteroid } = require('./schema');

// ── Space Hunt configuration ────────────────────────────────────────
// Asteroids-style real-time PvP deathmatch. Physics runs on the shared
// 100ms room tick; the client interpolates positions between ticks.
// All speeds are "per tick" (px) unless suffixed with a time unit.

const SPACEHUNT_CONFIG = {
    width: 900,
    height: 700,
    winningScore: 20,        // kills to win
    rotSpeed: 0.32,          // radians turned per tick
    thrust: 0.9,             // velocity gained per tick while thrusting
    friction: 0.94,          // velocity retained each tick
    maxSpeed: 26,            // px per tick
    bulletSpeed: 22,         // px per tick
    bulletRadius: 3,         // added to shipRadius for hit tests
    bulletLife: 1300,        // ms before a bullet expires
    fireCooldown: 900,       // ms between shots (~3.5× slower fire rate)
    respawnDelay: 3000,      // ms a destroyed ship stays gone
    spawnProtection: 2500,   // ms of invulnerability after (re)spawn
    shipRadius: 13,          // collision radius
    noseOffset: 16,          // bullet spawn distance from ship centre
    asteroidSpawnInterval: 1600, // ms between asteroid spawns
    asteroidMax: 6,          // simultaneous asteroids cap
    asteroidMinRadius: 16,
    asteroidMaxRadius: 40,
    asteroidMinSpeed: 6,
    asteroidMaxSpeed: 16,
    minPlayers: 2,
};

// ── Space Hunt server logic ─────────────────────────────────────────
// Mixed into GameRoom.prototype (see game-room.js), so `this` is the room.

const spacehuntMethods = {

    registerSpacehuntMessages() {
        // Held controls: { t: thrust, l: rotate left, r: rotate right, f: fire }
        this.onMessage('spaceInput', (client, held) => {
            if (this.state.gameType !== 'spacehunt' || this.state.phase !== 'playing') return;
            const internal = this.playerInternal.get(client.sessionId);
            if (!internal || !held) return;
            internal.lastActivityTime = Date.now();
            internal.spaceInput = {
                t: !!held.t,
                l: !!held.l,
                r: !!held.r,
                f: !!held.f,
            };
        });
    },

    startSpacehuntGame() {
        console.log('Starting Space Hunt game...');
        this.clearGameObjects();
        this.clearBoard();

        this.state.bullets.splice(0, this.state.bullets.length);
        this.state.asteroids.splice(0, this.state.asteroids.length);
        this.spaceObjectId = 0;

        this.state.gridWidth = SPACEHUNT_CONFIG.width;
        this.state.gridHeight = SPACEHUNT_CONFIG.height;
        this.participantsAtStart = this.state.players.size;

        const now = Date.now();
        for (const [sessionId, player] of this.state.players) {
            player.isSpectator = false;
            player.ready = false;
            player.alive = true;
            player.killedBy = '';
            player.score = 0;
            player.isMoving = false;

            const internal = this.playerInternal.get(sessionId);
            if (internal) {
                internal.spaceInput = { t: false, l: false, r: false, f: false };
                internal.spaceVx = 0;
                internal.spaceVy = 0;
                internal.spaceRespawnAt = 0;
                internal.spaceLastFire = 0;
                internal.lastActivityTime = now;
            }
            this.respawnShip(sessionId, player);
        }

        // Seed the asteroid spawn clock so a rock appears shortly after start
        this.spaceNextAsteroid = now + 800;

        this.state.phase = 'playing';
        this.updateMetadata();
    },

    // ── Space Hunt game loop (called every 100ms room tick) ───────────

    updateSpacehuntState() {
        const now = Date.now();
        const cfg = SPACEHUNT_CONFIG;

        // Pause once there's a winner (waiting for the return to lobby)
        if (this.state.winnerId) return;

        // Only spectators left — nothing to play, back to the lobby
        let participantCount = 0;
        for (const [, p] of this.state.players) {
            if (!p.isSpectator) participantCount++;
        }
        if (participantCount === 0) {
            this.returnToLobby();
            return;
        }

        // ── Ships: physics, respawn, firing ──────────────────────────
        for (const [sessionId, player] of this.state.players) {
            if (player.isSpectator) continue;
            const internal = this.playerInternal.get(sessionId);
            if (!internal) continue;

            if (!player.alive) {
                if (internal.spaceRespawnAt && now >= internal.spaceRespawnAt) {
                    this.respawnShip(sessionId, player);
                }
                continue;
            }

            const input = internal.spaceInput || {};

            // Rotation
            if (input.l) player.angle -= cfg.rotSpeed;
            if (input.r) player.angle += cfg.rotSpeed;

            // Thrust
            if (input.t) {
                internal.spaceVx += Math.cos(player.angle) * cfg.thrust;
                internal.spaceVy += Math.sin(player.angle) * cfg.thrust;
                const speed = Math.hypot(internal.spaceVx, internal.spaceVy);
                if (speed > cfg.maxSpeed) {
                    internal.spaceVx = (internal.spaceVx / speed) * cfg.maxSpeed;
                    internal.spaceVy = (internal.spaceVy / speed) * cfg.maxSpeed;
                }
            }
            player.isMoving = !!input.t;

            // Friction + integrate + wrap (toroidal)
            internal.spaceVx *= cfg.friction;
            internal.spaceVy *= cfg.friction;
            player.x = wrap(player.x + internal.spaceVx, cfg.width);
            player.y = wrap(player.y + internal.spaceVy, cfg.height);

            // Firing (held, gated by cooldown)
            if (input.f && now - internal.spaceLastFire >= cfg.fireCooldown) {
                internal.spaceLastFire = now;
                const b = new Bullet();
                b.id = ++this.spaceObjectId;
                b.x = wrap(player.x + Math.cos(player.angle) * cfg.noseOffset, cfg.width);
                b.y = wrap(player.y + Math.sin(player.angle) * cfg.noseOffset, cfg.height);
                b.vx = Math.cos(player.angle) * cfg.bulletSpeed;
                b.vy = Math.sin(player.angle) * cfg.bulletSpeed;
                b.ownerId = sessionId;
                b.born = now;
                this.state.bullets.push(b);
            }
        }

        // ── Bullets: move, expire, hit ships ─────────────────────────
        for (let i = this.state.bullets.length - 1; i >= 0; i--) {
            const b = this.state.bullets[i];
            if (now - b.born > cfg.bulletLife) {
                this.state.bullets.splice(i, 1);
                continue;
            }
            const prevX = b.x, prevY = b.y;
            b.x = wrap(b.x + b.vx, cfg.width);
            b.y = wrap(b.y + b.vy, cfg.height);

            const hitR = cfg.shipRadius + cfg.bulletRadius;
            let consumed = false;
            for (const [victimId, victim] of this.state.players) {
                if (victimId === b.ownerId || victim.isSpectator || !victim.alive) continue;
                if (victim.protectedUntil > now) continue;
                // Swept test: measure the ship against the bullet's whole path
                // this tick (in the ship's local, wrap-corrected frame) so a
                // fast bullet can't tunnel clean through a ship between ticks.
                const ax = wrapDelta(prevX - victim.x, cfg.width);
                const ay = wrapDelta(prevY - victim.y, cfg.height);
                const bx = wrapDelta(b.x - victim.x, cfg.width);
                const by = wrapDelta(b.y - victim.y, cfg.height);
                if (segDistToOrigin(ax, ay, bx, by) <= hitR) {
                    this.destroyShip(victimId, victim, b.ownerId);
                    consumed = true;
                    break;
                }
            }
            if (consumed) this.state.bullets.splice(i, 1);
            if (this.state.winnerId) return; // a kill just ended the game
        }

        // ── Asteroids: spawn, move, expire, hit ships ────────────────
        if (now >= this.spaceNextAsteroid && this.state.asteroids.length < cfg.asteroidMax) {
            this.spawnAsteroid();
            this.spaceNextAsteroid = now + cfg.asteroidSpawnInterval;
        }

        for (let i = this.state.asteroids.length - 1; i >= 0; i--) {
            const a = this.state.asteroids[i];
            a.x += a.vx;
            a.y += a.vy;

            // Despawn once fully off-screen (asteroids pass, they don't wrap)
            const m = a.radius;
            if (a.x < -m || a.x > cfg.width + m || a.y < -m || a.y > cfg.height + m) {
                this.state.asteroids.splice(i, 1);
                continue;
            }

            for (const [victimId, victim] of this.state.players) {
                if (victim.isSpectator || !victim.alive) continue;
                if (victim.protectedUntil > now) continue;
                const d = Math.hypot(a.x - victim.x, a.y - victim.y);
                if (d < a.radius + cfg.shipRadius) {
                    this.destroyShip(victimId, victim, ''); // hazard kill, no scorer
                }
            }
        }
    },

    // ── Helpers ───────────────────────────────────────────────────────

    destroyShip(sessionId, player, killerId) {
        player.alive = false;
        player.isMoving = false;
        player.killedBy = killerId || '';
        const internal = this.playerInternal.get(sessionId);
        if (internal) {
            internal.spaceRespawnAt = Date.now() + SPACEHUNT_CONFIG.respawnDelay;
            internal.spaceVx = 0;
            internal.spaceVy = 0;
            internal.spaceInput = { t: false, l: false, r: false, f: false };
        }
        this.broadcast('playDieSound');

        // Award the kill (never for self-inflicted or hazard deaths)
        if (killerId && killerId !== sessionId) {
            const killer = this.state.players.get(killerId);
            if (killer && !killer.isSpectator) {
                killer.score++;
                if (killer.score >= SPACEHUNT_CONFIG.winningScore) {
                    this.state.winnerId = killerId;
                    console.log(`Space Hunt player ${killerId} wins!`);
                    this.broadcast('playWinSound');
                    this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
                }
            }
        }
    },

    respawnShip(sessionId, player) {
        const pos = this.randomSafeSpacePosition(sessionId);
        player.x = pos.x;
        player.y = pos.y;
        player.angle = Math.random() * Math.PI * 2;
        player.alive = true;
        player.killedBy = '';
        player.isMoving = false;
        player.protectedUntil = Date.now() + SPACEHUNT_CONFIG.spawnProtection;

        const internal = this.playerInternal.get(sessionId);
        if (internal) {
            internal.spaceVx = 0;
            internal.spaceVy = 0;
            internal.spaceRespawnAt = 0;
        }
    },

    spawnAsteroid() {
        const cfg = SPACEHUNT_CONFIG;
        const a = new Asteroid();
        a.id = ++this.spaceObjectId;
        a.radius = cfg.asteroidMinRadius + Math.random() * (cfg.asteroidMaxRadius - cfg.asteroidMinRadius);
        const speed = cfg.asteroidMinSpeed + Math.random() * (cfg.asteroidMaxSpeed - cfg.asteroidMinSpeed);

        // Enter from a random edge, aim across the arena toward a random
        // point on the opposite side so it drifts through the play field.
        const edge = Math.floor(Math.random() * 4);
        let x, y, tx, ty;
        if (edge === 0) { x = -a.radius; y = Math.random() * cfg.height; }        // left
        else if (edge === 1) { x = cfg.width + a.radius; y = Math.random() * cfg.height; } // right
        else if (edge === 2) { x = Math.random() * cfg.width; y = -a.radius; }     // top
        else { x = Math.random() * cfg.width; y = cfg.height + a.radius; }         // bottom
        tx = cfg.width * (0.25 + Math.random() * 0.5);
        ty = cfg.height * (0.25 + Math.random() * 0.5);

        const ang = Math.atan2(ty - y, tx - x);
        a.x = x;
        a.y = y;
        a.vx = Math.cos(ang) * speed;
        a.vy = Math.sin(ang) * speed;
        this.state.asteroids.push(a);
    },

    randomSafeSpacePosition(excludeId) {
        const cfg = SPACEHUNT_CONFIG;
        const margin = 60;
        const shipSeparation = 200; // desired clearance from other live ships
        let best = null;
        let bestDist = -1;
        // Pick the candidate with the most clearance from asteroids AND other
        // ships, so nobody spawns right on top of a rival (a few tries is plenty)
        for (let attempt = 0; attempt < 16; attempt++) {
            const x = margin + Math.random() * (cfg.width - margin * 2);
            const y = margin + Math.random() * (cfg.height - margin * 2);
            let nearest = Infinity;
            for (let i = 0; i < this.state.asteroids.length; i++) {
                const a = this.state.asteroids[i];
                nearest = Math.min(nearest, Math.hypot(a.x - x, a.y - y) - a.radius);
            }
            for (const [otherId, other] of this.state.players) {
                if (otherId === excludeId || other.isSpectator || !other.alive) continue;
                // Count anything closer than the desired separation as an
                // encroachment; farther-apart ships don't improve the score.
                nearest = Math.min(nearest, Math.hypot(other.x - x, other.y - y) - shipSeparation);
            }
            if (nearest > bestDist) {
                bestDist = nearest;
                best = { x, y };
                if (nearest > 120) break; // good enough
            }
        }
        return best || { x: cfg.width / 2, y: cfg.height / 2 };
    },
};

// Wrap a coordinate into [0, size) — toroidal arena
function wrap(v, size) {
    if (v < 0) return v + size;
    if (v >= size) return v - size;
    return v;
}

// Wrap a coordinate difference into [-size/2, size/2] — the shortest way
// round a toroidal arena, so hit tests work across the wrap seam.
function wrapDelta(d, size) {
    d = ((d % size) + size) % size;
    if (d > size / 2) d -= size;
    return d;
}

// Shortest distance from the origin to the segment (ax,ay)-(bx,by)
function segDistToOrigin(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(cx, cy);
}

module.exports = { SPACEHUNT_CONFIG, spacehuntMethods };
