// ── Vibe Check client: state sync, rendering and input ─────────────
// Loaded alongside game-sketch.js (shared globals, p5 global mode).
// One player (the psychic) sees a secret spot on a scale, types a clue,
// and everyone else drags a marker to where they think the spot is.

// Vibe Check state (synced from server)
let vibe = {
    phase: '', scaleLeft: '', scaleRight: '', clue: '', psychicId: '',
    round: 0, totalRounds: 5, target: -1, deadline: 0,
};
let myVibeTarget = null;   // sent privately to the psychic each round
let vibeReveal = null;     // { target, psychicId, psychicPts, results } from the server
let _vibeLastSentGuess = null;
let _vibeSyncedRound = 0;
let _vibeClueBarVisible = null;

// Scale bar geometry on the 960x640 canvas
const VIBE_BAR = { x0: 150, x1: 810, y: 330, h: 20 };
const VIBE_LOCK_BTN = { x: 480 - 90, y: 408, w: 180, h: 46 };

// Reveal scoring zones drawn around the target, widest first
const VIBE_ZONES = [
    { within: 25, col: [157, 143, 174, 70] },   // 1 pt
    { within: 15, col: [77, 166, 255, 90] },    // 2 pts
    { within: 8, col: [126, 224, 78, 110] },    // 3 pts
    { within: 3, col: [255, 180, 55, 160] },    // 4 pts
];

// Called from room.onStateChange in game-sketch.js
function syncVibecheckState(state) {
    vibe.phase = state.vibePhase || '';
    vibe.scaleLeft = state.vibeScaleLeft || '';
    vibe.scaleRight = state.vibeScaleRight || '';
    vibe.clue = state.vibeClue || '';
    vibe.psychicId = state.vibePsychicId || '';
    vibe.round = state.vibeRound || 0;
    vibe.totalRounds = state.vibeTotalRounds || 5;
    vibe.target = (state.vibeTarget === undefined || state.vibeTarget === null) ? -1 : state.vibeTarget;
    vibe.deadline = state.vibeDeadline || 0;

    // New round: clear last round's leftovers
    if (vibe.round !== _vibeSyncedRound) {
        _vibeSyncedRound = vibe.round;
        _vibeLastSentGuess = null;
        vibeReveal = null;
        if (vibe.psychicId !== playerId) myVibeTarget = null;
    }
}

// Called from connectToRoom in game-sketch.js
function setupVibecheckMessages(joinedRoom) {
    joinedRoom.onMessage('vibeTarget', (target) => {
        myVibeTarget = target;
    });
    joinedRoom.onMessage('vibeReveal', (data) => {
        vibeReveal = data || null;
    });
}

// The clue is typed into an HTML input under the canvas (mobile keyboards
// need a real input element); shown only to the psychic during 'clue'.
(function initVibeClueBar() {
    const input = document.getElementById('vibe-clue-input');
    const sendBtn = document.getElementById('vibe-clue-send');
    if (!input || !sendBtn) return;

    const send = () => {
        if (!room || gameType !== 'vibecheck' || gamePhase !== 'playing') return;
        if (vibe.phase !== 'clue' || vibe.psychicId !== playerId) return;
        const clue = input.value.trim();
        if (!clue) return;
        room.send('vibeClue', clue);
        input.value = '';
        input.blur();
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') send();
    });
})();

// Show/hide the clue input; called every frame from draw() in game-sketch.js
// so it also disappears when the game ends or another game starts.
function vibeUpdateClueBar() {
    const bar = document.getElementById('vibe-clue-bar');
    if (!bar) return;
    const show = gameType === 'vibecheck' && gamePhase === 'playing'
        && vibe.phase === 'clue' && vibe.psychicId === playerId && !winnerId;
    if (show === _vibeClueBarVisible) return;
    _vibeClueBarVisible = show;
    bar.style.display = show ? 'flex' : 'none';
    if (show) {
        const input = document.getElementById('vibe-clue-input');
        if (input) { input.value = ''; input.focus(); }
    }
}

// ── Rendering ───────────────────────────────────────────────────────

function drawVibecheckGame() {
    background(33, 26, 48);
    const me = players.get(playerId);
    const psychic = players.get(vibe.psychicId);
    const psychicName = vibe.psychicId === playerId
        ? 'You'
        : (psychic && psychic.playerName ? psychic.playerName : 'Someone');

    // Header: round + phase banner
    noStroke();
    textAlign(CENTER, CENTER);
    fill(242, 233, 220);
    textSize(20);
    text(`Vibe Check — Round ${vibe.round} / ${vibe.totalRounds}`, width / 2, 26);

    if (!winnerId) {
        fill(255, 180, 55);
        textSize(22);
        if (vibe.phase === 'clue') {
            text(vibe.psychicId === playerId
                ? 'You are the psychic — describe the secret spot!'
                : `${psychicName} is the psychic — thinking of a clue...`, width / 2, 62);
        } else if (vibe.phase === 'guess') {
            text(`${psychicName}${vibe.psychicId === playerId ? ' (you) gave' : ' gave'} the clue:`, width / 2, 62);
        } else if (vibe.phase === 'reveal') {
            text('The reveal!', width / 2, 62);
        }
    }

    // The clue, big and centered
    if (vibe.clue && (vibe.phase === 'guess' || vibe.phase === 'reveal')) {
        fill(242, 233, 220);
        textSize(34);
        text(`“${vibe.clue}”`, width / 2, 116);
    }

    drawVibeCountdown();
    drawVibeScores();
    drawVibeScale();

    if (vibe.phase === 'clue') {
        drawVibeCluePhase(me);
    } else if (vibe.phase === 'guess') {
        drawVibeGuessPhase(me);
    } else if (vibe.phase === 'reveal') {
        drawVibeRevealPhase();
    }

    vibeUpdateClueBar();

    if (winnerId) drawWinnerMessage();
}

function drawVibeCountdown() {
    if (!vibe.deadline || winnerId) return;
    const secs = Math.max(0, Math.ceil((vibe.deadline - Date.now()) / 1000));
    fill(secs <= 10 ? color(255, 91, 59) : color(157, 143, 174));
    textAlign(RIGHT, CENTER);
    textSize(20);
    text(`${secs}s`, width - 24, 26);
    textAlign(CENTER, CENTER);
}

// Running totals, top-left like the snake scoreboard
function drawVibeScores() {
    textAlign(LEFT, CENTER);
    textSize(17);
    let y = 24;
    players.forEach((p, id) => {
        if (p.isSpectator) return;
        fill(p.color || '#f2e9dc');
        const psychicMark = id === vibe.psychicId && !winnerId ? ' 🔮' : '';
        text(`${p.playerName || 'Anonymous'}${id === playerId ? ' (you)' : ''}: ${p.score || 0}${psychicMark}`, 20, y);
        y += 21;
    });
    textAlign(CENTER, CENTER);
}

function vibeScaleX(value) {
    return VIBE_BAR.x0 + (VIBE_BAR.x1 - VIBE_BAR.x0) * (value / 100);
}

// The scale itself: gradient bar with the two concept labels at its ends
function drawVibeScale() {
    const { x0, x1, y, h } = VIBE_BAR;

    // Gradient from cool blue (left) to warm orange (right)
    const cLeft = color(77, 166, 255);
    const cRight = color(255, 140, 55);
    noStroke();
    for (let x = x0; x <= x1; x++) {
        fill(lerpColor(cLeft, cRight, (x - x0) / (x1 - x0)));
        rect(x, y, 1, h);
    }
    noFill();
    stroke(13, 7, 20);
    strokeWeight(3);
    rect(x0, y, x1 - x0, h);
    noStroke();

    // End labels
    textSize(22);
    fill(77, 166, 255);
    textAlign(LEFT, CENTER);
    text(`◀ ${vibe.scaleLeft}`, x0, y - 34);
    fill(255, 140, 55);
    textAlign(RIGHT, CENTER);
    text(`${vibe.scaleRight} ▶`, x1, y - 34);
    textAlign(CENTER, CENTER);
}

// A player's marker: a pin pointing down at the guess, name underneath
function drawVibeMarker(value, col, label, slot) {
    const x = vibeScaleX(value);
    const { y, h } = VIBE_BAR;

    stroke(13, 7, 20);
    strokeWeight(2);
    fill(col);
    triangle(x - 9, y - 22, x + 9, y - 22, x, y - 4);
    noStroke();

    if (label) {
        // Alternate label rows so nearby markers don't overlap as much
        const labelY = y + h + 16 + (slot % 3) * 18;
        fill(col);
        textSize(15);
        text(label, x, labelY);
    }
}

// The secret target: a tall gold marker (psychic during the round,
// everyone during the reveal)
function drawVibeTarget(value) {
    const x = vibeScaleX(value);
    const { y, h } = VIBE_BAR;
    stroke(255, 180, 55);
    strokeWeight(4);
    line(x, y - 30, x, y + h + 8);
    noStroke();
    fill(255, 180, 55);
    triangle(x - 10, y - 44, x + 10, y - 44, x, y - 28);
}

function drawVibeCluePhase(me) {
    if (vibe.psychicId === playerId && myVibeTarget !== null) {
        drawVibeTarget(myVibeTarget);
        fill(157, 143, 174);
        textSize(19);
        text('Type a clue below that sits exactly at the gold marker.', width / 2, 440);
        text('Everyone else will guess where on the scale it is.', width / 2, 466);
    } else {
        fill(157, 143, 174);
        textSize(19);
        const who = me && me.isSpectator ? 'The psychic is' : 'Wait for the clue —';
        text(`${who} looking at a secret spot on this scale...`, width / 2, 440);
    }
}

function drawVibeGuessPhase(me) {
    // The psychic still sees where the target is while others guess
    if (vibe.psychicId === playerId && myVibeTarget !== null) {
        drawVibeTarget(myVibeTarget);
    }

    // Everyone's markers, live
    let slot = 0;
    let guessers = 0;
    let locked = 0;
    players.forEach((p, id) => {
        if (p.isSpectator || id === vibe.psychicId) return;
        guessers++;
        if (p.vibeLocked) locked++;
        if (p.vibeGuess >= 0) {
            const label = `${p.playerName || 'Anonymous'}${id === playerId ? ' (you)' : ''}${p.vibeLocked ? ' 🔒' : ''}`;
            drawVibeMarker(p.vibeGuess, p.color || '#f2e9dc', label, slot);
            slot++;
        }
    });

    const canGuess = vibecheckCanGuess();
    if (canGuess) {
        fill(157, 143, 174);
        textSize(19);
        if (me.vibeGuess < 0) {
            text('Click the scale to place your marker.', width / 2, 490);
        } else {
            drawVibeLockButton();
            text('Drag to adjust, then lock in.', width / 2, 490);
        }
    } else if (me && !me.isSpectator && me.vibeLocked) {
        fill(126, 224, 78);
        textSize(19);
        text('Locked in — waiting for the others...', width / 2, 490);
    } else if (vibe.psychicId === playerId) {
        fill(157, 143, 174);
        textSize(19);
        text('Now watch them argue about your clue...', width / 2, 490);
    }

    fill(157, 143, 174);
    textSize(17);
    text(`${locked} / ${guessers} locked in`, width / 2, 522);
}

function drawVibeLockButton() {
    const b = VIBE_LOCK_BTN;
    const m = canvasMouse();
    const hover = m.x >= b.x && m.x <= b.x + b.w && m.y >= b.y && m.y <= b.y + b.h;

    stroke(13, 7, 20);
    strokeWeight(3);
    fill(hover ? color(147, 234, 103) : color(126, 224, 78));
    rect(b.x, b.y, b.w, b.h);
    noStroke();
    fill(15, 42, 5);
    textSize(20);
    text('LOCK IN', b.x + b.w / 2, b.y + b.h / 2);
    if (hover) cursor(HAND); else cursor(ARROW);
}

function drawVibeRevealPhase() {
    const target = vibe.target >= 0 ? vibe.target : (vibeReveal ? vibeReveal.target : -1);
    if (target < 0) return;

    // Scoring zones around the target, widest (1 pt) to narrowest (4 pts)
    const { x0, x1, y, h } = VIBE_BAR;
    noStroke();
    for (const zone of VIBE_ZONES) {
        const zx0 = vibeScaleX(Math.max(0, target - zone.within));
        const zx1 = vibeScaleX(Math.min(100, target + zone.within));
        fill(zone.col[0], zone.col[1], zone.col[2], zone.col[3]);
        rect(zx0, y - 8, zx1 - zx0, h + 16);
    }
    drawVibeTarget(target);

    // Everyone's final markers
    let slot = 0;
    players.forEach((p, id) => {
        if (p.isSpectator || id === vibe.psychicId || p.vibeGuess < 0) return;
        drawVibeMarker(p.vibeGuess, p.color || '#f2e9dc',
            `${p.playerName || 'Anonymous'}${id === playerId ? ' (you)' : ''}`, slot);
        slot++;
    });

    // Round results
    if (vibeReveal) {
        textSize(19);
        let y2 = 470;
        const sorted = vibeReveal.results.slice().sort((a, b) => b.pts - a.pts);
        for (const r of sorted.slice(0, 6)) {
            const p = players.get(r.id);
            fill(p && p.color ? p.color : '#f2e9dc');
            text(`${r.playerName}${r.id === playerId ? ' (you)' : ''} — ${r.pts > 0 ? '+' + r.pts : 'no'} pts`, width / 2, y2);
            y2 += 24;
        }
        const psychic = players.get(vibeReveal.psychicId);
        fill(255, 180, 55);
        text(`Psychic ${psychic && psychic.playerName ? psychic.playerName : 'Someone'}` +
            `${vibeReveal.psychicId === playerId ? ' (you)' : ''} — +${vibeReveal.psychicPts} pts`, width / 2, y2 + 6);
    }
}

// ── Input (dispatched from mouse handlers in game-sketch.js) ────────

function vibecheckCanGuess() {
    if (winnerId || vibe.phase !== 'guess') return false;
    if (vibe.psychicId === playerId) return false;
    const me = players.get(playerId);
    return !!(me && !me.isSpectator && !me.vibeLocked);
}

function vibeGuessFromMouse(m) {
    const { x0, x1, y, h } = VIBE_BAR;
    // Generous hit area around the bar so taps don't need to be precise
    if (m.x < x0 - 20 || m.x > x1 + 20 || m.y < y - 60 || m.y > y + h + 60) return null;
    const v = Math.round((m.x - x0) / (x1 - x0) * 100);
    return Math.max(0, Math.min(100, v));
}

function vibeSendGuess(v) {
    if (v === _vibeLastSentGuess) return;
    _vibeLastSentGuess = v;
    // Local echo so the marker follows the mouse without waiting for sync
    const me = players.get(playerId);
    if (me) me.vibeGuess = v;
    room.send('vibeGuess', v);
}

function vibecheckMousePressed() {
    if (!vibecheckCanGuess()) return true;
    const me = players.get(playerId);
    const m = canvasMouse();

    // Lock button (only shown once a guess is placed)
    const b = VIBE_LOCK_BTN;
    if (me.vibeGuess >= 0 && m.x >= b.x && m.x <= b.x + b.w && m.y >= b.y && m.y <= b.y + b.h) {
        room.send('vibeLock');
        return false;
    }

    const v = vibeGuessFromMouse(m);
    if (v !== null) vibeSendGuess(v);
    return v === null; // false (preventDefault) only when the tap was handled
}

function vibecheckMouseDragged() {
    if (!vibecheckCanGuess()) return true;
    const v = vibeGuessFromMouse(canvasMouse());
    if (v !== null) vibeSendGuess(v);
    return v === null;
}
