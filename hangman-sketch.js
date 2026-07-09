// ── Hangman client: state sync, rendering and input ────────────────
// Loaded alongside game-sketch.js (shared globals, p5 global mode).

// Hangman state (synced from server)
let hangman = {
    revealed: '', guessed: '', turn: '', theme: 'classic', round: 0, totalRounds: 3,
    scoreA: 0, scoreB: 0, wrongA: 0, wrongB: 0,
};
const HANGMAN_THEME_LABELS = {
    classic: 'Classic', it: 'IT', vacation: 'Vacation', cinema: 'Cinema',
};
let hangmanNotice = null; // { text, color, until } — transient guess feedback
const TEAM_INFO = {
    A: { name: 'Team Red', color: '#ff5b3b' },
    B: { name: 'Team Blue', color: '#4da6ff' },
};

// Called from room.onStateChange in game-sketch.js
function syncHangmanState(state) {
    hangman.revealed = state.hangmanRevealed || '';
    hangman.guessed = state.hangmanGuessed || '';
    hangman.turn = state.hangmanTurn || '';
    hangman.theme = state.hangmanTheme || 'classic';
    hangman.round = state.hangmanRound || 0;
    hangman.totalRounds = state.hangmanTotalRounds || 3;
    hangman.scoreA = state.hangmanScoreA || 0;
    hangman.scoreB = state.hangmanScoreB || 0;
    hangman.wrongA = state.hangmanWrongA || 0;
    hangman.wrongB = state.hangmanWrongB || 0;
}

// Called from connectToRoom in game-sketch.js
function setupHangmanMessages(joinedRoom) {
    joinedRoom.onMessage('hangmanGuess', (data) => {
        if (!data) return;
        hangmanNotice = {
            text: `${data.playerName || 'Someone'} guessed "${(data.letter || '').toUpperCase()}" — ${data.correct ? 'correct!' : 'nope!'}`,
            color: data.correct ? '#7ee04e' : '#ff5b3b',
            until: Date.now() + 2500,
        };
    });

    joinedRoom.onMessage('hangmanRoundEnd', (data) => {
        if (!data) return;
        const word = (data.word || '').toUpperCase();
        const info = TEAM_INFO[data.team];
        hangmanNotice = info
            ? { text: `${info.name} solved it — ${word}!`, color: info.color, until: Date.now() + 4000 }
            : { text: `Nobody solved it — the word was ${word}`, color: '#9d8fae', until: Date.now() + 4000 };
    });
}

function submitHangmanGuess(letter) {
    if (!room || gameType !== 'hangman' || gamePhase !== 'playing' || winnerId) return;
    const me = players.get(playerId);
    if (!me || me.isSpectator || !me.team) return;
    if (hangman.turn !== me.team) return;
    if (!/^[a-z]$/.test(letter)) return;
    if (hangman.guessed.includes(letter)) return;
    room.send('guessLetter', letter);
}

// ── Rendering ───────────────────────────────────────────────────────

function drawHangmanGame() {
    background(33, 26, 48);
    const now = Date.now();
    const me = players.get(playerId);

    // Header: round + turn banner
    noStroke();
    textAlign(CENTER, CENTER);
    fill(242, 233, 220);
    textSize(20);
    const themeLabel = HANGMAN_THEME_LABELS[hangman.theme] || 'Classic';
    text(`Round ${hangman.round} / ${hangman.totalRounds} — ${themeLabel}`, width / 2, 26);

    const turnInfo = TEAM_INFO[hangman.turn];
    if (turnInfo && !winnerId) {
        const myTurn = me && !me.isSpectator && me.team === hangman.turn;
        fill(turnInfo.color);
        textSize(24);
        text(`${turnInfo.name}'s turn${myTurn ? ' — pick a letter!' : ''}`, width / 2, 60);
    }

    // Team panels with gallows figures
    drawHangmanTeam('A', 40);
    drawHangmanTeam('B', width - 320);

    // Center column: scoreboard vs., notice, word, alphabet
    fill(157, 143, 174);
    textSize(26);
    text(`${hangman.scoreA}  :  ${hangman.scoreB}`, width / 2, 120);

    if (hangmanNotice && now < hangmanNotice.until) {
        fill(hangmanNotice.color);
        textSize(19);
        text(hangmanNotice.text, width / 2, 425);
    }

    drawHangmanWord();
    drawHangmanAlphabet();

    if (winnerId) drawWinnerMessage();
}

function drawHangmanTeam(team, x) {
    const info = TEAM_INFO[team];
    const wrong = team === 'A' ? hangman.wrongA : hangman.wrongB;
    const score = team === 'A' ? hangman.scoreA : hangman.scoreB;
    const isTurn = hangman.turn === team && !winnerId;

    // Active-turn highlight frame
    if (isTurn) {
        noFill();
        stroke(info.color);
        strokeWeight(3);
        rect(x - 12, 82, 304, 320);
    }
    noStroke();

    fill(info.color);
    textAlign(LEFT, CENTER);
    textSize(19);
    text(`${info.name} — ${score} pts`, x, 100);

    drawGallowsFigure(x + 60, 118, wrong, info.color);

    textAlign(LEFT, CENTER);
    if (wrong >= 6) {
        fill(255, 91, 59);
        textSize(17);
        text('HANGED — out this round', x, 315);
    } else {
        fill(157, 143, 174);
        textSize(16);
        text(`${wrong} / 6 misses`, x, 315);
    }

    // Team members (capped so long rosters don't spill into the word area)
    const names = [];
    players.forEach((p, id) => {
        if (p.team === team && !p.isSpectator) {
            names.push({ id, label: (p.playerName || 'Anonymous') + (id === playerId ? ' (you)' : '') });
        }
    });
    textSize(16);
    let yy = 340;
    const maxShown = 4;
    names.slice(0, maxShown).forEach(n => {
        fill(n.id === playerId ? color(255, 180, 55) : color(242, 233, 220));
        text(n.label, x, yy);
        yy += 19;
    });
    if (names.length > maxShown) {
        fill(157, 143, 174);
        text(`+${names.length - maxShown} more`, x, yy);
    }
    textAlign(CENTER, CENTER);
}

// Classic 6-part figure: head, body, both arms, both legs
function drawGallowsFigure(x, y, wrong, col) {
    stroke(157, 143, 174);
    strokeWeight(4);
    line(x, y + 175, x + 130, y + 175);   // base
    line(x + 25, y + 175, x + 25, y);     // pole
    line(x + 25, y, x + 105, y);          // beam
    line(x + 105, y, x + 105, y + 22);    // rope

    stroke(col);
    strokeWeight(3);
    noFill();
    if (wrong >= 1) ellipse(x + 105, y + 38, 32, 32);            // head
    if (wrong >= 2) line(x + 105, y + 54, x + 105, y + 110);     // body
    if (wrong >= 3) line(x + 105, y + 66, x + 80, y + 92);       // left arm
    if (wrong >= 4) line(x + 105, y + 66, x + 130, y + 92);      // right arm
    if (wrong >= 5) line(x + 105, y + 110, x + 85, y + 145);     // left leg
    if (wrong >= 6) line(x + 105, y + 110, x + 125, y + 145);    // right leg
    noStroke();
}

function drawHangmanWord() {
    const word = hangman.revealed || '';
    if (!word) return;
    const n = word.length;
    const bw = Math.min(50, (width - 120) / n);
    const x0 = (width - bw * n) / 2;
    const baseY = 485;

    textAlign(CENTER, CENTER);
    textSize(Math.min(34, bw * 0.72));
    for (let i = 0; i < n; i++) {
        // Spaces in multi-word answers are plain gaps — no blank to fill
        if (word[i] === ' ') continue;
        stroke(242, 233, 220);
        strokeWeight(3);
        line(x0 + i * bw + 6, baseY, x0 + (i + 1) * bw - 6, baseY);
        noStroke();
        if (word[i] !== '_') {
            fill(255, 180, 55);
            text(word[i].toUpperCase(), x0 + i * bw + bw / 2, baseY - 22);
        }
    }
}

const HANGMAN_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

// Letter button grid: 13 per row, centered on the 960px canvas
function hangmanLetterTile(i) {
    return {
        x: 119 + (i % 13) * 56,
        y: 524 + Math.floor(i / 13) * 42,
        w: 50,
        h: 34,
    };
}

// Whether the local player may guess right now
function hangmanCanGuess() {
    const me = players.get(playerId);
    return !!(me && !me.isSpectator && me.team && me.team === hangman.turn)
        && !winnerId
        && hangman.revealed.includes('_'); // false during the round-end reveal
}

function drawHangmanAlphabet() {
    const canGuess = hangmanCanGuess();
    const m = canvasMouse();
    let hovering = false;

    textAlign(CENTER, CENTER);
    textSize(18);
    for (let i = 0; i < 26; i++) {
        const t = hangmanLetterTile(i);
        const ch = HANGMAN_LETTERS[i];
        const guessed = hangman.guessed.includes(ch);
        const correct = guessed && hangman.revealed.includes(ch);
        const hover = canGuess && !guessed
            && m.x >= t.x && m.x <= t.x + t.w && m.y >= t.y && m.y <= t.y + t.h;
        if (hover) hovering = true;

        // Button face
        stroke(13, 7, 20);
        strokeWeight(2);
        if (correct) fill(26, 58, 20);
        else if (guessed) fill(58, 22, 22);
        else if (hover) fill(255, 180, 55);
        else if (canGuess) fill(59, 45, 73);
        else fill(42, 32, 54);
        rect(t.x, t.y, t.w, t.h);
        noStroke();

        // Letter
        if (correct) fill(126, 224, 78);
        else if (guessed) fill(255, 91, 59);
        else if (hover) fill(36, 21, 5);
        else if (canGuess) fill(242, 233, 220);
        else fill(157, 143, 174);
        text(ch.toUpperCase(), t.x + t.w / 2, t.y + t.h / 2);

        if (guessed && !correct) {
            stroke(255, 91, 59);
            strokeWeight(2);
            line(t.x + t.w / 2 - 9, t.y + t.h / 2, t.x + t.w / 2 + 9, t.y + t.h / 2);
            noStroke();
        }
    }
    cursor(hovering ? HAND : ARROW);
}

// ── Input ───────────────────────────────────────────────────────────

// Clicking (or tapping) a letter button submits a guess.
// Dispatched from mousePressed in game-sketch.js.
function hangmanMousePressed() {
    if (winnerId) return true;
    if (!hangmanCanGuess()) return true;
    const m = canvasMouse();
    for (let i = 0; i < 26; i++) {
        const t = hangmanLetterTile(i);
        if (m.x >= t.x && m.x <= t.x + t.w && m.y >= t.y && m.y <= t.y + t.h) {
            submitHangmanGuess(HANGMAN_LETTERS[i]);
            return;
        }
    }
}
