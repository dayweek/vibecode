// ── Who Am I? client: state sync and rendering ─────────────────────
// Loaded alongside game-sketch.js (shared globals, p5 global mode).
// The server reveals a mystery character's pregenerated clues one at a
// time; everyone types guesses into an HTML input under the canvas —
// the fewer clues revealed when you answer, the more points you score.

// Who Am I? state (synced from server)
let who = {
    phase: '', character: '', clues: '', cluesRevealed: 0,
    round: 0, totalRounds: 5, deadline: 0,
};
let whoReveal = null;   // { name, results } from the server
let whoFeed = [];       // guess feed entries { name, text, correct, pts, close }
let _whoSyncedRound = 0;
let _whoGuessBarVisible = null;

// Clue card layout on the 960x640 canvas (same column as the Draw It board)
const WHO_CARDS = { x: 190, y: 96, w: 580, h: 84, gap: 8 };
const WHO_FEED_X = 785;
const WHO_STATUS_Y = 576;
const WHO_TOTAL_CLUES = 5;

// Called from room.onStateChange in game-sketch.js
function syncWhoamiState(state) {
    who.phase = state.whoPhase || '';
    who.character = state.whoCharacter || '';
    who.clues = state.whoClues || '';
    who.cluesRevealed = state.whoCluesRevealed || 0;
    who.round = state.whoRound || 0;
    who.totalRounds = state.whoTotalRounds || 5;
    who.deadline = state.whoDeadline || 0;

    // New round: clear last round's reveal (the feed persists as banter)
    if (who.round !== _whoSyncedRound) {
        _whoSyncedRound = who.round;
        whoReveal = null;
    }
}

// Called from connectToRoom in game-sketch.js
function setupWhoamiMessages(joinedRoom) {
    joinedRoom.onMessage('whoFeed', (entry) => {
        if (!entry) return;
        whoFeed.push(entry);
        if (whoFeed.length > 40) whoFeed.shift();
    });
    joinedRoom.onMessage('whoReveal', (data) => {
        whoReveal = data || null;
    });
}

// Guesses are typed into an HTML input under the canvas (mobile keyboards
// need a real input element); shown while the round's clues are running.
(function initWhoGuessBar() {
    const input = document.getElementById('who-guess-input');
    const sendBtn = document.getElementById('who-guess-send');
    if (!input || !sendBtn) return;

    const send = () => {
        if (!room || gameType !== 'whoami' || gamePhase !== 'playing') return;
        if (who.phase !== 'clue') return;
        const guess = input.value.trim();
        if (!guess) return;
        room.send('whoGuess', guess);
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
function whoUpdateGuessBar() {
    const bar = document.getElementById('who-guess-bar');
    if (!bar) return;
    const me = players.get(playerId);
    const show = gameType === 'whoami' && gamePhase === 'playing'
        && who.phase === 'clue' && !winnerId
        && !!(me && !me.isSpectator && !me.whoGuessed);
    if (show === _whoGuessBarVisible) return;
    _whoGuessBarVisible = show;
    bar.style.display = show ? 'flex' : 'none';
    if (show) {
        const input = document.getElementById('who-guess-input');
        if (input) { input.value = ''; input.focus(); }
    }
}

// ── Rendering ───────────────────────────────────────────────────────

function drawWhoamiGame() {
    background(33, 26, 48);
    const me = players.get(playerId);

    // Header: round + phase banner
    noStroke();
    textAlign(CENTER, CENTER);
    fill(242, 233, 220);
    textSize(20);
    text(`Who Am I? — Round ${who.round} / ${who.totalRounds}`, width / 2, 26);

    if (!winnerId) {
        textSize(18);
        if (who.phase === 'clue') {
            fill(255, 180, 55);
            const pts = Math.max(1, WHO_TOTAL_CLUES + 1 - who.cluesRevealed);
            text(`Guess the mystery character — answer now for +${pts} pts!`, width / 2, 54);
        } else if (who.phase === 'reveal') {
            fill(126, 224, 78);
            const name = who.character || (whoReveal ? whoReveal.name : '');
            text(`It was: ${name}`, width / 2, 54);
        }
    }

    whoamiCountdown();
    whoamiScores();
    whoamiClueCards();
    whoamiFeed();

    if (who.phase === 'clue') {
        whoamiGuessStatus(me);
        whoamiGuessedCounter();
    } else if (who.phase === 'reveal') {
        whoamiRevealOverlay();
    }

    if (winnerId) drawWinnerMessage();
}

function whoamiCountdown() {
    if (!who.deadline || winnerId) return;
    const secs = Math.max(0, Math.ceil((who.deadline - Date.now()) / 1000));
    fill(secs <= 10 ? color(255, 91, 59) : color(157, 143, 174));
    textAlign(RIGHT, CENTER);
    textSize(20);
    text(`${secs}s`, width - 24, 26);
    textAlign(CENTER, CENTER);
}

// Running totals, top-left like the other games' scoreboards
function whoamiScores() {
    textAlign(LEFT, CENTER);
    textSize(17);
    let y = 60;
    players.forEach((p, id) => {
        if (p.isSpectator) return;
        fill(p.color || '#f2e9dc');
        const guessedMark = p.whoGuessed && who.phase === 'clue' ? ' ✔' : '';
        text(`${p.playerName || 'Anonymous'}${id === playerId ? ' (you)' : ''}: ${p.score || 0}${guessedMark}`, 14, y);
        y += 21;
    });
    textAlign(CENTER, CENTER);
}

// The stacked clue cards in the middle: revealed ones show their text,
// upcoming ones stay dimmed with the points they'd still be worth
function whoamiClueCards() {
    const clues = who.clues ? who.clues.split('\n') : [];
    for (let i = 0; i < WHO_TOTAL_CLUES; i++) {
        const y = WHO_CARDS.y + i * (WHO_CARDS.h + WHO_CARDS.gap);
        const revealed = i < clues.length;
        const pts = Math.max(1, WHO_TOTAL_CLUES - i);

        if (revealed) {
            fill(59, 45, 73);
            stroke(13, 7, 20);
        } else {
            noFill();
            stroke(59, 45, 73);
        }
        strokeWeight(3);
        rect(WHO_CARDS.x, y, WHO_CARDS.w, WHO_CARDS.h);
        noStroke();

        textAlign(LEFT, CENTER);
        textSize(13);
        fill(revealed ? color(255, 180, 55) : color(107, 93, 124));
        text(`CLUE ${i + 1}`, WHO_CARDS.x + 12, y + 16);
        textAlign(RIGHT, CENTER);
        fill(107, 93, 124);
        text(`+${pts} pts`, WHO_CARDS.x + WHO_CARDS.w - 12, y + 16);

        if (revealed) {
            textAlign(LEFT, TOP);
            textSize(17);
            fill(242, 233, 220);
            text(clues[i], WHO_CARDS.x + 12, y + 28, WHO_CARDS.w - 24, WHO_CARDS.h - 32);
        } else {
            textAlign(CENTER, CENTER);
            textSize(17);
            fill(107, 93, 124);
            text('?', WHO_CARDS.x + WHO_CARDS.w / 2, y + WHO_CARDS.h / 2 + 6);
        }
    }
    textAlign(CENTER, CENTER);
}

// Guess feed on the right of the cards (latest at the bottom)
function whoamiFeed() {
    const feedH = WHO_TOTAL_CLUES * (WHO_CARDS.h + WHO_CARDS.gap) - WHO_CARDS.gap;
    const maxRows = Math.floor((feedH - 10) / 20);
    const entries = whoFeed.slice(-maxRows);
    textAlign(LEFT, CENTER);
    textSize(14);
    let y = WHO_CARDS.y + 12;
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
        text(label, WHO_FEED_X, y);
        y += 20;
    }
    textAlign(CENTER, CENTER);
}

function whoamiGuessStatus(me) {
    fill(157, 143, 174);
    textSize(18);
    if (me && me.whoGuessed) {
        fill(126, 224, 78);
        text('You got it! Waiting for the others...', width / 2, WHO_STATUS_Y);
    } else if (me && me.isSpectator) {
        text('Spectating — no peeking at their screens.', width / 2, WHO_STATUS_Y);
    } else {
        text('Type your guess below the clues.', width / 2, WHO_STATUS_Y);
    }
}

function whoamiGuessedCounter() {
    let guessers = 0, got = 0;
    players.forEach((p) => {
        if (p.isSpectator) return;
        guessers++;
        if (p.whoGuessed) got++;
    });
    fill(157, 143, 174);
    textSize(16);
    text(`${got} / ${guessers} guessed it`, width / 2, WHO_STATUS_Y + 26);
}

function whoamiRevealOverlay() {
    // Per-player points scored this round
    if (!whoReveal) return;
    textSize(18);
    const sorted = whoReveal.results.slice().sort((a, b) => b.pts - a.pts);
    if (sorted.length === 0) {
        fill(255, 91, 59);
        text('Nobody guessed it!', width / 2, WHO_STATUS_Y);
        return;
    }
    const line = sorted.slice(0, 5).map(r =>
        `${r.playerName}${r.id === playerId ? ' (you)' : ''} +${r.pts}`
    ).join('   ·   ');
    fill(126, 224, 78);
    text(line, width / 2, WHO_STATUS_Y);
}
