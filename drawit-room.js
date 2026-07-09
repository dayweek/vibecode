// ── Draw It configuration ───────────────────────────────────────────
// Pictionary-style party game: each round one player (the "drawer") gets
// a secret word and draws it on a shared canvas; everyone else types
// guesses. Faster correct guesses score more, and the drawer scores for
// every player who gets it.

const DRAWIT_CONFIG = {
    width: 960,
    height: 640,
    defaultRounds: 6,
    maxRounds: 10,
    minPlayers: 2,            // drawer + at least one guesser
    guessMaxLength: 40,
    drawPhaseMs: 75000,       // drawing/guessing time per round
    revealDelay: 5000,        // ms the reveal stays on screen between rounds
    hintAt: [0.4, 0.7],       // fraction of the round after which a letter is revealed
    // Correct guesses score by order: first right answer gets the most
    guessPoints: [5, 4, 3, 2],
    guessPointsMin: 1,
    drawerPtsPerGuess: 2,     // drawer reward per correct guesser
    // Stroke relay limits (per round, guards memory / message abuse)
    maxStrokes: 3000,
    maxPointsPerStroke: 256,
    maxBrushSize: 32,
};

// Drawable everyday nouns; multi-word entries show their spaces in the mask.
const DRAWIT_WORDS = [
    'apple', 'banana', 'pizza', 'hamburger', 'ice cream', 'cake', 'cheese',
    'carrot', 'mushroom', 'pancake', 'watermelon', 'popcorn', 'hot dog',
    'dog', 'cat', 'elephant', 'giraffe', 'penguin', 'butterfly', 'spider',
    'snail', 'shark', 'octopus', 'snake', 'turtle', 'owl', 'bee', 'crab',
    'whale', 'monkey', 'kangaroo', 'flamingo', 'hedgehog', 'jellyfish',
    'house', 'castle', 'bridge', 'lighthouse', 'windmill', 'igloo', 'tent',
    'pyramid', 'church', 'ferris wheel', 'roller coaster',
    'car', 'bicycle', 'helicopter', 'submarine', 'rocket', 'train',
    'sailboat', 'tractor', 'ambulance', 'skateboard', 'hot air balloon',
    'sun', 'moon', 'star', 'rainbow', 'cloud', 'lightning', 'tornado',
    'volcano', 'island', 'mountain', 'waterfall', 'cactus', 'palm tree',
    'snowman', 'campfire', 'fireworks',
    'guitar', 'piano', 'drum', 'violin', 'trumpet', 'microphone',
    'football', 'basketball', 'bowling', 'trophy', 'medal', 'dart',
    'glasses', 'umbrella', 'backpack', 'crown', 'ring', 'boot', 'scarf',
    'mitten', 'top hat',
    'toothbrush', 'scissors', 'hammer', 'ladder', 'candle', 'key',
    'anchor', 'telescope', 'magnet', 'robot', 'camera', 'television',
    'laptop', 'headphones', 'light bulb', 'clock', 'compass',
    'wizard', 'pirate', 'mermaid', 'vampire', 'angel', 'clown',
    'astronaut', 'cowboy', 'ninja', 'knight', 'ghost', 'dragon',
    'unicorn', 'zombie', 'scarecrow',
    'fishing', 'sleeping', 'dancing', 'swimming', 'juggling', 'sneeze',
    'birthday', 'wedding', 'haircut', 'yoga',
    'book', 'pencil', 'envelope', 'treasure map', 'dice', 'balloon',
    'kite', 'swing', 'slide', 'sandcastle', 'traffic light', 'stop sign',
    'fountain', 'maze', 'domino',
];

// ── Helpers ─────────────────────────────────────────────────────────

function drawitNormalize(str) {
    return String(str || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// True when a and b are within edit distance 1 ("so close!" feedback)
function drawitIsClose(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a === b) return false;
    if (a.length === b.length) {
        let diff = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
        return diff === 1;
    }
    const long = a.length > b.length ? a : b;
    const short = a.length > b.length ? b : a;
    let i = 0, j = 0, skipped = false;
    while (i < long.length && j < short.length) {
        if (long[i] === short[j]) { i++; j++; continue; }
        if (skipped) return false;
        skipped = true;
        i++;
    }
    return true;
}

// ── Draw It server logic ────────────────────────────────────────────
// Mixed into GameRoom.prototype (see game-room.js), so `this` is the room.

const drawitMethods = {

    registerDrawitMessages() {
        // Host configures how many rounds the game lasts
        this.onMessage('setDrawRounds', (client, rounds) => {
            if (this.state.phase !== 'lobby') return;
            if (client.sessionId !== this.state.hostId) return;
            const n = Math.floor(Number(rounds));
            if (!Number.isFinite(n) || n < 1 || n > DRAWIT_CONFIG.maxRounds) return;
            this.state.drawTotalRounds = n;
        });

        // The drawer sends a polyline chunk: { c: '#rrggbb', s: size, p: [x0,y0,x1,y1,...] }
        // Chunks are relayed as-is to everyone else and buffered for late joiners.
        this.onMessage('drawStroke', (client, data) => {
            if (!this.drawitIsDrawing(client)) return;
            if (!data || typeof data !== 'object') return;
            const c = String(data.c || '');
            if (!/^#[0-9a-fA-F]{6}$/.test(c)) return;
            const s = Math.round(Number(data.s));
            if (!Number.isFinite(s) || s < 1 || s > DRAWIT_CONFIG.maxBrushSize) return;
            const p = data.p;
            if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0) return;
            if (p.length > DRAWIT_CONFIG.maxPointsPerStroke * 2) return;
            if (this.drawStrokes.length >= DRAWIT_CONFIG.maxStrokes) return;
            const points = new Array(p.length);
            for (let i = 0; i < p.length; i++) {
                const v = Math.round(Number(p[i]));
                if (!Number.isFinite(v) || v < -50 || v > 1500) return;
                points[i] = v;
            }
            const stroke = { c, s, p: points };
            this.drawStrokes.push(stroke);
            this.broadcast('drawStroke', stroke, { except: client });

            const internal = this.playerInternal.get(client.sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        });

        // The drawer wipes the board
        this.onMessage('drawClear', (client) => {
            if (!this.drawitIsDrawing(client)) return;
            this.drawStrokes = [];
            this.broadcast('drawClear', {}, { except: client });
        });

        // A guesser submits a word guess
        this.onMessage('drawGuess', (client, text) => {
            if (this.state.gameType !== 'drawit' || this.state.phase !== 'playing') return;
            if (this.state.drawPhase !== 'draw' || this.state.winnerId) return;
            if (client.sessionId === this.state.drawDrawerId) return;
            const player = this.state.players.get(client.sessionId);
            if (!player || player.isSpectator || player.drawGuessed) return;
            const guess = drawitNormalize(text).substring(0, DRAWIT_CONFIG.guessMaxLength);
            if (!guess) return;

            const internal = this.playerInternal.get(client.sessionId);
            if (internal) internal.lastActivityTime = Date.now();

            const name = player.playerName || 'Anonymous';
            if (guess === this.drawWord) {
                // Points by answer order: 1st gets the most
                const order = this.drawCorrectCount++;
                const pts = DRAWIT_CONFIG.guessPoints[order] !== undefined
                    ? DRAWIT_CONFIG.guessPoints[order]
                    : DRAWIT_CONFIG.guessPointsMin;
                player.drawGuessed = true;
                player.score += pts;
                this.drawTurnPts.set(client.sessionId, pts);
                const drawer = this.state.players.get(this.state.drawDrawerId);
                if (drawer && !drawer.isSpectator) {
                    drawer.score += DRAWIT_CONFIG.drawerPtsPerGuess;
                    this.drawTurnPts.set(this.state.drawDrawerId,
                        (this.drawTurnPts.get(this.state.drawDrawerId) || 0) + DRAWIT_CONFIG.drawerPtsPerGuess);
                }
                this.broadcast('drawFeed', { name, correct: true, pts });
            } else {
                // Wrong guesses are public banter; near-misses get a private nudge
                this.broadcast('drawFeed', { name, text: guess });
                if (drawitIsClose(guess, this.drawWord)) {
                    client.send('drawFeed', { name: '', close: true, text: `"${guess}" is so close!` });
                }
            }
        });
    },

    drawitIsDrawing(client) {
        return this.state.gameType === 'drawit' && this.state.phase === 'playing'
            && this.state.drawPhase === 'draw' && !this.state.winnerId
            && client.sessionId === this.state.drawDrawerId;
    },

    startDrawitGame() {
        console.log('Starting Draw It game...');
        this.clearGameObjects();
        this.clearBoard();

        this.state.gridWidth = DRAWIT_CONFIG.width;
        this.state.gridHeight = DRAWIT_CONFIG.height;
        this.participantsAtStart = this.state.players.size;

        const participantIds = [];
        for (const [sessionId, player] of this.state.players) {
            player.isSpectator = false;
            player.ready = false;
            player.alive = true;
            player.killedBy = '';
            player.isMoving = false;
            player.score = 0;
            player.drawGuessed = false;
            participantIds.push(sessionId);
            const internal = this.playerInternal.get(sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        }

        // Shuffled word pool (refilled if a long game runs out)
        this.drawWordPool = this.shuffledDrawWords();

        // Drawer role rotates through a shuffled seating order
        for (let i = participantIds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [participantIds[i], participantIds[j]] = [participantIds[j], participantIds[i]];
        }
        this.drawOrder = participantIds;
        this.drawIdx = -1;

        this.startDrawRound(1);
        this.state.phase = 'playing';
        this.updateMetadata();
    },

    shuffledDrawWords() {
        const pool = DRAWIT_WORDS.slice();
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool;
    },

    // Advance the rotation to the next drawer still in the game
    drawNextDrawer() {
        const order = this.drawOrder;
        for (let step = 1; step <= order.length; step++) {
            const idx = (this.drawIdx + step) % order.length;
            const p = this.state.players.get(order[idx]);
            if (p && !p.isSpectator) {
                this.drawIdx = idx;
                return order[idx];
            }
        }
        return '';
    },

    startDrawRound(round) {
        const drawerId = this.drawNextDrawer();
        if (!drawerId) return; // update loop handles empty rooms

        if (this.drawWordPool.length === 0) this.drawWordPool = this.shuffledDrawWords();
        const word = this.drawWordPool.pop();

        this.state.drawRound = round;
        this.state.drawDrawerId = drawerId;
        this.state.drawWord = '';
        this.state.drawMasked = word.replace(/[^ ]/g, '_');
        this.state.drawPhase = 'draw';
        this.state.drawDeadline = Date.now() + DRAWIT_CONFIG.drawPhaseMs;

        for (const [, player] of this.state.players) {
            player.drawGuessed = false;
        }

        this.drawStrokes = [];
        this.drawCorrectCount = 0;
        this.drawTurnPts = new Map();
        this.drawHintTimes = DRAWIT_CONFIG.hintAt.map(f => Date.now() + DRAWIT_CONFIG.drawPhaseMs * f);
        this.broadcast('drawClear', {});

        // The word stays server-side; only the drawer learns it
        this.drawWord = word;
        const client = this.clients.find(c => c.sessionId === drawerId);
        if (client) client.send('drawWord', word);
    },

    // Reveal one hidden letter in the mask (keeps at least one hidden)
    drawRevealHint() {
        const word = this.drawWord;
        const mask = this.state.drawMasked.split('');
        const hidden = [];
        for (let i = 0; i < mask.length; i++) {
            if (mask[i] === '_') hidden.push(i);
        }
        if (hidden.length <= 1) return;
        const idx = hidden[Math.floor(Math.random() * hidden.length)];
        mask[idx] = word[idx];
        this.state.drawMasked = mask.join('');
    },

    revealDrawRound() {
        this.state.drawPhase = 'reveal';
        this.state.drawDeadline = 0;
        this.state.drawWord = this.drawWord;
        this.state.drawMasked = this.drawWord;

        const results = [];
        for (const [id, pts] of this.drawTurnPts) {
            const p = this.state.players.get(id);
            results.push({ id, playerName: p ? (p.playerName || 'Anonymous') : 'Anonymous', pts });
        }
        this.broadcast('drawReveal', {
            word: this.drawWord,
            drawerId: this.state.drawDrawerId,
            results,
        });

        this.drawRoundTimeout = setTimeout(() => {
            this.drawRoundTimeout = null;
            if (this.state.phase !== 'playing' || this.state.gameType !== 'drawit') return;
            if (this.state.drawRound >= this.state.drawTotalRounds) {
                this.finishDrawitGame();
            } else {
                this.startDrawRound(this.state.drawRound + 1);
            }
        }, DRAWIT_CONFIG.revealDelay);
    },

    finishDrawitGame() {
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
        console.log(`Draw It over: ${this.state.winnerId} (${bestScore} pts)`);
        this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
    },

    updateDrawitState() {
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
            if (this.drawRoundTimeout) {
                clearTimeout(this.drawRoundTimeout);
                this.drawRoundTimeout = null;
            }
            this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
            return;
        }

        if (this.state.drawPhase !== 'draw') return; // 'reveal' advances via drawRoundTimeout

        // Drawer left: hand the same round to the next drawer
        const drawer = this.state.players.get(this.state.drawDrawerId);
        if (!drawer || drawer.isSpectator) {
            this.startDrawRound(this.state.drawRound);
            return;
        }

        const now = Date.now();
        while (this.drawHintTimes.length && now >= this.drawHintTimes[0]) {
            this.drawHintTimes.shift();
            this.drawRevealHint();
        }

        let waiting = 0;
        for (const id of active) {
            if (id === this.state.drawDrawerId) continue;
            const p = this.state.players.get(id);
            if (p && !p.drawGuessed) waiting++;
        }
        if (waiting === 0 || now > this.state.drawDeadline) {
            this.revealDrawRound();
        }
    },
};

module.exports = { DRAWIT_CONFIG, DRAWIT_WORDS, drawitMethods };
