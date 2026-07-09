// ── Draw It client: state sync, rendering and input ────────────────
// Loaded alongside game-sketch.js (shared globals, p5 global mode).
// One player (the drawer) gets a secret word and draws it on a shared
// board; everyone else types guesses into an HTML input under the canvas.

// Draw It state (synced from server)
let drawit = {
    phase: '', drawerId: '', masked: '', word: '',
    round: 0, totalRounds: 6, deadline: 0,
};
let myDrawWord = null;    // sent privately to the drawer each round
let drawitReveal = null;  // { word, drawerId, results } from the server
let drawFeed = [];        // guess feed entries { name, text, correct, pts, close }
let _drawSyncedRound = 0;
let _drawGuessBarVisible = null;

// Board geometry on the 960x640 canvas (strokes are in board-space coords)
const DRAW_BOARD = { x: 190, y: 92, w: 580, h: 440 };
const DRAW_FEED_X = 785;

// Drawer tools
const DRAW_COLORS = [
    '#000000', '#e63946', '#ff8c37', '#ffd23f', '#4caf50',
    '#1f77ff', '#8e44ad', '#8d5a2b', '#ffffff', // white = eraser
];
const DRAW_SIZES = [4, 10, 22];
const DRAW_PALETTE_Y = 544;
let drawTool = { color: '#000000', size: 4 };

// Offscreen buffer holding the picture so far (created lazily after setup)
let drawBoardG = null;

// In-progress stroke by the local drawer
let _drawCurrent = null;   // { last: {x, y} }
let _drawPending = [];     // flat [x0,y0,x1,y1,...] not yet sent

function ensureDrawBoard() {
    if (!drawBoardG) {
        drawBoardG = createGraphics(DRAW_BOARD.w, DRAW_BOARD.h);
    }
    return drawBoardG;
}

function drawitClearBoard() {
    const g = ensureDrawBoard();
    g.background(255);
}

// Paint a polyline chunk { c, s, p } into the board buffer
function drawitApplyStroke(stroke) {
    if (!stroke || !Array.isArray(stroke.p) || stroke.p.length < 2) return;
    const g = ensureDrawBoard();
    g.stroke(stroke.c);
    g.strokeWeight(stroke.s);
    g.noFill();
    const p = stroke.p;
    if (p.length === 2 || (p.length === 4 && p[0] === p[2] && p[1] === p[3])) {
        // Single tap: a round dot
        g.noStroke();
        g.fill(stroke.c);
        g.ellipse(p[0], p[1], stroke.s, stroke.s);
        return;
    }
    for (let i = 2; i < p.length; i += 2) {
        g.line(p[i - 2], p[i - 1], p[i], p[i + 1]);
    }
}

// Called from room.onStateChange in game-sketch.js
function syncDrawitState(state) {
    drawit.phase = state.drawPhase || '';
    drawit.drawerId = state.drawDrawerId || '';
    drawit.masked = state.drawMasked || '';
    drawit.word = state.drawWord || '';
    drawit.round = state.drawRound || 0;
    drawit.totalRounds = state.drawTotalRounds || 6;
    drawit.deadline = state.drawDeadline || 0;

    // New round: clear last round's leftovers. The private 'drawWord'
    // message can arrive before this patch, so only clear the word when
    // the new drawer is someone else.
    if (drawit.round !== _drawSyncedRound) {
        _drawSyncedRound = drawit.round;
        if (drawit.drawerId !== playerId) myDrawWord = null;
        drawitReveal = null;
        _drawCurrent = null;
        _drawPending = [];
        if (drawBoardG) drawitClearBoard();
    }
}

// Called from connectToRoom in game-sketch.js
function setupDrawitMessages(joinedRoom) {
    joinedRoom.onMessage('drawWord', (word) => {
        myDrawWord = word;
    });
    joinedRoom.onMessage('drawStroke', (stroke) => {
        drawitApplyStroke(stroke);
    });
    joinedRoom.onMessage('drawClear', () => {
        drawitClearBoard();
    });
    // Full board history for players who join mid-round
    joinedRoom.onMessage('drawInit', (data) => {
        drawitClearBoard();
        if (data && Array.isArray(data.strokes)) {
            for (const s of data.strokes) drawitApplyStroke(s);
        }
    });
    joinedRoom.onMessage('drawFeed', (entry) => {
        if (!entry) return;
        drawFeed.push(entry);
        if (drawFeed.length > 40) drawFeed.shift();
    });
    joinedRoom.onMessage('drawReveal', (data) => {
        drawitReveal = data || null;
    });
}

// Guesses are typed into an HTML input under the canvas (mobile keyboards
// need a real input element); shown to guessers during the 'draw' phase.
(function initDrawGuessBar() {
    const input = document.getElementById('draw-guess-input');
    const sendBtn = document.getElementById('draw-guess-send');
    if (!input || !sendBtn) return;

    const send = () => {
        if (!room || gameType !== 'drawit' || gamePhase !== 'playing') return;
        if (drawit.phase !== 'draw' || drawit.drawerId === playerId) return;
        const guess = input.value.trim();
        if (!guess) return;
        room.send('drawGuess', guess);
        input.value = '';
        input.focus();
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') send();
    });
})();

// Show/hide the guess input; called every frame from draw() in game-sketch.js
// so it also disappears when the game ends or another game starts.
function drawUpdateGuessBar() {
    const bar = document.getElementById('draw-guess-bar');
    if (!bar) return;
    const me = players.get(playerId);
    const show = gameType === 'drawit' && gamePhase === 'playing'
        && drawit.phase === 'draw' && drawit.drawerId !== playerId && !winnerId
        && !!(me && !me.isSpectator && !me.drawGuessed);
    if (show === _drawGuessBarVisible) return;
    _drawGuessBarVisible = show;
    bar.style.display = show ? 'flex' : 'none';
    if (show) {
        const input = document.getElementById('draw-guess-input');
        if (input) { input.value = ''; input.focus(); }
    }
}

// ── Rendering ───────────────────────────────────────────────────────

function drawDrawitGame() {
    background(33, 26, 48);
    const me = players.get(playerId);
    const amDrawer = drawit.drawerId === playerId;
    const drawer = players.get(drawit.drawerId);
    const drawerName = amDrawer
        ? 'You'
        : (drawer && drawer.playerName ? drawer.playerName : 'Someone');

    // Header: round + drawer banner
    noStroke();
    textAlign(CENTER, CENTER);
    fill(242, 233, 220);
    textSize(20);
    text(`Draw It — Round ${drawit.round} / ${drawit.totalRounds}`, width / 2, 26);

    if (!winnerId) {
        fill(255, 180, 55);
        textSize(18);
        if (drawit.phase === 'draw') {
            text(amDrawer ? 'You are drawing!' : `${drawerName} is drawing...`, width / 2, 52);
        } else if (drawit.phase === 'reveal') {
            text('Round over!', width / 2, 52);
        }
    }

    drawitCountdown();
    drawitScores();
    drawitWordLine(amDrawer);

    // The board itself
    ensureDrawBoard();
    image(drawBoardG, DRAW_BOARD.x, DRAW_BOARD.y);
    noFill();
    stroke(13, 7, 20);
    strokeWeight(3);
    rect(DRAW_BOARD.x, DRAW_BOARD.y, DRAW_BOARD.w, DRAW_BOARD.h);
    noStroke();

    drawitFeed();

    if (drawit.phase === 'draw') {
        if (amDrawer && !winnerId) {
            drawitFlushPending(false);
            drawitPalette();
        } else {
            drawitGuessStatus(me);
        }
        drawitGuessedCounter();
    } else if (drawit.phase === 'reveal') {
        drawitRevealOverlay();
    }

    drawitCursor(amDrawer);
    drawUpdateGuessBar();

    if (winnerId) drawWinnerMessage();
}

function drawitCountdown() {
    if (!drawit.deadline || winnerId) return;
    const secs = Math.max(0, Math.ceil((drawit.deadline - Date.now()) / 1000));
    fill(secs <= 10 ? color(255, 91, 59) : color(157, 143, 174));
    textAlign(RIGHT, CENTER);
    textSize(20);
    text(`${secs}s`, width - 24, 26);
    textAlign(CENTER, CENTER);
}

// Running totals, top-left like the other games' scoreboards
function drawitScores() {
    textAlign(LEFT, CENTER);
    textSize(17);
    let y = 60;
    players.forEach((p, id) => {
        if (p.isSpectator) return;
        fill(p.color || '#f2e9dc');
        const drawerMark = id === drawit.drawerId && !winnerId ? ' ✏️' : '';
        const guessedMark = p.drawGuessed && drawit.phase === 'draw' ? ' ✔' : '';
        text(`${p.playerName || 'Anonymous'}${id === playerId ? ' (you)' : ''}: ${p.score || 0}${drawerMark}${guessedMark}`, 14, y);
        y += 21;
    });
    textAlign(CENTER, CENTER);
}

// The word line above the board: real word for the drawer, mask for the rest
function drawitWordLine(amDrawer) {
    if (winnerId) return;
    textSize(24);
    const wordY = DRAW_BOARD.y - 16;
    if (drawit.phase === 'reveal') {
        fill(126, 224, 78);
        const word = drawit.word || (drawitReveal ? drawitReveal.word : '');
        text(`The word was: ${word}`, width / 2, wordY);
    } else if (amDrawer && myDrawWord) {
        fill(255, 180, 55);
        text(`Draw: ${myDrawWord}`, width / 2, wordY);
    } else if (drawit.masked) {
        fill(242, 233, 220);
        text(drawit.masked.split('').join(' '), width / 2, wordY);
        fill(157, 143, 174);
        textSize(14);
        textAlign(RIGHT, CENTER);
        text(`${drawit.masked.replace(/ /g, '').length} letters`, DRAW_BOARD.x + DRAW_BOARD.w, wordY);
        textAlign(CENTER, CENTER);
    }
}

// Guess feed on the right of the board (latest at the bottom)
function drawitFeed() {
    const maxRows = Math.floor((DRAW_BOARD.h - 10) / 20);
    const entries = drawFeed.slice(-maxRows);
    textAlign(LEFT, CENTER);
    textSize(14);
    let y = DRAW_BOARD.y + 12;
    for (const e of entries) {
        let label;
        if (e.correct) {
            fill(126, 224, 78);
            label = `${e.name} got it! +${e.pts}`;
        } else if (e.close) {
            fill(255, 180, 55);
            label = e.text;
        } else {
            fill(157, 143, 174);
            label = `${e.name}: ${e.text}`;
        }
        if (label.length > 24) label = label.substring(0, 23) + '…';
        text(label, DRAW_FEED_X, y);
        y += 20;
    }
    textAlign(CENTER, CENTER);
}

// Color swatches + brush sizes + clear button under the board (drawer only)
function drawitPaletteLayout() {
    const items = [];
    let x = DRAW_BOARD.x;
    const y = DRAW_PALETTE_Y;
    for (const c of DRAW_COLORS) {
        items.push({ kind: 'color', value: c, x, y, w: 32, h: 32 });
        x += 38;
    }
    x += 8;
    for (const s of DRAW_SIZES) {
        items.push({ kind: 'size', value: s, x, y, w: 32, h: 32 });
        x += 38;
    }
    x += 8;
    items.push({ kind: 'clear', x, y, w: 76, h: 32 });
    return items;
}

function drawitPalette() {
    const m = canvasMouse();
    for (const it of drawitPaletteLayout()) {
        const hover = m.x >= it.x && m.x <= it.x + it.w && m.y >= it.y && m.y <= it.y + it.h;
        const active = (it.kind === 'color' && drawTool.color === it.value)
            || (it.kind === 'size' && drawTool.size === it.value);
        stroke(active ? color(255, 180, 55) : color(13, 7, 20));
        strokeWeight(active ? 4 : 2);
        if (it.kind === 'color') {
            fill(it.value);
            rect(it.x, it.y, it.w, it.h);
        } else if (it.kind === 'size') {
            fill(hover ? 74 : 59, 45, 73);
            rect(it.x, it.y, it.w, it.h);
            noStroke();
            fill(242, 233, 220);
            ellipse(it.x + it.w / 2, it.y + it.h / 2, it.value, it.value);
        } else {
            fill(hover ? color(255, 122, 96) : color(255, 91, 59));
            rect(it.x, it.y, it.w, it.h);
            noStroke();
            fill(42, 10, 2);
            textSize(16);
            text('CLEAR', it.x + it.w / 2, it.y + it.h / 2 + 1);
        }
        noStroke();
    }
}

function drawitGuessStatus(me) {
    fill(157, 143, 174);
    textSize(18);
    if (me && me.drawGuessed) {
        fill(126, 224, 78);
        text('You got it! Waiting for the others...', width / 2, DRAW_PALETTE_Y + 16);
    } else if (me && me.isSpectator) {
        text('Spectating — watch them scribble.', width / 2, DRAW_PALETTE_Y + 16);
    } else {
        text('Type your guess below the board.', width / 2, DRAW_PALETTE_Y + 16);
    }
}

function drawitGuessedCounter() {
    let guessers = 0, got = 0;
    players.forEach((p, id) => {
        if (p.isSpectator || id === drawit.drawerId) return;
        guessers++;
        if (p.drawGuessed) got++;
    });
    fill(157, 143, 174);
    textSize(16);
    text(`${got} / ${guessers} guessed it`, width / 2, DRAW_PALETTE_Y + 44);
}

function drawitRevealOverlay() {
    // Per-player points scored this round
    if (!drawitReveal) return;
    textSize(18);
    let y = DRAW_PALETTE_Y + 4;
    const sorted = drawitReveal.results.slice().sort((a, b) => b.pts - a.pts);
    if (sorted.length === 0) {
        fill(255, 91, 59);
        text('Nobody guessed it!', width / 2, y + 12);
        return;
    }
    textAlign(CENTER, CENTER);
    let line = sorted.slice(0, 5).map(r =>
        `${r.playerName}${r.id === playerId ? ' (you)' : ''}${r.id === drawitReveal.drawerId ? ' ✏️' : ''} +${r.pts}`
    ).join('   ·   ');
    fill(126, 224, 78);
    text(line, width / 2, y + 12);
}

function drawitCursor(amDrawer) {
    if (winnerId || drawit.phase !== 'draw') { cursor(ARROW); return; }
    const m = canvasMouse();
    const onBoard = m.x >= DRAW_BOARD.x && m.x <= DRAW_BOARD.x + DRAW_BOARD.w
        && m.y >= DRAW_BOARD.y && m.y <= DRAW_BOARD.y + DRAW_BOARD.h;
    if (amDrawer && onBoard) cursor(CROSS);
    else cursor(ARROW);
}

// ── Input (dispatched from mouse handlers in game-sketch.js) ────────

function drawitCanDraw() {
    return !winnerId && drawit.phase === 'draw' && drawit.drawerId === playerId;
}

function drawitBoardPoint(m) {
    const x = m.x - DRAW_BOARD.x;
    const y = m.y - DRAW_BOARD.y;
    if (x < -10 || x > DRAW_BOARD.w + 10 || y < -10 || y > DRAW_BOARD.h + 10) return null;
    return {
        x: Math.round(Math.max(0, Math.min(DRAW_BOARD.w, x))),
        y: Math.round(Math.max(0, Math.min(DRAW_BOARD.h, y))),
    };
}

// Send buffered points; `force` also flushes short chunks (on mouse release)
function drawitFlushPending(force) {
    if (!room || _drawPending.length < 4) return;
    if (!force && _drawPending.length < 16) return;
    room.send('drawStroke', { c: drawTool.color, s: drawTool.size, p: _drawPending });
    // Next chunk continues from the last sent point
    _drawPending = _drawPending.slice(-2);
}

function drawitMousePressed() {
    if (!drawitCanDraw()) return true;
    const m = canvasMouse();

    // Palette buttons
    for (const it of drawitPaletteLayout()) {
        if (m.x >= it.x && m.x <= it.x + it.w && m.y >= it.y && m.y <= it.y + it.h) {
            if (it.kind === 'color') drawTool.color = it.value;
            else if (it.kind === 'size') drawTool.size = it.value;
            else if (it.kind === 'clear') {
                drawitClearBoard();
                room.send('drawClear');
            }
            return false;
        }
    }

    const p = drawitBoardPoint(m);
    if (!p) return true;
    _drawCurrent = { last: p };
    _drawPending = [p.x, p.y];
    // A tap paints a dot right away
    const dot = { c: drawTool.color, s: drawTool.size, p: [p.x, p.y, p.x, p.y] };
    drawitApplyStroke(dot);
    room.send('drawStroke', dot);
    return false;
}

function drawitMouseDragged() {
    if (!drawitCanDraw() || !_drawCurrent) return true;
    const p = drawitBoardPoint(canvasMouse());
    if (!p) return false;
    const last = _drawCurrent.last;
    if (p.x === last.x && p.y === last.y) return false;
    drawitApplyStroke({ c: drawTool.color, s: drawTool.size, p: [last.x, last.y, p.x, p.y] });
    _drawPending.push(p.x, p.y);
    _drawCurrent.last = p;
    drawitFlushPending(false);
    return false;
}

function drawitMouseReleased() {
    if (!_drawCurrent) return true;
    drawitFlushPending(true);
    _drawCurrent = null;
    _drawPending = [];
    return true;
}
