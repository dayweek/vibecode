// ── Vibe Check configuration ────────────────────────────────────────
// Wavelength-style party game: each round one player (the "psychic") sees
// a secret spot on a scale like "Cheap ↔ Expensive", types a clue, and
// everyone else places a marker where they think the spot is. Closer
// guesses score more; the psychic scores as much as their best guesser.

const VIBECHECK_CONFIG = {
    width: 960,
    height: 640,
    defaultRounds: 5,
    maxRounds: 10,
    minPlayers: 2,        // psychic + at least one guesser
    clueMaxLength: 60,
    cluePhaseMs: 90000,   // psychic thinking time before the round is skipped
    guessPhaseMs: 60000,  // guessing time before the reveal is forced
    revealDelay: 6000,    // ms the reveal stays on screen between rounds
    // Distance from the target (0–100 scale) → points for the guesser
    bands: [
        { within: 3, pts: 4 },
        { within: 8, pts: 3 },
        { within: 15, pts: 2 },
        { within: 25, pts: 1 },
    ],
};

// Scale pairs [left end, right end]. Everyday concepts only — the fun is
// in arguing where "pineapple pizza" sits, not in knowing trivia.
const VIBECHECK_SCALES = [
    ['Cheap', 'Expensive'],
    ['Cold', 'Hot'],
    ['Scary', 'Cute'],
    ['Useless', 'Useful'],
    ['Boring', 'Exciting'],
    ['Quiet', 'Loud'],
    ['Soft', 'Hard'],
    ['Casual', 'Formal'],
    ['Unhealthy', 'Healthy'],
    ['Old-fashioned', 'Futuristic'],
    ['Underrated', 'Overrated'],
    ['Dry', 'Wet'],
    ['Smells bad', 'Smells good'],
    ['Round', 'Pointy'],
    ['Low effort', 'High effort'],
    ['Introvert thing', 'Extrovert thing'],
    ['Weekday vibes', 'Weekend vibes'],
    ['Salty', 'Sweet'],
    ['Dangerous', 'Safe'],
    ['Rare', 'Common'],
    ['Small talk', 'Deep talk'],
    ['Guilty pleasure', 'Openly proud of it'],
    ['Bad movie', 'Great movie'],
    ['Slow', 'Fast'],
    ['Tiny', 'Huge'],
    ['Ugly', 'Beautiful'],
    ['Mainstream', 'Niche'],
    ['Kids love it', 'Adults love it'],
    ['Winter thing', 'Summer thing'],
    ['Breakfast food', 'Dinner food'],
    ['Easy to learn', 'Hard to learn'],
    ['Messy', 'Tidy'],
    ['Serious', 'Silly'],
    ['Ancient', 'Modern'],
    ['City thing', 'Nature thing'],
    ['Comfortable', 'Stylish'],
    ['Forgettable', 'Memorable'],
    ['Loved by cats', 'Loved by dogs'],
    ['Morning person thing', 'Night owl thing'],
    ['Overpaid job', 'Underpaid job'],
    ['Needs talent', 'Needs luck'],
    ['Smells like childhood', 'Smells like adulthood'],
];

// ── Vibe Check server logic ─────────────────────────────────────────
// Mixed into GameRoom.prototype (see game-room.js), so `this` is the room.

const vibecheckMethods = {

    registerVibecheckMessages() {
        // Host configures how many rounds the game lasts
        this.onMessage('setVibeRounds', (client, rounds) => {
            if (this.state.phase !== 'lobby') return;
            if (client.sessionId !== this.state.hostId) return;
            const n = Math.floor(Number(rounds));
            if (!Number.isFinite(n) || n < 1 || n > VIBECHECK_CONFIG.maxRounds) return;
            this.state.vibeTotalRounds = n;
        });

        // The psychic submits their clue, opening the guessing phase
        this.onMessage('vibeClue', (client, clue) => {
            if (this.state.gameType !== 'vibecheck' || this.state.phase !== 'playing') return;
            if (this.state.vibePhase !== 'clue' || this.state.winnerId) return;
            if (client.sessionId !== this.state.vibePsychicId) return;
            clue = String(clue || '').replace(/\s+/g, ' ').trim()
                .substring(0, VIBECHECK_CONFIG.clueMaxLength);
            if (!clue) return;

            const internal = this.playerInternal.get(client.sessionId);
            if (internal) internal.lastActivityTime = Date.now();

            this.state.vibeClue = clue;
            this.state.vibePhase = 'guess';
            this.state.vibeDeadline = Date.now() + VIBECHECK_CONFIG.guessPhaseMs;
            this.broadcast('playNewSound');
        });

        // A guesser places (or moves) their marker on the scale
        this.onMessage('vibeGuess', (client, value) => {
            if (this.state.gameType !== 'vibecheck' || this.state.phase !== 'playing') return;
            if (this.state.vibePhase !== 'guess' || this.state.winnerId) return;
            if (client.sessionId === this.state.vibePsychicId) return;
            const player = this.state.players.get(client.sessionId);
            if (!player || player.isSpectator || player.vibeLocked) return;
            const n = Math.round(Number(value));
            if (!Number.isFinite(n)) return;
            player.vibeGuess = Math.max(0, Math.min(100, n));

            const internal = this.playerInternal.get(client.sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        });

        // A guesser locks their marker; the round reveals once everyone locks
        this.onMessage('vibeLock', (client) => {
            if (this.state.gameType !== 'vibecheck' || this.state.phase !== 'playing') return;
            if (this.state.vibePhase !== 'guess' || this.state.winnerId) return;
            if (client.sessionId === this.state.vibePsychicId) return;
            const player = this.state.players.get(client.sessionId);
            if (!player || player.isSpectator || player.vibeGuess < 0) return;
            player.vibeLocked = true;

            const internal = this.playerInternal.get(client.sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        });
    },

    startVibecheckGame() {
        console.log('Starting Vibe Check game...');
        this.clearGameObjects();

        // Vibe Check uses no board objects — clear any leftover walls
        this.clearBoard();

        this.state.gridWidth = VIBECHECK_CONFIG.width;
        this.state.gridHeight = VIBECHECK_CONFIG.height;
        this.participantsAtStart = this.state.players.size;

        const participantIds = [];
        for (const [sessionId, player] of this.state.players) {
            player.isSpectator = false;
            player.ready = false;
            player.alive = true;
            player.killedBy = '';
            player.isMoving = false;
            player.score = 0;
            player.vibeGuess = -1;
            player.vibeLocked = false;
            participantIds.push(sessionId);
            const internal = this.playerInternal.get(sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        }

        // Shuffled scale pool (refilled if a long game runs out)
        this.vibeScalePool = this.shuffledVibeScales();

        // Psychic role rotates through a shuffled seating order
        for (let i = participantIds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [participantIds[i], participantIds[j]] = [participantIds[j], participantIds[i]];
        }
        this.vibePsychicOrder = participantIds;
        this.vibePsychicIdx = -1;

        this.startVibeRound(1);
        this.state.phase = 'playing';
        this.updateMetadata();
    },

    shuffledVibeScales() {
        const pool = VIBECHECK_SCALES.slice();
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool;
    },

    // Advance the rotation to the next psychic still in the game
    vibeNextPsychic() {
        const order = this.vibePsychicOrder;
        for (let step = 1; step <= order.length; step++) {
            const idx = (this.vibePsychicIdx + step) % order.length;
            const p = this.state.players.get(order[idx]);
            if (p && !p.isSpectator) {
                this.vibePsychicIdx = idx;
                return order[idx];
            }
        }
        return '';
    },

    startVibeRound(round) {
        const psychicId = this.vibeNextPsychic();
        if (!psychicId) return; // update loop handles empty rooms

        if (this.vibeScalePool.length === 0) this.vibeScalePool = this.shuffledVibeScales();
        const [left, right] = this.vibeScalePool.pop();

        this.state.vibeRound = round;
        this.state.vibePsychicId = psychicId;
        this.state.vibeScaleLeft = left;
        this.state.vibeScaleRight = right;
        this.state.vibeClue = '';
        this.state.vibeTarget = -1;
        this.state.vibePhase = 'clue';
        this.state.vibeDeadline = Date.now() + VIBECHECK_CONFIG.cluePhaseMs;

        for (const [, player] of this.state.players) {
            player.vibeGuess = -1;
            player.vibeLocked = false;
        }

        // The target stays server-side; only the psychic learns it
        this.vibeTarget = Math.floor(Math.random() * 101);
        const client = this.clients.find(c => c.sessionId === psychicId);
        if (client) client.send('vibeTarget', this.vibeTarget);
    },

    revealVibeRound() {
        this.state.vibePhase = 'reveal';
        this.state.vibeDeadline = 0;
        this.state.vibeTarget = this.vibeTarget;

        const target = this.vibeTarget;
        const results = [];
        let best = 0;
        for (const [id, player] of this.state.players) {
            if (player.isSpectator || id === this.state.vibePsychicId) continue;
            if (player.vibeGuess < 0) continue;
            const diff = Math.abs(player.vibeGuess - target);
            let pts = 0;
            for (const band of VIBECHECK_CONFIG.bands) {
                if (diff <= band.within) { pts = band.pts; break; }
            }
            player.score += pts;
            if (pts > best) best = pts;
            results.push({
                id,
                playerName: player.playerName || 'Anonymous',
                guess: player.vibeGuess,
                pts,
            });
        }

        // The psychic scores as much as their best guesser did
        const psychic = this.state.players.get(this.state.vibePsychicId);
        if (psychic && !psychic.isSpectator) psychic.score += best;

        this.broadcast('vibeReveal', {
            target,
            psychicId: this.state.vibePsychicId,
            psychicPts: best,
            results,
        });
        if (best >= 4) this.broadcast('playLevelUpSound');
        else if (best > 0) this.broadcast('playEatSound');
        else this.broadcast('playDieSound');

        this.vibeRoundTimeout = setTimeout(() => {
            this.vibeRoundTimeout = null;
            if (this.state.phase !== 'playing' || this.state.gameType !== 'vibecheck') return;
            if (this.state.vibeRound >= this.state.vibeTotalRounds) {
                this.finishVibecheckGame();
            } else {
                this.startVibeRound(this.state.vibeRound + 1);
            }
        }, VIBECHECK_CONFIG.revealDelay);
    },

    finishVibecheckGame() {
        let bestScore = -1;
        let winner = '';
        let tie = false;
        for (const [id, player] of this.state.players) {
            if (player.isSpectator) continue;
            if (player.score > bestScore) {
                bestScore = player.score;
                winner = id;
                tie = false;
            } else if (player.score === bestScore) {
                tie = true;
            }
        }
        this.state.winnerId = tie || !winner ? 'draw' : winner;
        console.log(`Vibe Check over: ${this.state.winnerId} (${bestScore} pts)`);
        if (this.state.winnerId !== 'draw') this.broadcast('playWinSound');
        this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
    },

    updateVibecheckState() {
        if (this.state.winnerId) return;

        const active = [];
        for (const [id, p] of this.state.players) {
            if (!p.isSpectator) active.push(id);
        }

        if (active.length === 0) {
            // Only spectators left — nothing to watch, back to the lobby
            this.returnToLobby();
            return;
        }
        if (active.length === 1) {
            // Everyone else left mid-game: the last player standing wins
            this.state.winnerId = active[0];
            this.broadcast('playWinSound');
            if (this.vibeRoundTimeout) {
                clearTimeout(this.vibeRoundTimeout);
                this.vibeRoundTimeout = null;
            }
            this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
            return;
        }

        const now = Date.now();
        if (this.state.vibePhase === 'clue') {
            // Psychic left or idled out: hand the same round to the next psychic
            const psychic = this.state.players.get(this.state.vibePsychicId);
            if (!psychic || psychic.isSpectator || now > this.state.vibeDeadline) {
                this.startVibeRound(this.state.vibeRound);
            }
        } else if (this.state.vibePhase === 'guess') {
            let waiting = 0;
            for (const id of active) {
                if (id === this.state.vibePsychicId) continue;
                const p = this.state.players.get(id);
                if (p && !p.vibeLocked) waiting++;
            }
            if (waiting === 0 || now > this.state.vibeDeadline) {
                this.revealVibeRound();
            }
        }
        // 'reveal' advances via vibeRoundTimeout
    },
};

module.exports = { VIBECHECK_CONFIG, VIBECHECK_SCALES, vibecheckMethods };
