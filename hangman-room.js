// ── Hangman configuration ───────────────────────────────────────────

const HANGMAN_CONFIG = {
    width: 960,
    height: 640,
    maxWrong: 6,          // gallows parts before a team is "hanged" for the round
    letterPoints: 10,     // per revealed occurrence
    wordBonus: 50,        // for completing the word
    roundEndDelay: 4000,  // ms the solved word stays on screen
    defaultRounds: 3,
    maxRounds: 10,
};

// Themed word lists, picked by the host in the lobby. Simple, common words
// and phrases only — this is a party game, not a spelling bee. Entries may
// contain spaces ("back to the future"); spaces are shown, never guessed.
const HANGMAN_THEMES = {
    classic: [
        'apple', 'banana', 'orange', 'grape', 'lemon', 'peach', 'mango', 'cherry',
        'melon', 'bread', 'cheese', 'butter', 'sugar', 'honey', 'pizza', 'pasta',
        'salad', 'juice', 'water', 'candy', 'cookie', 'cake',
        'house', 'table', 'chair', 'window', 'door', 'garden', 'kitchen', 'mirror',
        'carpet', 'clock', 'lamp', 'phone', 'music', 'movie', 'dance', 'party',
        'beach', 'ocean', 'river', 'mountain', 'forest', 'island', 'bridge',
        'castle', 'tower', 'school', 'teacher', 'student', 'pencil', 'paper',
        'book', 'letter', 'number', 'circle', 'square', 'happy', 'smile', 'laugh',
        'friend', 'family', 'mother', 'father', 'sister', 'brother', 'baby',
        'doctor', 'nurse', 'police', 'farmer', 'singer', 'artist',
        'tiger', 'lion', 'elephant', 'monkey', 'rabbit', 'turtle', 'horse',
        'sheep', 'chicken', 'duck', 'eagle', 'shark', 'whale', 'dolphin',
        'spider', 'butterfly', 'snake', 'dragon',
        'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'wind', 'storm',
        'summer', 'winter', 'spring', 'flower', 'tree', 'grass', 'leaf', 'rock',
        'fire', 'light', 'shadow', 'color', 'green', 'yellow', 'purple', 'silver',
        'golden', 'train', 'plane', 'boat', 'truck', 'bicycle', 'rocket', 'robot',
        'computer', 'camera', 'guitar', 'piano', 'drum', 'soccer', 'tennis',
        'hockey', 'pirate', 'wizard', 'zebra', 'panda', 'magnet', 'planet',
    ],
    it: [
        'laptop', 'server', 'cloud', 'python', 'javascript', 'database',
        'startup', 'keyboard', 'monitor', 'browser', 'website', 'password',
        'hacker', 'algorithm', 'computer', 'internet', 'email', 'software',
        'hardware', 'backend', 'frontend', 'firewall', 'compiler', 'terminal',
        'bug', 'debugging', 'deployment', 'framework', 'developer',
        'open source', 'machine learning', 'artificial intelligence',
        'unit test', 'code review', 'stack overflow', 'silicon valley',
        'venture capital', 'product manager', 'pull request', 'data science',
        'neural network', 'source code', 'tech support', 'social network',
        'search engine', 'operating system', 'virtual reality', 'big data',
    ],
    vacation: [
        'beach', 'passport', 'suitcase', 'airport', 'hotel', 'camping',
        'sunscreen', 'island', 'cruise', 'souvenir', 'snorkeling', 'surfing',
        'hammock', 'sunset', 'backpack', 'postcard', 'luggage', 'holiday',
        'seashell', 'sightseeing', 'tourist', 'adventure', 'paradise',
        'road trip', 'boarding pass', 'swimming pool', 'ice cream',
        'beach towel', 'sand castle', 'travel guide', 'jet lag',
        'room service', 'theme park', 'tropical island', 'city break',
        'palm tree', 'water park', 'camp fire', 'mountain hike',
        'sun glasses', 'window seat', 'all inclusive', 'travel agency',
    ],
    cinema: [
        'popcorn', 'actor', 'actress', 'director', 'trailer', 'sequel',
        'screenplay', 'blockbuster', 'premiere', 'subtitles', 'soundtrack',
        'movie theater', 'red carpet', 'film festival', 'special effects',
        'movie star', 'box office', 'science fiction', 'horror movie',
        'back to the future', 'star wars', 'the godfather', 'jurassic park',
        'pulp fiction', 'the matrix', 'forrest gump', 'home alone',
        'the lion king', 'finding nemo', 'harry potter', 'james bond',
        'indiana jones', 'toy story', 'titanic', 'batman', 'king kong',
        'the terminator', 'jaws', 'rocky', 'gladiator', 'frozen', 'shrek',
    ],
};

// ── Hangman server logic ────────────────────────────────────────────
// Mixed into GameRoom.prototype (see game-room.js), so `this` is the room.

const hangmanMethods = {

    registerHangmanMessages() {
        // Player picks their own team ('A' or 'B')
        this.onMessage('setTeam', (client, team) => {
            if (this.state.phase !== 'lobby') return;
            if (team !== 'A' && team !== 'B') return;
            const player = this.state.players.get(client.sessionId);
            if (player) player.team = team;
            const internal = this.playerInternal.get(client.sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        });

        // Host splits everyone into two random, balanced teams
        this.onMessage('randomizeTeams', (client) => {
            if (this.state.phase !== 'lobby') return;
            if (client.sessionId !== this.state.hostId) return;
            const ids = [];
            for (const [id] of this.state.players) ids.push(id);
            // Fisher–Yates shuffle, then alternate assignment
            for (let i = ids.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [ids[i], ids[j]] = [ids[j], ids[i]];
            }
            ids.forEach((id, i) => {
                const p = this.state.players.get(id);
                if (p) p.team = i % 2 === 0 ? 'A' : 'B';
            });
        });

        // Host picks the word theme
        this.onMessage('setTheme', (client, theme) => {
            if (this.state.phase !== 'lobby') return;
            if (client.sessionId !== this.state.hostId) return;
            if (!HANGMAN_THEMES[theme]) return;
            this.state.hangmanTheme = theme;
        });

        // Host configures how many rounds (words) the game lasts
        this.onMessage('setRounds', (client, rounds) => {
            if (this.state.phase !== 'lobby') return;
            if (client.sessionId !== this.state.hostId) return;
            const n = Math.floor(Number(rounds));
            if (!Number.isFinite(n) || n < 1 || n > HANGMAN_CONFIG.maxRounds) return;
            this.state.hangmanTotalRounds = n;
        });

        // Anybody on the team whose turn it is may guess a letter
        this.onMessage('guessLetter', (client, letter) => {
            if (this.state.gameType !== 'hangman' || this.state.phase !== 'playing') return;
            if (this.state.winnerId || this.hangmanRoundOver) return;
            const player = this.state.players.get(client.sessionId);
            if (!player || player.isSpectator || !player.team) return;
            if (player.team !== this.state.hangmanTurn) return;

            letter = String(letter || '').toLowerCase();
            if (!/^[a-z]$/.test(letter)) return;
            if (this.state.hangmanGuessed.includes(letter)) return;

            const internal = this.playerInternal.get(client.sessionId);
            if (internal) internal.lastActivityTime = Date.now();

            this.handleHangmanGuess(player, letter);
        });
    },

    hangmanTeamsValid() {
        let a = 0, b = 0, unassigned = 0;
        for (const [, p] of this.state.players) {
            if (p.team === 'A') a++;
            else if (p.team === 'B') b++;
            else unassigned++;
        }
        return a > 0 && b > 0 && unassigned === 0;
    },

    startHangmanGame() {
        console.log('Starting Hangman game...');
        this.clearGameObjects();

        // Hangman uses no board objects — clear any leftover walls
        this.clearBoard();

        this.state.gridWidth = HANGMAN_CONFIG.width;
        this.state.gridHeight = HANGMAN_CONFIG.height;
        this.participantsAtStart = this.state.players.size;

        for (const [sessionId, player] of this.state.players) {
            player.isSpectator = false;
            player.ready = false;
            player.alive = true;
            player.killedBy = '';
            player.isMoving = false;
            const internal = this.playerInternal.get(sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        }

        // Pick one unique random word per round from the chosen theme
        const pool = (HANGMAN_THEMES[this.state.hangmanTheme] || HANGMAN_THEMES.classic).slice();
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        this.hangmanWords = pool.slice(0, this.state.hangmanTotalRounds);

        this.state.hangmanScoreA = 0;
        this.state.hangmanScoreB = 0;
        this.startHangmanRound(1);

        this.state.phase = 'playing';
        this.updateMetadata();
    },

    startHangmanRound(round) {
        this.state.hangmanRound = round;
        const pool = HANGMAN_THEMES[this.state.hangmanTheme] || HANGMAN_THEMES.classic;
        this.hangmanWord = this.hangmanWords[round - 1] || pool[Math.floor(Math.random() * pool.length)];
        // Mask letters; spaces in multi-word answers are shown from the start
        this.state.hangmanRevealed = this.hangmanWord.replace(/[a-z]/g, '_');
        this.state.hangmanGuessed = '';
        this.state.hangmanWrongA = 0;
        this.state.hangmanWrongB = 0;
        this.hangmanRoundOver = false;
        // Alternate which team opens each round
        this.state.hangmanTurn = round % 2 === 1 ? 'A' : 'B';
    },

    handleHangmanGuess(player, letter) {
        const team = player.team;
        const other = team === 'A' ? 'B' : 'A';
        this.state.hangmanGuessed += letter;

        if (this.hangmanWord.includes(letter)) {
            // Reveal every occurrence; the team keeps its turn
            let count = 0;
            const revealed = this.state.hangmanRevealed.split('');
            for (let i = 0; i < this.hangmanWord.length; i++) {
                if (this.hangmanWord[i] === letter) {
                    revealed[i] = letter;
                    count++;
                }
            }
            this.state.hangmanRevealed = revealed.join('');

            const points = count * HANGMAN_CONFIG.letterPoints;
            if (team === 'A') this.state.hangmanScoreA += points;
            else this.state.hangmanScoreB += points;

            this.broadcast('hangmanGuess', {
                letter, correct: true, team,
                playerName: player.playerName || 'Anonymous',
            });
            this.broadcast('playEatSound');

            if (!this.state.hangmanRevealed.includes('_')) {
                // Word complete — bonus and end of round
                if (team === 'A') this.state.hangmanScoreA += HANGMAN_CONFIG.wordBonus;
                else this.state.hangmanScoreB += HANGMAN_CONFIG.wordBonus;
                this.broadcast('playLevelUpSound');
                this.endHangmanRound(team);
            }
        } else {
            // Wrong guess: gallows part for this team, turn passes if the
            // other team can still play
            const wrong = (team === 'A' ? ++this.state.hangmanWrongA : ++this.state.hangmanWrongB);
            const otherWrong = other === 'A' ? this.state.hangmanWrongA : this.state.hangmanWrongB;

            this.broadcast('hangmanGuess', {
                letter, correct: false, team,
                playerName: player.playerName || 'Anonymous',
            });
            this.broadcast('playDieSound');

            if (wrong >= HANGMAN_CONFIG.maxWrong && otherWrong >= HANGMAN_CONFIG.maxWrong) {
                // Both teams hanged — nobody solves the word
                this.endHangmanRound('');
            } else if (otherWrong < HANGMAN_CONFIG.maxWrong) {
                this.state.hangmanTurn = other;
            }
            // else: other team is already hanged, current team keeps guessing
        }
    },

    endHangmanRound(winningTeam) {
        this.hangmanRoundOver = true;
        // Show the full word during the between-rounds pause
        this.state.hangmanRevealed = this.hangmanWord;
        this.broadcast('hangmanRoundEnd', {
            word: this.hangmanWord,
            team: winningTeam,
            round: this.state.hangmanRound,
        });

        this.hangmanRoundTimeout = setTimeout(() => {
            this.hangmanRoundTimeout = null;
            if (this.state.phase !== 'playing' || this.state.gameType !== 'hangman') return;
            if (this.state.hangmanRound >= this.state.hangmanTotalRounds) {
                this.finishHangmanGame();
            } else {
                this.startHangmanRound(this.state.hangmanRound + 1);
            }
        }, HANGMAN_CONFIG.roundEndDelay);
    },

    finishHangmanGame() {
        const a = this.state.hangmanScoreA;
        const b = this.state.hangmanScoreB;
        this.state.winnerId = a > b ? 'teamA' : (b > a ? 'teamB' : 'draw');
        console.log(`Hangman over: A=${a} B=${b} → ${this.state.winnerId}`);
        if (this.state.winnerId !== 'draw') this.broadcast('playWinSound');
        this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
    },

    updateHangmanState() {
        if (this.state.winnerId || this.hangmanRoundOver) return;

        let a = 0, b = 0;
        for (const [, p] of this.state.players) {
            if (p.isSpectator) continue;
            if (p.team === 'A') a++;
            else if (p.team === 'B') b++;
        }

        if (a === 0 && b === 0) {
            // Only spectators left — nothing to watch, back to the lobby
            this.returnToLobby();
        } else if (a === 0 || b === 0) {
            // A whole team left mid-game: the remaining team wins
            this.state.winnerId = a === 0 ? 'teamB' : 'teamA';
            this.broadcast('playWinSound');
            if (this.hangmanRoundTimeout) {
                clearTimeout(this.hangmanRoundTimeout);
                this.hangmanRoundTimeout = null;
            }
            this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
        }
    },
};

module.exports = { HANGMAN_CONFIG, HANGMAN_THEMES, hangmanMethods };
