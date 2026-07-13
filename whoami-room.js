// ── Who Am I? configuration ─────────────────────────────────────────
// Guess-the-character party game: each round the server picks a famous
// character and reveals its pregenerated clues one at a time. There are
// no roles — everyone guesses, and the fewer clues you needed, the more
// points you score.

const { drawitIsClose } = require('./drawit-room');

const WHOAMI_CONFIG = {
    width: 960,
    height: 640,
    defaultRounds: 5,
    maxRounds: 10,
    minPlayers: 1,            // no roles, so solo trivia works fine
    guessMaxLength: 40,
    cluesPerCharacter: 5,
    clueIntervalMs: 15000,    // clue 1 at t=0, then a new clue every 15s
    lastClueGraceMs: 15000,   // guessing stays open 15s after the last clue
    guessPoints: [5, 4, 3, 2, 1], // indexed by (cluesRevealed - 1)
    revealDelay: 5000,        // ms the reveal stays on screen between rounds
};

// Each character: { name, accepts: [extra accepted answers], clues: [5, hard → easy] }.
// A guess also matches the full name or its last word (when ≥ 4 letters),
// so `accepts` only lists nicknames that neither rule covers.
const WHOAMI_CHARACTERS = [
    {
        name: 'Albert Einstein', accepts: [],
        clues: [
            'I was born in Germany in 1879 and famously refused to wear socks.',
            'I worked as a patent clerk in Switzerland while writing my most important papers.',
            'I won the Nobel Prize in Physics — but not for my most famous theory.',
            'My wild white hair and tongue-out photo made my face a symbol of genius.',
            'I came up with the theory of relativity: E = mc².',
        ],
    },
    {
        name: 'Harry Potter', accepts: [],
        clues: [
            "I grew up sleeping in a cupboard under the stairs at my aunt and uncle's house.",
            'I became famous in my world for something that happened when I was a baby.',
            'My two best friends are a brilliant bookworm and a red-headed boy from a big family.',
            'I play seeker for Gryffindor at a school called Hogwarts.',
            "I'm the boy wizard with round glasses and a lightning-bolt scar.",
        ],
    },
    {
        name: 'Cleopatra', accepts: [],
        clues: [
            'I spoke nine languages and was famed more for wit and charm than for looks.',
            'Legend says I was smuggled into a palace rolled up inside a carpet.',
            "I romanced two of ancient Rome's most powerful men.",
            'The story goes that I died from the bite of a venomous snake.',
            'I was the last pharaoh of Egypt.',
        ],
    },
    {
        name: 'Batman', accepts: ['bruce wayne'],
        clues: [
            'Watching my parents die in an alley changed the course of my life.',
            "By day I'm a billionaire playboy; by night, something else entirely.",
            'I have no superpowers — just training, gadgets and a lot of money.',
            'My city is Gotham, my butler is Alfred, and my nemesis is a laughing clown.',
            "I'm the caped crusader they call the Dark Knight.",
        ],
    },
    {
        name: 'Frida Kahlo', accepts: ['frida'],
        clues: [
            'A bus accident at eighteen left me in lifelong pain — so I started painting in bed.',
            'I married the same famous muralist twice.',
            'I painted myself over and over, saying I was the subject I knew best.',
            "My blue house in Mexico City is now one of the country's most visited museums.",
            "I'm the Mexican painter famous for self-portraits and my unibrow.",
        ],
    },
    {
        name: 'Darth Vader', accepts: ['anakin skywalker', 'anakin'],
        clues: [
            'As a boy I won a dangerous pod race on a desert planet.',
            'A duel on a volcanic world left me more machine than man.',
            'My famous breathing sound was recorded through a scuba regulator.',
            'I serve the Emperor and hunt the Rebel Alliance across the galaxy.',
            'Dressed in black armor, I told Luke: "I am your father."',
        ],
    },
    {
        name: 'Pikachu', accepts: [],
        clues: [
            'I refuse to travel inside the ball where most of my kind live.',
            "My red cheeks aren't makeup — they store my main weapon.",
            'My name comes from Japanese words for sparkle and squeak.',
            'My best friend is a trainer named Ash from Pallet Town.',
            "I'm a yellow electric mouse and the mascot of Pokémon.",
        ],
    },
    {
        name: 'Sherlock Holmes', accepts: ['sherlock'],
        clues: [
            'My creator killed me at a waterfall, but angry fans made him bring me back.',
            'I play the violin and keep my tobacco in a Persian slipper.',
            'My archenemy is a criminal mastermind professor named Moriarty.',
            'My flatmate at 221B Baker Street writes up all my cases.',
            "I'm the pipe-smoking detective who finds it all elementary.",
        ],
    },
    {
        name: 'Elsa', accepts: [],
        clues: [
            'I spent my childhood behind a closed door, hiding from my little sister.',
            'My coronation day ended with me fleeing alone across a fjord.',
            'I built a talking snowman named Olaf without even trying.',
            'My kingdom is Arendelle, and I once plunged it into eternal winter.',
            "I'm the ice queen who sings \"Let It Go\".",
        ],
    },
    {
        name: 'Mario', accepts: ['super mario'],
        clues: [
            'I first appeared as "Jumpman", rescuing a lady from a giant ape.',
            "By trade I'm a plumber, though I rarely fix any pipes.",
            'Mushrooms make me bigger and flowers let me throw fireballs.',
            'My brother wears green and my nemesis is a spiky turtle king.',
            "I'm Nintendo's mustachioed hero in a red cap.",
        ],
    },
    {
        name: 'Shrek', accepts: [],
        clues: [
            'I evicted a crowd of fairy-tale squatters from my swamp.',
            'My best friend never stops talking and loves waffles.',
            'I rescued a princess who turned out to share my true nature.',
            "I'm big, green and grumpy, and I like onions because they have layers.",
            "I'm the ogre from a DreamWorks movie named after me.",
        ],
    },
    {
        name: 'Spider-Man', accepts: ['spiderman', 'peter parker'],
        clues: [
            'I sell photos of my alter ego to a newspaper editor who hates him.',
            'I lost my uncle because I once refused to stop a thief.',
            'A bite during a school field trip changed my life forever.',
            'With great power comes great responsibility — that\'s my motto.',
            "I'm the web-slinging superhero in a red and blue suit.",
        ],
    },
    {
        name: 'Homer Simpson', accepts: [],
        clues: [
            'I once went to space and ruined the mission with potato chips.',
            'I work as a safety inspector at a nuclear power plant.',
            'I strangle my son when he misbehaves — "Why you little...!"',
            'My wife has tall blue hair and my catchphrase is "D\'oh!"',
            "I'm the bald yellow dad of TV's most famous cartoon family.",
        ],
    },
    {
        name: 'James Bond', accepts: ['007'],
        clues: [
            'My gadgets come from a quartermaster known only as Q.',
            'I drive an Aston Martin with a few optional extras.',
            'I like my martinis shaken, not stirred.',
            "I've been played by Connery, Moore, Brosnan and Craig.",
            "I'm Britain's most famous secret agent, codename 007.",
        ],
    },
    {
        name: 'Yoda', accepts: [],
        clues: [
            'I spent my last years in exile in a swamp on Dagobah.',
            'I trained warriors for over eight hundred years.',
            'Small and green I am, but with a lightsaber, dangerous.',
            'Backwards my sentences sound; speak like this I do.',
            "I'm the tiny wise Jedi master from Star Wars.",
        ],
    },
    {
        name: 'Mickey Mouse', accepts: ['mickey'],
        clues: [
            'I made my debut piloting a steamboat in 1928.',
            'My creator sketched me on a train after losing the rights to a lucky rabbit.',
            'My girlfriend is Minnie and my dog is named Pluto.',
            'My round ears form one of the most famous silhouettes on Earth.',
            "I'm Disney's most famous cartoon star, in red shorts and yellow shoes.",
        ],
    },
    {
        name: 'SpongeBob SquarePants', accepts: ['spongebob'],
        clues: [
            "I've failed my boating exam more times than anyone can count.",
            'My best friend is a dim but loyal pink starfish.',
            'I flip Krabby Patties at the Krusty Krab.',
            'I live in a pineapple under the sea.',
            "I'm the square yellow sponge from Bikini Bottom.",
        ],
    },
    {
        name: 'Gandalf', accepts: [],
        clues: [
            'I arrive precisely when I mean to — a wizard is never late.',
            'I fell into shadow battling a fiery demon on a bridge.',
            'I returned from that fall wearing white instead of grey.',
            'I sent a hobbit named Frodo on a quest to destroy a ring.',
            "I'm the long-bearded wizard who shouts \"You shall not pass!\"",
        ],
    },
    {
        name: 'Dracula', accepts: ['count dracula'],
        clues: [
            'An Irish author made me famous in a novel told through letters and diaries.',
            'A Romanian prince nicknamed "the Impaler" inspired my story.',
            'Mirrors are useless to me and garlic ruins my appetite.',
            'I sleep in a coffin in my Transylvanian castle.',
            "I'm the world's most famous vampire count.",
        ],
    },
    {
        name: 'Superman', accepts: ['clark kent'],
        clues: [
            'A childless couple in Kansas found me in a field and raised me.',
            'My greatest weakness is a glowing green rock from home.',
            'My disguise is nothing more than a pair of glasses.',
            'I work at the Daily Planet with reporter Lois Lane.',
            "I'm the caped hero from Krypton with an S on my chest.",
        ],
    },
    {
        name: 'Wonder Woman', accepts: ['diana'],
        clues: [
            'I was sculpted from clay, or so my oldest origin story says.',
            'I come from an island of warrior women hidden from mankind.',
            'My homeland is Themyscira and my mother is its queen.',
            'My golden lasso forces anyone caught in it to tell the truth.',
            "I'm the Amazon superheroine with bulletproof bracelets.",
        ],
    },
    {
        name: 'Winnie the Pooh', accepts: ['winnie'],
        clues: [
            'A real black bear at the London Zoo inspired my name.',
            'My closest friends include a gloomy donkey and a bouncy tiger.',
            'I once ate so much at a party that I got stuck in a doorway.',
            'I live in the Hundred Acre Wood with a boy named Christopher Robin.',
            "I'm the honey-loving bear in a little red shirt.",
        ],
    },
    {
        name: 'Marie Curie', accepts: [],
        clues: [
            "My notebooks are still so radioactive they're stored in lead boxes.",
            'I moved from Poland to Paris because universities at home refused women.',
            'I discovered two elements and named one after my homeland.',
            "I'm the only person with Nobel Prizes in two different sciences.",
            "I'm the pioneering scientist who studied radioactivity.",
        ],
    },
    {
        name: 'Napoleon Bonaparte', accepts: ['napoleon'],
        clues: [
            'I was born on Corsica and spoke French with an accent all my life.',
            'I crowned myself emperor instead of letting the Pope do it.',
            'Winter in Russia destroyed my greatest army.',
            'I met my final defeat at a place called Waterloo.',
            "I'm the French emperor always painted with a hand tucked in my coat.",
        ],
    },
    {
        name: 'Neil Armstrong', accepts: [],
        clues: [
            "I earned my pilot's license before I could legally drive a car.",
            'I flew combat missions in Korea before becoming a test pilot.',
            'My crewmates were Buzz Aldrin and Michael Collins.',
            'The whole world watched my one small step in July 1969.',
            'I was the first human to walk on the Moon.',
        ],
    },
    {
        name: 'Lionel Messi', accepts: ['leo messi'],
        clues: [
            "As a boy I needed growth hormone treatment my parents couldn't afford.",
            'I left my boyhood club in tears after two decades in Barcelona.',
            "I've won the Ballon d'Or more times than anyone in history.",
            'I finally lifted the World Cup for Argentina in 2022.',
            "I'm the little left-footed magician many call the GOAT of football.",
        ],
    },
    {
        name: 'Leonardo da Vinci', accepts: ['leonardo', 'da vinci'],
        clues: [
            'I wrote my notes in mirror writing, right to left.',
            'I sketched flying machines and tanks centuries before they existed.',
            'I dissected corpses in secret to learn how bodies work.',
            'I painted The Last Supper on a monastery wall in Milan.',
            "I'm the Renaissance genius who painted the Mona Lisa.",
        ],
    },
    {
        name: 'William Shakespeare', accepts: [],
        clues: [
            'In my will I left my wife our "second best bed".',
            'I invented hundreds of words you still use, like "lonely" and "gossip".',
            'My theatre in London was called the Globe.',
            'I wrote about star-crossed lovers in Verona and a moody Danish prince.',
            "I'm the Bard of Avon, history's most famous playwright.",
        ],
    },
    {
        name: 'Wolfgang Amadeus Mozart', accepts: [],
        clues: [
            "I toured Europe's royal courts as a performer before I turned ten.",
            'I could write down entire pieces after a single hearing.',
            'I left my final work, a Requiem, unfinished when I died at 35.',
            'A famous film imagines my rival Salieri envying me to madness.',
            "I'm the child prodigy composer from Salzburg.",
        ],
    },
    {
        name: 'Michael Jackson', accepts: [],
        clues: [
            'I grew up on stage with four of my brothers in Gary, Indiana.',
            'My pet chimpanzee Bubbles was almost as famous as I was.',
            'I wore one sparkling glove and walked backwards while moving forwards.',
            'My album Thriller is still the best-selling of all time.',
            "I'm the King of Pop.",
        ],
    },
    {
        name: 'Elvis Presley', accepts: ['elvis'],
        clues: [
            'I bought my mansion, Graceland, when I was 22.',
            'I served in the U.S. Army in Germany at the height of my fame.',
            'My swiveling hips scandalized 1950s television.',
            'People claim to still spot me alive decades after 1977.',
            "I'm the King of Rock and Roll from Memphis.",
        ],
    },
    {
        name: 'Usain Bolt', accepts: [],
        clues: [
            'I ate chicken nuggets before breaking world records in Beijing.',
            'My coaches wanted me to run the 400m; I preferred it shorter.',
            'My signature victory pose points one arm up at the sky.',
            'My 100m world record of 9.58 seconds still stands.',
            "I'm the Jamaican sprinter, the fastest man in history.",
        ],
    },
    {
        name: 'Abraham Lincoln', accepts: [],
        clues: [
            'I taught myself law by candlelight in a log cabin.',
            'At six foot four, I was the tallest ever to hold my job.',
            'I grew my famous beard because an 11-year-old girl suggested it.',
            'I led my country through civil war and freed the enslaved.',
            "I'm the top-hatted 16th president of the United States.",
        ],
    },
    {
        name: 'Ludwig van Beethoven', accepts: [],
        clues: [
            'I dedicated a symphony to Napoleon, then furiously scratched out his name.',
            'I never heard the applause at the premiere of my final symphony.',
            'A letter to my "Immortal Beloved" was found in my desk — she is still a mystery.',
            'I kept composing masterpieces even after going completely deaf.',
            "I'm the German composer whose Fifth Symphony starts da-da-da-DUM.",
        ],
    },
    {
        name: 'Muhammad Ali', accepts: ['ali', 'cassius clay'],
        clues: [
            'Legend says I threw my Olympic gold medal into a river.',
            'I changed my name after joining a new faith in 1964.',
            'I refused the Vietnam draft and was stripped of my title for it.',
            'I won the Rumble in the Jungle with my rope-a-dope trick.',
            "I'm the boxer who floats like a butterfly and stings like a bee.",
        ],
    },
    {
        name: 'Charlie Chaplin', accepts: [],
        clues: [
            "I once entered a look-alike contest of myself and didn't win.",
            'I co-founded a film studio called United Artists.',
            'I dared to mock Hitler in a film released in 1940.',
            'Sound came to the movies, but I stayed silent for years longer.',
            "I'm the silent film tramp with a bowler hat, cane and tiny mustache.",
        ],
    },
    {
        name: 'Nikola Tesla', accepts: [],
        clues: [
            'In my later years I claimed to have fallen in love with a pigeon.',
            'I worked for Edison until we fell out over money and ideas.',
            'I won the "war of the currents" — your wall sockets prove it.',
            'I built a giant tower to send electricity through the air for free.',
            "I'm the inventor whose name now badges electric cars.",
        ],
    },
    {
        name: 'Serena Williams', accepts: ['serena'],
        clues: [
            'I was coached on cracked public courts by my father in Compton.',
            'I won a Grand Slam title while eight weeks pregnant.',
            'My older sister faced me in nine major finals.',
            "I've won 23 Grand Slam singles titles.",
            "I'm the American often called the greatest women's tennis player ever.",
        ],
    },
    {
        name: 'Pablo Picasso', accepts: [],
        clues: [
            'My full baptismal name is more than twenty words long.',
            'I was questioned when the Mona Lisa was stolen in 1911.',
            'My sad early paintings were mostly, well, blue.',
            'I painted the horrors of a bombed Basque town in Guernica.',
            "I'm the Spanish artist who co-invented Cubism.",
        ],
    },
    {
        name: 'Mahatma Gandhi', accepts: [],
        clues: [
            'I trained as a lawyer in London and first practiced in South Africa.',
            'Being thrown off a train for my skin color changed my path.',
            'I marched 240 miles to the sea just to make salt.',
            'I fought an empire armed only with nonviolence and fasting.',
            "I'm the man in round glasses who led India to independence.",
        ],
    },
];

// ── Helpers ─────────────────────────────────────────────────────────

// Lowercase, strip punctuation (so "J.R.R." or "Spider-Man" match), collapse spaces
function whoamiNormalize(str) {
    return String(str || '').toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

// All accepted answers for a character: the full name, its last word
// (when ≥ 4 letters, so "Bolt" counts but "Pan" alone doesn't), and aliases
function whoamiAnswers(character) {
    const answers = new Set();
    const full = whoamiNormalize(character.name);
    answers.add(full);
    const tokens = full.split(' ');
    const last = tokens[tokens.length - 1];
    if (tokens.length > 1 && last.length >= 4) answers.add(last);
    for (const alias of character.accepts || []) {
        const a = whoamiNormalize(alias);
        if (a) answers.add(a);
    }
    return [...answers];
}

// ── Who Am I? server logic ──────────────────────────────────────────
// Mixed into GameRoom.prototype (see game-room.js), so `this` is the room.

const whoamiMethods = {

    registerWhoamiMessages() {
        // Host configures how many rounds the game lasts
        this.onMessage('setWhoRounds', (client, rounds) => {
            if (this.state.phase !== 'lobby') return;
            if (client.sessionId !== this.state.hostId) return;
            const n = Math.floor(Number(rounds));
            if (!Number.isFinite(n) || n < 1 || n > WHOAMI_CONFIG.maxRounds) return;
            this.state.whoTotalRounds = n;
        });

        // A player submits a character guess
        this.onMessage('whoGuess', (client, text) => {
            if (this.state.gameType !== 'whoami' || this.state.phase !== 'playing') return;
            if (this.state.whoPhase !== 'clue' || this.state.winnerId) return;
            const player = this.state.players.get(client.sessionId);
            if (!player || player.isSpectator || player.whoGuessed) return;
            const guess = whoamiNormalize(text).substring(0, WHOAMI_CONFIG.guessMaxLength);
            if (!guess) return;

            const internal = this.playerInternal.get(client.sessionId);
            if (internal) internal.lastActivityTime = Date.now();

            const name = player.playerName || 'Anonymous';
            if (this.whoAnswers.includes(guess)) {
                // Points by clues revealed: fewer clues = more points
                const idx = Math.min(this.state.whoCluesRevealed, WHOAMI_CONFIG.cluesPerCharacter) - 1;
                const pts = WHOAMI_CONFIG.guessPoints[idx];
                player.whoGuessed = true;
                player.score += pts;
                this.whoTurnPts.set(client.sessionId, pts);
                this.broadcast('whoFeed', { name, correct: true, pts });
            } else {
                // Wrong guesses are public banter; near-misses get a private nudge
                this.broadcast('whoFeed', { name, text: guess });
                if (this.whoAnswers.some(a => drawitIsClose(guess, a))) {
                    client.send('whoFeed', { name: '', close: true, text: `"${guess}" is so close!` });
                }
            }
        });
    },

    startWhoamiGame() {
        console.log('Starting Who Am I? game...');
        this.clearGameObjects();
        this.clearBoard();

        this.state.gridWidth = WHOAMI_CONFIG.width;
        this.state.gridHeight = WHOAMI_CONFIG.height;
        this.participantsAtStart = this.state.players.size;

        for (const [sessionId, player] of this.state.players) {
            player.isSpectator = false;
            player.ready = false;
            player.alive = true;
            player.killedBy = '';
            player.isMoving = false;
            player.score = 0;
            player.whoGuessed = false;
            const internal = this.playerInternal.get(sessionId);
            if (internal) internal.lastActivityTime = Date.now();
        }

        // Shuffled character pool (refilled if a long game runs out)
        this.whoPool = this.shuffledWhoCharacters();

        this.startWhoRound(1);
        this.state.phase = 'playing';
        this.updateMetadata();
    },

    shuffledWhoCharacters() {
        const pool = WHOAMI_CHARACTERS.slice();
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool;
    },

    startWhoRound(round) {
        if (this.whoPool.length === 0) this.whoPool = this.shuffledWhoCharacters();
        const character = this.whoPool.pop();
        const now = Date.now();

        this.state.whoRound = round;
        this.state.whoPhase = 'clue';
        this.state.whoCharacter = '';
        this.state.whoClues = character.clues[0];
        this.state.whoCluesRevealed = 1;
        this.state.whoDeadline = now
            + WHOAMI_CONFIG.clueIntervalMs * (WHOAMI_CONFIG.cluesPerCharacter - 1)
            + WHOAMI_CONFIG.lastClueGraceMs;

        for (const [, player] of this.state.players) {
            player.whoGuessed = false;
        }

        // The character stays server-side; clients only see revealed clues
        this.whoCharacter = character;
        this.whoAnswers = whoamiAnswers(character);
        this.whoTurnPts = new Map();
        this.whoClueTimes = [];
        for (let i = 1; i < WHOAMI_CONFIG.cluesPerCharacter; i++) {
            this.whoClueTimes.push(now + WHOAMI_CONFIG.clueIntervalMs * i);
        }
    },

    revealWhoRound() {
        this.state.whoPhase = 'reveal';
        this.state.whoDeadline = 0;
        this.state.whoCharacter = this.whoCharacter.name;
        // Show the full clue card during the reveal
        this.state.whoClues = this.whoCharacter.clues.join('\n');
        this.state.whoCluesRevealed = WHOAMI_CONFIG.cluesPerCharacter;

        const results = [];
        for (const [id, pts] of this.whoTurnPts) {
            const p = this.state.players.get(id);
            results.push({ id, playerName: p ? (p.playerName || 'Anonymous') : 'Anonymous', pts });
        }
        this.broadcast('whoReveal', { name: this.whoCharacter.name, results });

        this.whoRoundTimeout = setTimeout(() => {
            this.whoRoundTimeout = null;
            if (this.state.phase !== 'playing' || this.state.gameType !== 'whoami') return;
            if (this.state.whoRound >= this.state.whoTotalRounds) {
                this.finishWhoamiGame();
            } else {
                this.startWhoRound(this.state.whoRound + 1);
            }
        }, WHOAMI_CONFIG.revealDelay);
    },

    finishWhoamiGame() {
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
        console.log(`Who Am I? over: ${this.state.winnerId} (${bestScore} pts)`);
        this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
    },

    updateWhoamiState() {
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
        // Walkover only applies to games that started multiplayer:
        // solo games (minPlayers is 1) just play out normally
        if (active.length === 1 && this.participantsAtStart > 1) {
            this.state.winnerId = active[0];
            if (this.whoRoundTimeout) {
                clearTimeout(this.whoRoundTimeout);
                this.whoRoundTimeout = null;
            }
            this.restartTimeout = setTimeout(() => this.returnToLobby(), 5000);
            return;
        }

        if (this.state.whoPhase !== 'clue') return; // 'reveal' advances via whoRoundTimeout

        const now = Date.now();
        while (this.whoClueTimes.length && now >= this.whoClueTimes[0]) {
            this.whoClueTimes.shift();
            const idx = this.state.whoCluesRevealed; // next clue index (0-based)
            this.state.whoCluesRevealed = idx + 1;
            this.state.whoClues += '\n' + this.whoCharacter.clues[idx];
        }

        let waiting = 0;
        for (const id of active) {
            const p = this.state.players.get(id);
            if (p && !p.whoGuessed) waiting++;
        }
        if (waiting === 0 || now > this.state.whoDeadline) {
            this.revealWhoRound();
        }
    },
};

module.exports = { WHOAMI_CONFIG, WHOAMI_CHARACTERS, whoamiMethods };
