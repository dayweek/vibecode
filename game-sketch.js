// ── Shared client core: connection, lobby UI and p5 lifecycle ──────
// Per-game rendering/input lives in bomberman-sketch.js, snake-sketch.js,
// hangman-sketch.js and vibecheck-sketch.js (all loaded together; p5 global mode).

let room; // Colyseus room instance
let colyseusClient; // Colyseus client instance
let playerId;
let players = new Map(); // Map of playerId -> player data
let winnerId = null;

// Lobby state
let gamePhase = 'lobby'; // 'lobby' or 'playing' (synced from server)
let gameType = 'bomberman'; // 'bomberman', 'snake', 'hangman' or 'vibecheck' (synced from server)
let hostId = '';

let amSpectator = false;
let roomPollInterval = null;
let lobbyButtonsInitialized = false;

// Variable for player color
let myColor = null;

// Sound effects toggle - load from localStorage or default to true
let isSoundEnabled = localStorage.getItem('bomberman_sound_enabled') !== 'false'; // Sound on by default

// Player name
let playerName = localStorage.getItem('bomberman_player_name') || '';

function preload() {
    preloadBombermanAssets();
}

function setup() {
    const canvas = createCanvas(960, 800); // 20% wider
    // Insert canvas into the canvas-container div
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
        canvas.parent(canvasContainer);
    } else {
        canvas.parent('game-container');
    }
    frameRate(30);

    // Handle welcome modal
    const welcomeModal = document.getElementById('welcome-modal');
    const nameInput = document.getElementById('name-input');
    const startGameBtn = document.getElementById('start-game-btn');

    // If player already has a name, hide welcome modal and go to the lobby flow
    if (playerName) {
        welcomeModal.style.display = 'none';
        initFlow();
    } else {
        // Show welcome modal and wait for name input
        nameInput.value = '';

        const startGameHandler = () => {
            const inputName = nameInput.value.trim();
            if (inputName) {
                playerName = inputName;
                localStorage.setItem('bomberman_player_name', playerName);
                welcomeModal.style.display = 'none';
                initFlow();
            }
        };

        startGameBtn.addEventListener('click', startGameHandler);
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                startGameHandler();
            }
        });
    }
}

// ── Lobby flow ──────────────────────────────────────────────────────

function initFlow() {
    updateNameDisplay();
    setupLobbyButtons();
    setupAudioButtons();

    // Connect to Colyseus server
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    colyseusClient = new Colyseus.Client(`${wsProtocol}://${window.location.host}`);

    // Deep link: ?room=<id> joins that room directly
    const roomId = new URLSearchParams(window.location.search).get('room');
    if (roomId) {
        joinRoomById(roomId);
    } else {
        showScreen('browser');
    }
}

function joinOptions() {
    let persistentId = localStorage.getItem('bomberman_player_id');
    if (!persistentId) {
        persistentId = 'player_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
        localStorage.setItem('bomberman_player_id', persistentId);
    }
    return { persistentId: persistentId, playerName: playerName };
}

function setRoomUrl(roomId) {
    const url = new URL(window.location.href);
    if (roomId) {
        url.searchParams.set('room', roomId);
    } else {
        url.searchParams.delete('room');
    }
    history.replaceState(null, '', url.toString());
}

// Show one of the three screens: 'browser', 'waiting', 'game'
function showScreen(name) {
    const browser = document.getElementById('room-browser');
    const waiting = document.getElementById('waiting-room');
    const game = document.getElementById('game-container');
    if (browser) browser.style.display = name === 'browser' ? 'flex' : 'none';
    if (waiting) waiting.style.display = name === 'waiting' ? 'flex' : 'none';
    if (game) game.style.display = name === 'game' ? 'flex' : 'none';

    // Poll the public room list only while browsing
    if (name === 'browser') {
        fetchRooms();
        if (!roomPollInterval) roomPollInterval = setInterval(fetchRooms, 3000);
    } else if (roomPollInterval) {
        clearInterval(roomPollInterval);
        roomPollInterval = null;
    }
}

async function fetchRooms() {
    const listEl = document.getElementById('room-list');
    try {
        const res = await fetch('/api/rooms', { cache: 'no-store' });
        const rooms = await res.json();
        renderRoomList(rooms);
    } catch (e) {
        if (listEl) listEl.innerHTML = '<p class="muted">Could not load rooms.</p>';
    }
}

// Background tabs throttle setInterval heavily, so the list can go stale
// while the user is away — refresh it the moment the tab is visible again.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && roomPollInterval) fetchRooms();
});
window.addEventListener('focus', () => {
    if (roomPollInterval) fetchRooms();
});

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Pick a stable decorative character sprite for a room card
function roomSpriteFile(roomId) {
    let h = 0;
    for (let i = 0; i < roomId.length; i++) {
        h = (h * 31 + roomId.charCodeAt(i)) >>> 0;
    }
    return 'bomberman-assets/characters/' + characterFiles[h % characterFiles.length];
}

function renderRoomList(rooms) {
    const listEl = document.getElementById('room-list');
    if (!listEl) return;

    if (!rooms || rooms.length === 0) {
        listEl.innerHTML =
            '<div class="room-empty">' +
            '<img src="bomberman-assets/weapon_bomb.png" alt="">' +
            'No rooms yet.<br>Create one and share the link.' +
            '</div>';
        return;
    }

    listEl.innerHTML = '';
    rooms.forEach(r => {
        const meta = r.metadata || {};
        const inGame = meta.phase === 'playing';
        const item = document.createElement('div');
        item.className = 'room-item';

        const sprite = document.createElement('img');
        sprite.className = 'room-sprite';
        sprite.alt = '';
        sprite.src = roomSpriteFile(r.roomId);

        const body = document.createElement('div');
        body.className = 'room-body';
        const gameLabel = meta.gameType === 'snake' ? '🐍 Snake'
            : meta.gameType === 'hangman' ? '🔤 Hangman'
            : meta.gameType === 'vibecheck' ? '📡 Vibe Check'
            : meta.gameType === 'drawit' ? '✏️ Draw It'
            : meta.gameType === 'whoami' ? '🎭 Who Am I?' : '💣 Bomberman';
        body.innerHTML =
            `<div class="room-name">${escapeHtml(meta.hostName || 'Unknown')}'s room</div>` +
            `<div class="room-meta">${gameLabel} &middot; ${r.clients}/${r.maxClients} players &middot; ` +
            (inGame ? '<span class="tag tag-live">In game</span>' : '<span class="tag tag-wait">Waiting</span>') +
            `</div>`;

        const joinBtn = document.createElement('button');
        joinBtn.className = 'px-btn' + (inGame ? '' : ' gold');
        joinBtn.textContent = inGame ? 'Watch' : 'Join';
        joinBtn.addEventListener('click', () => joinRoomById(r.roomId));

        item.appendChild(sprite);
        item.appendChild(body);
        item.appendChild(joinBtn);
        listEl.appendChild(item);
    });
}

function setupLobbyButtons() {
    if (lobbyButtonsInitialized) return;
    lobbyButtonsInitialized = true;

    const createBtn = document.getElementById('create-room-btn');
    if (createBtn) createBtn.addEventListener('click', createRoom);

    // Game selector in the lobby (host only; server validates too)
    const gameBombermanBtn = document.getElementById('lobby-game-bomberman');
    if (gameBombermanBtn) gameBombermanBtn.addEventListener('click', () => {
        if (room) room.send('setGameType', 'bomberman');
    });
    const gameSnakeBtn = document.getElementById('lobby-game-snake');
    if (gameSnakeBtn) gameSnakeBtn.addEventListener('click', () => {
        if (room) room.send('setGameType', 'snake');
    });
    const gameHangmanBtn = document.getElementById('lobby-game-hangman');
    if (gameHangmanBtn) gameHangmanBtn.addEventListener('click', () => {
        if (room) room.send('setGameType', 'hangman');
    });
    const gameVibecheckBtn = document.getElementById('lobby-game-vibecheck');
    if (gameVibecheckBtn) gameVibecheckBtn.addEventListener('click', () => {
        if (room) room.send('setGameType', 'vibecheck');
    });
    const gameDrawitBtn = document.getElementById('lobby-game-drawit');
    if (gameDrawitBtn) gameDrawitBtn.addEventListener('click', () => {
        if (room) room.send('setGameType', 'drawit');
    });
    const gameWhoamiBtn = document.getElementById('lobby-game-whoami');
    if (gameWhoamiBtn) gameWhoamiBtn.addEventListener('click', () => {
        if (room) room.send('setGameType', 'whoami');
    });

    // Hangman lobby setup: theme + rounds (host), team picks, random split (host)
    document.querySelectorAll('#hangman-themes .theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (room) room.send('setTheme', btn.dataset.theme);
        });
    });
    document.querySelectorAll('#hangman-rounds .rounds-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (room) room.send('setRounds', parseInt(btn.dataset.rounds, 10));
        });
    });

    // Vibe Check lobby setup: rounds (host)
    document.querySelectorAll('#vibe-rounds .rounds-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (room) room.send('setVibeRounds', parseInt(btn.dataset.rounds, 10));
        });
    });

    // Draw It lobby setup: rounds (host)
    document.querySelectorAll('#draw-rounds .rounds-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (room) room.send('setDrawRounds', parseInt(btn.dataset.rounds, 10));
        });
    });

    // Who Am I? lobby setup: rounds (host)
    document.querySelectorAll('#who-rounds .rounds-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (room) room.send('setWhoRounds', parseInt(btn.dataset.rounds, 10));
        });
    });
    const joinTeamA = document.getElementById('join-team-a');
    if (joinTeamA) joinTeamA.addEventListener('click', () => {
        if (room) room.send('setTeam', 'A');
    });
    const joinTeamB = document.getElementById('join-team-b');
    if (joinTeamB) joinTeamB.addEventListener('click', () => {
        if (room) room.send('setTeam', 'B');
    });
    const randomTeamsBtn = document.getElementById('random-teams-btn');
    if (randomTeamsBtn) randomTeamsBtn.addEventListener('click', () => {
        if (room) room.send('randomizeTeams');
    });

    const readyBtn = document.getElementById('ready-btn');
    if (readyBtn) readyBtn.addEventListener('click', () => {
        if (!room) return;
        const me = players.get(playerId);
        room.send('setReady', !(me && me.ready));
    });

    const startBtn = document.getElementById('start-btn');
    if (startBtn) startBtn.addEventListener('click', () => {
        if (room) room.send('startGame');
    });

    const leaveRoomBtn = document.getElementById('leave-room-btn');
    if (leaveRoomBtn) leaveRoomBtn.addEventListener('click', leaveRoom);

    // Name changes are only allowed from the waiting room
    const editNameBtn = document.getElementById('lobby-edit-name-btn');
    if (editNameBtn) editNameBtn.addEventListener('click', () => {
        const newName = prompt('Enter your new name:', playerName);
        if (newName && newName.trim()) {
            playerName = newName.trim().substring(0, 20);
            localStorage.setItem('bomberman_player_name', playerName);
            updateNameDisplay();
            if (room) room.send('update_player_name', playerName);
        }
    });

    const leaveGameBtn = document.getElementById('leaveGameButton');
    if (leaveGameBtn) leaveGameBtn.addEventListener('click', leaveRoom);

    const copyBtn = document.getElementById('copy-link-btn');
    if (copyBtn) copyBtn.addEventListener('click', () => {
        const linkInput = document.getElementById('room-link');
        if (!linkInput) return;
        const doneLabel = () => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(linkInput.value).then(doneLabel).catch(() => {});
        } else {
            linkInput.select();
            document.execCommand('copy');
            doneLabel();
        }
    });
}

function leaveRoom() {
    stopSpectatorBanner();
    if (room) {
        const r = room;
        room = null;
        r.leave();
    }
    players.clear();
    playerCharacterMap.clear();
    winnerId = null;
    gamePhase = 'lobby';
    setRoomUrl(null);
    showScreen('browser');
}

function stopSpectatorBanner() {
    const banner = document.getElementById('spectator-banner');
    if (banner) banner.style.display = 'none';
}

async function createRoom() {
    await connectToRoom(() => colyseusClient.create('game', joinOptions()));
}

async function joinRoomById(roomId) {
    const ok = await connectToRoom(() => colyseusClient.joinById(roomId, joinOptions()));
    if (!ok) {
        alert('Could not join that room — it may no longer exist.');
        setRoomUrl(null);
        showScreen('browser');
    }
}

// ── Room connection ─────────────────────────────────────────────────

async function connectToRoom(joinFn) {
    try {
        room = await joinFn();

        playerId = room.sessionId;
        console.log('Connected to Bomberman room:', room.roomId, 'as', playerId);

        myColor = null;
        const yourColorDiv = document.getElementById('your-color');
        if (yourColorDiv) yourColorDiv.style.display = 'none';

        // Make the room shareable: put the room id in the URL and share box
        setRoomUrl(room.roomId);
        const linkInput = document.getElementById('room-link');
        if (linkInput) linkInput.value = window.location.href;
        showScreen('waiting');

        // ── State change listeners ──────────────────────────────────

        // Sync state on every patch from the server
        room.onStateChange((state) => {
            gamePhase = state.phase || 'lobby';
            gameType = state.gameType || 'bomberman';
            hostId = state.hostId || '';

            // Per-game state sync (arrays, hangman fields, snake food)
            syncBombermanState(state);
            syncSnakeState(state);
            syncHangmanState(state);
            syncVibecheckState(state);
            syncDrawitState(state);
            syncWhoamiState(state);

            // Sync players from MapSchema
            const currentIds = new Set();
            state.players.forEach((serverPlayer, id) => {
                currentIds.add(id);
                if (players.has(id)) {
                    const localPlayer = players.get(id);

                    if (localPlayer.renderX === undefined) {
                        localPlayer.renderX = serverPlayer.x;
                        localPlayer.renderY = serverPlayer.y;
                    }

                    if (localPlayer.targetX !== serverPlayer.x || localPlayer.targetY !== serverPlayer.y) {
                        const jump = Math.abs(serverPlayer.x - localPlayer.targetX) + Math.abs(serverPlayer.y - localPlayer.targetY);
                        if (jump > scl) {
                            // Teleport (respawn / grid resize): snap instead of animating
                            localPlayer.waypoints = [];
                            localPlayer.renderX = serverPlayer.x;
                            localPlayer.renderY = serverPlayer.y;
                            localPlayer.renderSpeed = 0;
                        } else {
                            // Normal one-tile step: queue it so the renderer
                            // follows the actual path (no diagonal shortcuts)
                            (localPlayer.waypoints = localPlayer.waypoints || []).push({ x: serverPlayer.x, y: serverPlayer.y });
                        }
                        localPlayer.targetX = serverPlayer.x;
                        localPlayer.targetY = serverPlayer.y;
                    }

                    localPlayer.color = serverPlayer.color;
                    localPlayer.playerName = serverPlayer.playerName;
                    localPlayer.alive = serverPlayer.alive;
                    localPlayer.activeBombs = serverPlayer.activeBombs;
                    localPlayer.maxBombs = serverPlayer.maxBombs;
                    localPlayer.bombRange = serverPlayer.bombRange;
                    localPlayer.speedBoosts = serverPlayer.speedBoosts;
                    localPlayer.invisibleUntil = serverPlayer.invisibleUntil;
                    localPlayer.invisible = serverPlayer.invisible;
                    localPlayer.isMoving = serverPlayer.isMoving;
                    localPlayer.lives = serverPlayer.lives;
                    localPlayer.killedBy = serverPlayer.killedBy;
                    localPlayer.protectedUntil = serverPlayer.protectedUntil;
                    localPlayer.ready = serverPlayer.ready;
                    localPlayer.isSpectator = serverPlayer.isSpectator;
                    localPlayer.team = serverPlayer.team || '';
                    localPlayer.vibeGuess = serverPlayer.vibeGuess !== undefined ? serverPlayer.vibeGuess : -1;
                    localPlayer.vibeLocked = !!serverPlayer.vibeLocked;
                    localPlayer.drawGuessed = !!serverPlayer.drawGuessed;
                    localPlayer.whoGuessed = !!serverPlayer.whoGuessed;
                    syncSnakeFields(localPlayer, serverPlayer);
                } else {
                    players.set(id, {
                        id: id,
                        x: serverPlayer.x,
                        y: serverPlayer.y,
                        renderX: serverPlayer.x,
                        renderY: serverPlayer.y,
                        targetX: serverPlayer.x,
                        targetY: serverPlayer.y,
                        renderSpeed: 0,
                        waypoints: [],
                        color: serverPlayer.color,
                        playerName: serverPlayer.playerName,
                        alive: serverPlayer.alive,
                        activeBombs: serverPlayer.activeBombs,
                        maxBombs: serverPlayer.maxBombs,
                        bombRange: serverPlayer.bombRange,
                        speedBoosts: serverPlayer.speedBoosts,
                        invisibleUntil: serverPlayer.invisibleUntil,
                        invisible: serverPlayer.invisible,
                        isMoving: serverPlayer.isMoving,
                        lives: serverPlayer.lives,
                        killedBy: serverPlayer.killedBy,
                        protectedUntil: serverPlayer.protectedUntil,
                        ready: serverPlayer.ready,
                        isSpectator: serverPlayer.isSpectator,
                        team: serverPlayer.team || '',
                        vibeGuess: serverPlayer.vibeGuess !== undefined ? serverPlayer.vibeGuess : -1,
                        vibeLocked: !!serverPlayer.vibeLocked,
                        drawGuessed: !!serverPlayer.drawGuessed,
                        whoGuessed: !!serverPlayer.whoGuessed,
                    });
                    syncSnakeFields(players.get(id), serverPlayer);
                }
            });

            // Remove disconnected players
            for (const [id] of players) {
                if (!currentIds.has(id)) {
                    players.delete(id);
                    playerCharacterMap.delete(id);
                }
            }

            // Update canvas size if grid dimensions changed
            if (state.gridWidth && state.gridHeight) {
                if (width !== state.gridWidth || height !== state.gridHeight) {
                    resizeCanvas(state.gridWidth, state.gridHeight);
                    generateFloorGrid();
                }
            }

            // Winner detection
            winnerId = state.winnerId || null;

            // Switch between waiting room and game views
            updateScreens();
        });

        // ── Message listeners (sounds, color) ───────────────────────

        room.onMessage('playerColor', (color) => {
            myColor = color;
            console.log(`Your color is: ${myColor}`);
            const colorDisplay = document.getElementById('color-display');
            const yourColorDiv2 = document.getElementById('your-color');
            if (colorDisplay && yourColorDiv2) {
                colorDisplay.style.backgroundColor = color;
                yourColorDiv2.style.display = 'block';
            }
        });

        room.onMessage('playEatSound', () => {
            if (!isSoundEnabled) return;
            const eatSound = document.getElementById('eatSound');
            if (eatSound) { eatSound.currentTime = 0; eatSound.play().catch(() => {}); }
        });

        room.onMessage('playDieSound', () => {
            if (!isSoundEnabled) return;
            const dieSound = document.getElementById('dieSound');
            if (dieSound) { dieSound.currentTime = 0; dieSound.play().catch(() => {}); }
        });

        room.onMessage('playWinSound', () => {
            if (!isSoundEnabled) return;
            const winSound = document.getElementById('winSound');
            if (winSound) { winSound.currentTime = 0; winSound.play().catch(() => {}); }
        });

        room.onMessage('playExplosionSound', () => {
            if (!isSoundEnabled) return;
            const explosionSound = document.getElementById('explosionSound');
            if (explosionSound) { explosionSound.currentTime = 0; explosionSound.play().catch(() => {}); }
        });

        room.onMessage('playLevelUpSound', () => {
            if (!isSoundEnabled) return;
            const levelUpSound = document.getElementById('levelUpSound');
            if (levelUpSound) { levelUpSound.currentTime = 0; levelUpSound.play().catch(() => {}); }
        });

        room.onMessage('playNewSound', () => {
            if (!isSoundEnabled) return;
            const newSound = document.getElementById('newSound');
            if (newSound) { newSound.currentTime = 0; newSound.play().catch(() => {}); }
        });

        // Hangman guess/round-end feedback notices
        setupHangmanMessages(room);

        // Vibe Check private target + reveal results
        setupVibecheckMessages(room);

        // Draw It private word + stroke relay + guess feed
        setupDrawitMessages(room);

        // Who Am I? guess feed + round reveal
        setupWhoamiMessages(room);

        // Handle room errors and disconnection
        room.onError((code, message) => {
            console.error('Room error:', code, message);
        });

        const thisRoom = room;
        room.onLeave((code) => {
            console.log('Left room:', code);
            // Unexpected disconnect (kicked, room disposed, timeout):
            // go back to the room browser. Intentional leaves already
            // cleared `room` in leaveRoom().
            if (room === thisRoom) {
                room = null;
                players.clear();
                winnerId = null;
                gamePhase = 'lobby';
                stopSpectatorBanner();
                setRoomUrl(null);
                showScreen('browser');
            }
        });

    } catch (e) {
        console.error('Failed to join Bomberman room:', e);
        return false;
    }

    return true;
}

// One-time music/sound toggle setup
function setupAudioButtons() {
    const toggleMusicButton = document.getElementById('toggleMusicButton');
    const backgroundMusic = document.getElementById('backgroundMusic');

    if (toggleMusicButton && backgroundMusic) {
        let isMusicPlaying = false;
        toggleMusicButton.textContent = 'Play Music';

        toggleMusicButton.addEventListener('click', () => {
            if (isMusicPlaying) {
                backgroundMusic.pause();
                toggleMusicButton.textContent = 'Play Music';
            } else {
                backgroundMusic.play().catch(error => {
                    console.error("Error playing music:", error);
                });
                toggleMusicButton.textContent = 'Pause Music';
            }
            isMusicPlaying = !isMusicPlaying;
        });
    }

    const toggleSoundButton = document.getElementById('toggleSoundButton');
    if (toggleSoundButton) {
        toggleSoundButton.textContent = isSoundEnabled ? 'Sound On' : 'Sound Off';

        toggleSoundButton.addEventListener('click', () => {
            isSoundEnabled = !isSoundEnabled;
            toggleSoundButton.textContent = isSoundEnabled ? 'Sound On' : 'Sound Off';
            localStorage.setItem('bomberman_sound_enabled', isSoundEnabled);
        });
    }
}

// ── Screen / lobby UI updates ───────────────────────────────────────

let _lastHudGameType = null;

function updateScreens() {
    if (!room) return;

    const me = players.get(playerId);
    amSpectator = !!(me && me.isSpectator);
    const banner = document.getElementById('spectator-banner');

    if (gamePhase === 'playing') {
        showScreen('game');
        if (banner) banner.style.display = amSpectator ? 'block' : 'none';

        // Force the players HUD text to refresh when the game type changes
        // (snake says "Playing", bomberman says "Alive")
        if (_lastHudGameType !== gameType) {
            _lastHudGameType = gameType;
            _uiCache.lastAlive = -1;
        }

        // Bomberman-specific HUD boxes are hidden for the other games
        const minimalHud = gameType !== 'bomberman';
        const livesBox = document.getElementById('lives-status');
        if (livesBox) livesBox.style.display = minimalHud ? 'none' : '';
        // The alive/playing counter means nothing in the party games
        const statsBox = document.getElementById('game-stats');
        if (statsBox) statsBox.style.display = (gameType === 'hangman' || gameType === 'vibecheck'
            || gameType === 'drawit' || gameType === 'whoami') ? 'none' : '';
        if (minimalHud) {
            const invisBox = document.getElementById('invisibility-status');
            if (invisBox) invisBox.style.display = 'none';
            const avatarBox = document.getElementById('your-color');
            if (avatarBox) avatarBox.style.display = 'none';
            const bombsBox = document.getElementById('active-bombs-display');
            if (bombsBox) bombsBox.style.display = 'none';
        }
    } else {
        showScreen('waiting');
        if (banner) banner.style.display = 'none';
        updateLobbyUI();
    }
}

function updateLobbyUI() {
    const listEl = document.getElementById('lobby-players');
    const readyBtn = document.getElementById('ready-btn');
    const startBtn = document.getElementById('start-btn');
    const statusEl = document.getElementById('lobby-status');
    if (!listEl) return;

    const me = players.get(playerId);
    const isHost = playerId === hostId;

    let othersReady = true;
    let html = '';
    players.forEach((p, id) => {
        const isRoomHost = id === hostId;
        const isSetReady = isRoomHost || p.ready;
        if (!isSetReady) othersReady = false;

        // Same sprite assignment as in-game rendering, so the lobby shows
        // the character you'll actually spawn as
        if (!playerCharacterMap.has(id)) {
            playerCharacterMap.set(id, nextCharacterIndex % characterFiles.length);
            nextCharacterIndex++;
        }
        const spriteFile = 'bomberman-assets/characters/' + characterFiles[playerCharacterMap.get(id) % characterFiles.length];

        let tag;
        if (isRoomHost) {
            tag = '<span class="tag tag-host">Host</span>';
        } else if (p.ready) {
            tag = '<span class="tag tag-ready">Ready</span>';
        } else {
            tag = '<span class="tag tag-wait">Waiting</span>';
        }

        const name = escapeHtml(p.playerName || 'Anonymous');
        html +=
            `<div class="spawn-pad ${isSetReady ? 'is-ready' : 'is-waiting'}">` +
            `<div class="pad-tile"><img src="${spriteFile}" alt=""></div>` +
            `<div class="pad-name">${name}${id === playerId ? ' <span class="you">(you)</span>' : ''}</div>` +
            tag +
            `</div>`;
    });
    listEl.innerHTML = html;

    // Game selector: reflect the server's choice; only the host can change it
    const gameBombermanBtn = document.getElementById('lobby-game-bomberman');
    const gameSnakeBtn = document.getElementById('lobby-game-snake');
    const gameHangmanBtn = document.getElementById('lobby-game-hangman');
    const gameVibecheckBtn = document.getElementById('lobby-game-vibecheck');
    const gameDrawitBtn = document.getElementById('lobby-game-drawit');
    const gameWhoamiBtn = document.getElementById('lobby-game-whoami');
    if (gameBombermanBtn && gameSnakeBtn && gameHangmanBtn && gameVibecheckBtn && gameDrawitBtn && gameWhoamiBtn) {
        gameBombermanBtn.classList.toggle('active', gameType === 'bomberman');
        gameSnakeBtn.classList.toggle('active', gameType === 'snake');
        gameHangmanBtn.classList.toggle('active', gameType === 'hangman');
        gameVibecheckBtn.classList.toggle('active', gameType === 'vibecheck');
        gameDrawitBtn.classList.toggle('active', gameType === 'drawit');
        gameWhoamiBtn.classList.toggle('active', gameType === 'whoami');
        gameBombermanBtn.disabled = !isHost;
        gameSnakeBtn.disabled = !isHost;
        gameHangmanBtn.disabled = !isHost;
        gameVibecheckBtn.disabled = !isHost;
        gameDrawitBtn.disabled = !isHost;
        gameWhoamiBtn.disabled = !isHost;
    }

    // Hangman setup: rounds + team split (only visible when hangman is picked)
    const hangmanSetup = document.getElementById('hangman-setup');
    if (hangmanSetup) hangmanSetup.style.display = gameType === 'hangman' ? 'block' : 'none';
    let teamsValid = true;
    if (gameType === 'hangman') {
        document.querySelectorAll('#hangman-themes .theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === hangman.theme);
            btn.disabled = !isHost;
        });
        document.querySelectorAll('#hangman-rounds .rounds-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.rounds, 10) === hangman.totalRounds);
            btn.disabled = !isHost;
        });

        let countA = 0, countB = 0, unassigned = 0;
        const listA = [], listB = [];
        players.forEach((p, id) => {
            const memberHtml =
                `<div class="team-member">${escapeHtml(p.playerName || 'Anonymous')}` +
                `${id === playerId ? ' <span class="you">(you)</span>' : ''}</div>`;
            if (p.team === 'A') { countA++; listA.push(memberHtml); }
            else if (p.team === 'B') { countB++; listB.push(memberHtml); }
            else unassigned++;
        });
        const teamAEl = document.getElementById('team-a-list');
        if (teamAEl) teamAEl.innerHTML = listA.join('') || '<div class="muted">Empty</div>';
        const teamBEl = document.getElementById('team-b-list');
        if (teamBEl) teamBEl.innerHTML = listB.join('') || '<div class="muted">Empty</div>';
        teamsValid = countA > 0 && countB > 0 && unassigned === 0;

        const joinTeamA = document.getElementById('join-team-a');
        if (joinTeamA) joinTeamA.disabled = !!(me && me.team === 'A');
        const joinTeamB = document.getElementById('join-team-b');
        if (joinTeamB) joinTeamB.disabled = !!(me && me.team === 'B');
        const randomBtn = document.getElementById('random-teams-btn');
        if (randomBtn) randomBtn.style.display = isHost ? 'block' : 'none';
    }

    // Vibe Check setup: rounds (only visible when vibe check is picked)
    const vibecheckSetup = document.getElementById('vibecheck-setup');
    if (vibecheckSetup) vibecheckSetup.style.display = gameType === 'vibecheck' ? 'block' : 'none';
    let vibeValid = true;
    if (gameType === 'vibecheck') {
        document.querySelectorAll('#vibe-rounds .rounds-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.rounds, 10) === vibe.totalRounds);
            btn.disabled = !isHost;
        });
        vibeValid = players.size >= 2;
    }

    // Draw It setup: rounds (only visible when draw it is picked)
    const drawitSetup = document.getElementById('drawit-setup');
    if (drawitSetup) drawitSetup.style.display = gameType === 'drawit' ? 'block' : 'none';
    let drawValid = true;
    if (gameType === 'drawit') {
        document.querySelectorAll('#draw-rounds .rounds-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.rounds, 10) === drawit.totalRounds);
            btn.disabled = !isHost;
        });
        drawValid = players.size >= 2;
    }

    // Who Am I? setup: rounds (only visible when who am i is picked; solo is fine)
    const whoamiSetup = document.getElementById('whoami-setup');
    if (whoamiSetup) whoamiSetup.style.display = gameType === 'whoami' ? 'block' : 'none';
    if (gameType === 'whoami') {
        document.querySelectorAll('#who-rounds .rounds-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.rounds, 10) === who.totalRounds);
            btn.disabled = !isHost;
        });
    }

    if (readyBtn) {
        readyBtn.style.display = isHost ? 'none' : 'block';
        const amReady = !!(me && me.ready);
        readyBtn.textContent = amReady ? 'Cancel ready' : "I'm Ready";
        readyBtn.className = amReady ? 'px-btn' : 'px-btn green';
    }
    if (startBtn) {
        startBtn.style.display = isHost ? 'block' : 'none';
        startBtn.disabled = !othersReady || !teamsValid || !vibeValid || !drawValid;
    }
    if (statusEl) {
        if (isHost) {
            if (!othersReady) {
                statusEl.textContent = 'Waiting for everyone to ready up...';
            } else if (!teamsValid) {
                statusEl.textContent = 'Split everyone into two teams to start.';
            } else if (!vibeValid) {
                statusEl.textContent = 'Vibe Check needs at least 2 players.';
            } else if (!drawValid) {
                statusEl.textContent = 'Draw It needs at least 2 players.';
            } else {
                statusEl.textContent = players.size > 1
                    ? "Everyone's ready. Light the fuse!"
                    : 'You can start solo, or wait for friends.';
            }
        } else {
            statusEl.textContent = 'Waiting for the host to start...';
        }
    }
}

// Helper: convert Colyseus ArraySchema items to plain objects
function schemaArrayToPlain(schemaArray, fields) {
    const result = [];
    for (let i = 0; i < schemaArray.length; i++) {
        const item = schemaArray[i];
        const obj = {};
        for (const f of fields) {
            obj[f] = item[f];
        }
        result.push(obj);
    }
    return result;
}

// ── p5 lifecycle: render dispatch ───────────────────────────────────

function draw() {
    // Keep the psychic's clue input and the guess input in sync with the
    // current phase even when another screen or game is showing
    vibeUpdateClueBar();
    drawUpdateGuessBar();
    whoUpdateGuessBar();

    // Nothing to render while in the lobby (canvas is hidden anyway)
    if (gamePhase !== 'playing') {
        background(26);
        return;
    }

    if (gameType === 'snake') {
        drawSnakeGame();
    } else if (gameType === 'hangman') {
        drawHangmanGame();
    } else if (gameType === 'vibecheck') {
        drawVibecheckGame();
    } else if (gameType === 'drawit') {
        drawDrawitGame();
    } else if (gameType === 'whoami') {
        drawWhoamiGame();
    } else {
        drawBombermanGame();
    }
}

// Mouse position in canvas coordinates. p5 0.5.7 doesn't compensate for the
// canvas being scaled down by CSS (max-height: 80vh), so do it ourselves.
function canvasMouse() {
    const cnv = document.querySelector('#canvas-container canvas');
    if (cnv) {
        const rect = cnv.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            return { x: mouseX * (width / rect.width), y: mouseY * (height / rect.height) };
        }
    }
    return { x: mouseX, y: mouseY };
}

// ── p5 lifecycle: mouse dispatch ────────────────────────────────────
// Hangman guesses and Vibe Check markers are mouse/tap driven.

function mousePressed() {
    // Returning false preventDefaults the event, which would stop clicks on
    // the HTML UI (buttons, the Vibe Check clue input) from focusing/working
    // — only ever grab clicks that land on the game canvas itself.
    if (event && event.target && event.target.tagName !== 'CANVAS') return true;
    if (!room || gamePhase !== 'playing') return true;
    if (gameType === 'hangman') return hangmanMousePressed();
    if (gameType === 'vibecheck') return vibecheckMousePressed();
    if (gameType === 'drawit') return drawitMousePressed();
    return true;
}

function mouseDragged() {
    if (event && event.target && event.target.tagName !== 'CANVAS') return true;
    if (!room || gamePhase !== 'playing') return true;
    if (gameType === 'vibecheck') return vibecheckMouseDragged();
    if (gameType === 'drawit') return drawitMouseDragged();
    return true;
}

function mouseReleased() {
    // No target check here: a drag can end outside the canvas, and the
    // drawer's in-progress stroke must still be flushed and closed.
    if (!room || gamePhase !== 'playing') return true;
    if (gameType === 'drawit') return drawitMouseReleased();
    return true;
}

function updateNameDisplay() {
    const nameDisplay = document.getElementById('player-name-display');
    const nameText = document.getElementById('player-name-text');
    if (nameDisplay && nameText) {
        nameText.textContent = playerName || 'Anonymous';
        nameDisplay.style.display = 'block';
    }

    const lobbyName = document.getElementById('lobby-name');
    if (lobbyName) lobbyName.textContent = playerName || 'Anonymous';
}

function drawWinnerMessage() {
    let message;
    if (winnerId === 'teamA' || winnerId === 'teamB') {
        const team = winnerId === 'teamA' ? 'A' : 'B';
        const me = players.get(playerId);
        message = `${TEAM_INFO[team].name} wins!` +
            (me && me.team === team && !me.isSpectator ? ' 🎉' : '');
    } else if (winnerId === 'draw') {
        message = "It's a draw!";
    } else {
        const winner = players.get(winnerId);
        const winnerName = winnerId === playerId
            ? "You"
            : (winner && winner.playerName ? winner.playerName : `Player ${winnerId.substring(0, 6)}...`);
        message = winner ? `${winnerName} wins!` : "Game Over!";
    }

    fill(0, 0, 0, 150);
    rect(0, height / 2 - 50, width, 100);

    fill(255);
    textSize(32);
    textAlign(CENTER, CENTER);
    text(message, width / 2, height / 2 - 10);

    textSize(16);
    text("Returning to the lobby...", width / 2, height / 2 + 30);
}

// ── p5 lifecycle: keyboard dispatch ─────────────────────────────────

function keyPressed() {
    // Don't handle game controls if welcome modal is visible or if typing in input
    const welcomeModal = document.getElementById('welcome-modal');
    if (welcomeModal && welcomeModal.style.display !== 'none') {
        return true; // Allow normal keyboard input in modal
    }
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        return true; // Allow typing in input fields
    }

    // In the menus (room browser / lobby) the page should behave normally —
    // only grab keys while a game is actually being played
    if (!room || gamePhase !== 'playing') return true;

    // Prevent default for arrow keys and WASD to disable scrolling
    // Using keyCodes for WASD: W=87, A=65, S=83, D=68 (physical position, ignores layout)
    if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, 32, 87, 65, 83, 68].includes(keyCode)) {
        event.preventDefault();
    }

    // Game controls are paused on the winner screen
    if (winnerId) return false;

    if (!players.has(playerId)) return false;

    if (gameType === 'snake') {
        return snakeKeyPressed();
    }

    // Hangman: guessing is done by clicking the letter buttons, not typing
    if (gameType === 'hangman') return false;

    // Vibe Check: clue typing happens in an HTML input, guessing by mouse
    if (gameType === 'vibecheck') return false;

    // Draw It: guesses are typed in an HTML input, drawing is mouse-only
    if (gameType === 'drawit') return false;

    // Who Am I?: guesses are typed in an HTML input
    if (gameType === 'whoami') return false;

    return bombermanKeyPressed();
}

function keyReleased() {
    // Don't handle game controls if welcome modal is visible or if typing in input
    const welcomeModal = document.getElementById('welcome-modal');
    if (welcomeModal && welcomeModal.style.display !== 'none') {
        return true; // Allow normal keyboard input in modal
    }
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        return true; // Allow typing in input fields
    }

    // Keys are only grabbed during an active game, never in the menus
    if (!room || gamePhase !== 'playing') return true;

    // Prevent default for arrow keys and WASD
    if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, 32, 87, 65, 83, 68].includes(keyCode)) {
        event.preventDefault();
    }
    if (gameType === 'snake') return false; // Snake has no key-release handling
    if (gameType === 'hangman') return false; // Hangman guesses on key press only
    if (gameType === 'vibecheck') return false; // Vibe Check is mouse-only
    if (gameType === 'drawit') return false; // Draw It is mouse-only
    if (gameType === 'whoami') return false; // Who Am I? guesses via HTML input
    if (!players.has(playerId)) return false;

    return bombermanKeyReleased();
}
