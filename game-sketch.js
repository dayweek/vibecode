let scl = 32; // Tile size
let room; // Colyseus room instance
let colyseusClient; // Colyseus client instance
let playerId;
let players = new Map(); // Map of playerId -> player data
let bombPickups = []; // Bomb pickups on the map
let powerups = []; // Flame powerups on the map
let bombs = []; // Active bombs
let explosions = []; // Active explosions
let indestructibleWalls = []; // Permanent walls
let destructibleWalls = []; // Destructible walls
let lavaTiles = []; // Lava hazards
let winnerId = null;
let keysPressed = {}; // Track which keys are currently pressed
let directionKeys = []; // Track order of pressed direction keys

// Lobby state
let gamePhase = 'lobby'; // 'lobby' or 'playing' (synced from server)
let gameType = 'bomberman'; // 'bomberman' or 'snake' (synced from server)
let hostId = '';

// Snake state
let snakeFood = [];
const SNAKE_SCL = 20; // Snake tile size
const SNAKE_TICK = 100; // Server update interval for head interpolation
let amSpectator = false;
let roomPollInterval = null;
let lobbyButtonsInitialized = false;

// Variable for player color
let myColor = null;

// Sound effects toggle - load from localStorage or default to true
let isSoundEnabled = localStorage.getItem('bomberman_sound_enabled') !== 'false'; // Sound on by default

// Player name
let playerName = localStorage.getItem('bomberman_player_name') || '';

// Player character sprites
let characterSprites = [];
const characterFiles = [
    'npc_knight_blue.png',
    'npc_knight_yellow.png',
    'npc_knight_green.png',
    'npc_mage.png',
    'npc_sage.png',
    'npc_merchant.png',
    'npc_merchant_2.png',
    'npc_wrestler.png',
    'monster_dark_knight.png',
    'monster_orc_armored.png',
    'monster_skelet.png',
    'monster_zombie_small.png',
    'monster_imp.png',
    'monster_bies.png',
    'monster_rokita.png',
    'monster_demonolog.png',
    'monster_necromancer.png',
    'monster_tentackle.png',
    'monster_elemental_fire_small.png',
    'monster_elemental_air_small.png'
];

// Map player IDs to character indices
let playerCharacterMap = new Map();
let nextCharacterIndex = 0;

// Wall sprites
let boxSprite = null; // Destructible wall
let wallCenterSprite = null; // Indestructible wall
let bombSprite = null; // Bomb
let lavaSprite = null; // Lava tiles

// Floor assets
let floorImages = [];
const floorFiles = [
    'floor_light.png',
    'floor_mud_e.png', 'floor_mud_mid_1.png', 'floor_mud_mid_2.png',
    'floor_mud_n_1.png', 'floor_mud_n_2.png', 'floor_mud_ne.png',
    'floor_mud_nw.png', 'floor_mud_s_1.png', 'floor_mud_s_2.png',
    'floor_mud_se.png', 'floor_mud_sw.png', 'floor_mud_w.png'
];
let floorGrid = [];

const serverMoveInterval = 195; // Matches server's moveInterval (30% slower)

function preload() {
    // Load all character sprites
    for (let i = 0; i < characterFiles.length; i++) {
        characterSprites[i] = loadImage('bomberman-assets/characters/' + characterFiles[i]);
    }

    // Load wall and bomb sprites
    boxSprite = loadImage('bomberman-assets/box.png'); // Destructible walls
    wallCenterSprite = loadImage('bomberman-assets/wall_center.png'); // Indestructible walls
    bombSprite = loadImage('bomberman-assets/weapon_bomb.png');
    lavaSprite = loadImage('bomberman-assets/floor/lava.png');

    // Load floor sprites
    for (let i = 0; i < floorFiles.length; i++) {
        floorImages[i] = loadImage('bomberman-assets/floor/' + floorFiles[i]);
    }
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
        const res = await fetch('/api/rooms');
        const rooms = await res.json();
        renderRoomList(rooms);
    } catch (e) {
        if (listEl) listEl.innerHTML = '<p class="muted">Could not load rooms.</p>';
    }
}

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
        const gameLabel = meta.gameType === 'snake' ? '🐍 Snake' : '💣 Bomberman';
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

            // Sync arrays from schema state
            bombPickups = schemaArrayToPlain(state.bombPickups, ['x', 'y', 'pickupType']);
            powerups = schemaArrayToPlain(state.powerups, ['x', 'y', 'pickupType']);
            bombs = schemaArrayToPlain(state.bombs, ['x', 'y', 'placedTime', 'playerId', 'fuseTime']);
            explosions = schemaArrayToPlain(state.explosions, ['x', 'y', 'createdTime', 'playerId']);
            indestructibleWalls = schemaArrayToPlain(state.indestructibleWalls, ['x', 'y']);
            destructibleWalls = schemaArrayToPlain(state.destructibleWalls, ['x', 'y']);
            lavaTiles = schemaArrayToPlain(state.lavaTiles, ['x', 'y']);
            snakeFood = state.food ? schemaArrayToPlain(state.food, ['x', 'y']) : [];

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

        // Bomberman-specific HUD boxes are hidden while playing snake
        const snakeMode = gameType === 'snake';
        const livesBox = document.getElementById('lives-status');
        if (livesBox) livesBox.style.display = snakeMode ? 'none' : '';
        if (snakeMode) {
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
    if (gameBombermanBtn && gameSnakeBtn) {
        gameBombermanBtn.classList.toggle('active', gameType !== 'snake');
        gameSnakeBtn.classList.toggle('active', gameType === 'snake');
        gameBombermanBtn.disabled = !isHost;
        gameSnakeBtn.disabled = !isHost;
    }

    if (readyBtn) {
        readyBtn.style.display = isHost ? 'none' : 'block';
        const amReady = !!(me && me.ready);
        readyBtn.textContent = amReady ? 'Cancel ready' : "I'm Ready";
        readyBtn.className = amReady ? 'px-btn' : 'px-btn green';
    }
    if (startBtn) {
        startBtn.style.display = isHost ? 'block' : 'none';
        startBtn.disabled = !othersReady;
    }
    if (statusEl) {
        if (isHost) {
            statusEl.textContent = othersReady
                ? (players.size > 1 ? "Everyone's ready. Light the fuse!" : 'You can start solo, or wait for friends.')
                : 'Waiting for everyone to ready up...';
        } else {
            statusEl.textContent = 'Waiting for the host to start...';
        }
    }
}

// Sync snake score/segments onto the local player, with head-position
// interpolation bookkeeping for smooth rendering
function syncSnakeFields(localPlayer, serverPlayer) {
    localPlayer.score = serverPlayer.score || 0;
    localPlayer.segments = serverPlayer.segments
        ? schemaArrayToPlain(serverPlayer.segments, ['x', 'y'])
        : [];

    if (localPlayer.segments.length === 0) return;

    const head = localPlayer.segments[0];
    if (localPlayer.sRenderX === undefined) {
        localPlayer.sRenderX = head.x;
        localPlayer.sRenderY = head.y;
        localPlayer.sStartX = head.x;
        localPlayer.sStartY = head.y;
        localPlayer.sTargetX = head.x;
        localPlayer.sTargetY = head.y;
        localPlayer.sMoveTime = Date.now();
    } else if (localPlayer.sTargetX !== head.x || localPlayer.sTargetY !== head.y) {
        const jump = Math.abs(head.x - localPlayer.sTargetX) + Math.abs(head.y - localPlayer.sTargetY);
        if (jump > SNAKE_SCL * 2) {
            // Respawn or screen wrap: snap instead of sliding across the map
            localPlayer.sRenderX = head.x;
            localPlayer.sRenderY = head.y;
            localPlayer.sStartX = head.x;
            localPlayer.sStartY = head.y;
        } else {
            localPlayer.sStartX = localPlayer.sRenderX;
            localPlayer.sStartY = localPlayer.sRenderY;
        }
        localPlayer.sTargetX = head.x;
        localPlayer.sTargetY = head.y;
        localPlayer.sMoveTime = Date.now();
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

function draw() {
    // Nothing to render while in the lobby (canvas is hidden anyway)
    if (gamePhase !== 'playing') {
        background(26);
        return;
    }

    if (gameType === 'snake') {
        drawSnakeGame();
        return;
    }

    // Draw floor
    drawFloor();

    // Draw walls
    drawWalls();

    // Draw lava tiles
    drawLavaTiles();

    // Draw bomb pickups
    drawBombPickups();

    // Draw powerups
    drawPowerups();

    // Draw explosions (behind players)
    drawExplosions();

    // Draw bombs
    drawBombs();

    // Draw all players
    drawPlayers();

    // Draw UI
    drawUI();

    // Draw winner message if applicable
    if (winnerId) {
        drawWinnerMessage();
    }
}

// ── Snake rendering ─────────────────────────────────────────────────

function drawSnakeGame() {
    background(51);
    const now = Date.now();

    // Draw all snakes with head interpolation
    players.forEach((player, id) => {
        if (!player || !player.color || !player.segments || player.segments.length === 0) return;

        fill(player.color);
        noStroke();

        if (player.sMoveTime !== undefined) {
            const t = Math.min((now - player.sMoveTime) / SNAKE_TICK, 1.0);
            player.sRenderX = lerp(player.sStartX ?? player.sTargetX, player.sTargetX, t);
            player.sRenderY = lerp(player.sStartY ?? player.sTargetY, player.sTargetY, t);
        }

        player.segments.forEach((segment, i) => {
            if (i === 0 && player.sRenderX !== undefined) {
                rect(player.sRenderX, player.sRenderY, SNAKE_SCL, SNAKE_SCL);
            } else {
                rect(segment.x, segment.y, SNAKE_SCL, SNAKE_SCL);
            }
        });
    });

    // Draw food
    fill(255, 0, 100);
    noStroke();
    snakeFood.forEach(f => {
        rect(f.x, f.y, SNAKE_SCL, SNAKE_SCL);
    });

    drawSnakeScores();

    // Players HUD box (reuses the bomberman cache)
    if (!_uiCache.initialized) _initUICache();
    let playing = 0;
    players.forEach(p => { if (!p.isSpectator) playing++; });
    if (_uiCache.playersAliveEl && playing !== _uiCache.lastAlive) {
        _uiCache.lastAlive = playing;
        _uiCache.playersAliveEl.textContent = `${playing} Playing`;
    }

    // Draw winner message if applicable
    if (winnerId) {
        drawWinnerMessage();
    }
}

function drawSnakeScores() {
    textSize(16);
    textAlign(LEFT, BASELINE);
    let y = 20;
    players.forEach((player, id) => {
        if (player.isSpectator) return;
        fill(player.color);
        const name = player.playerName || 'Anonymous';
        text(`${name}${id === playerId ? ' (you)' : ''}: ${player.score || 0}`, 10, y);
        y += 20;
    });

    const me = players.get(playerId);
    if (me && !me.isSpectator) {
        fill(255);
        textSize(20);
        text('Score: ' + (me.score || 0), 10, height - 10);
    }
}

function generateFloorGrid() {
    const cols = ceil(width / scl);
    const rows = ceil(height / scl);
    floorGrid = [];
    for (let x = 0; x < cols; x++) {
        floorGrid[x] = [];
        for (let y = 0; y < rows; y++) {
            // Weighted random: 80% light floor, 20% others
            let r = random(1);
            let index = 0;
            if (r > 0.8) {
                index = floor(random(1, floorImages.length));
            }
            floorGrid[x][y] = index;
        }
    }
}

function drawFloor() {
    if (floorGrid.length === 0 || floorGrid.length !== ceil(width / scl) || (floorGrid[0] && floorGrid[0].length !== ceil(height / scl))) {
        generateFloorGrid();
    }

    for (let x = 0; x < floorGrid.length; x++) {
        for (let y = 0; y < floorGrid[x].length; y++) {
            let imgIndex = floorGrid[x][y];
            if (floorImages[imgIndex]) {
                image(floorImages[imgIndex], x * scl, y * scl, scl, scl);
            }
        }
    }
}

function drawWalls() {
    // Draw indestructible walls
    if (wallCenterSprite) {
        indestructibleWalls.forEach(wall => {
            image(wallCenterSprite, wall.x, wall.y, scl, scl);
        });
    } else {
        // Fallback: Draw as dark gray
        fill(80, 80, 80);
        noStroke();
        indestructibleWalls.forEach(wall => {
            rect(wall.x, wall.y, scl, scl);
        });
    }

    // Draw destructible walls
    if (boxSprite) {
        destructibleWalls.forEach(wall => {
            image(boxSprite, wall.x, wall.y, scl, scl);
        });
    } else {
        // Fallback: Draw as brown
        fill(139, 90, 43);
        noStroke();
        destructibleWalls.forEach(wall => {
            rect(wall.x, wall.y, scl, scl);

            // Add texture lines
            stroke(100, 60, 30);
            strokeWeight(2);
            line(wall.x, wall.y + scl/3, wall.x + scl, wall.y + scl/3);
            line(wall.x, wall.y + 2*scl/3, wall.x + scl, wall.y + 2*scl/3);
        });
    }
}

function drawLavaTiles() {
    lavaTiles.forEach(lava => {
        if (lavaSprite) {
            image(lavaSprite, lava.x, lava.y, scl, scl);
        } else {
            // Fallback: orange-red square
            fill(255, 69, 0);
            noStroke();
            rect(lava.x, lava.y, scl, scl);
        }
    });
}

function drawBombPickups() {
    fill(255, 215, 0); // Gold
    noStroke();

    bombPickups.forEach(pickup => {
        // Draw as a circle in the center of the tile
        ellipse(pickup.x + scl/2, pickup.y + scl/2, scl * 0.6, scl * 0.6);

        // Draw a small "B" for bomb
        fill(0);
        textSize(20);
        textAlign(CENTER, CENTER);
        text("B", pickup.x + scl/2, pickup.y + scl/2);
        fill(255, 215, 0);
    });
}

function drawPowerups() {
    powerups.forEach(powerup => {
        if (powerup.pickupType === 'flame') {
            // Draw flame powerup as a red/orange circle
            fill(255, 69, 0); // Red-orange
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw a flame symbol (F)
            fill(255, 255, 0); // Yellow text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("F", powerup.x + scl/2, powerup.y + scl/2);
        } else if (powerup.pickupType === 'speed') {
            // Draw speed powerup as a cyan circle
            fill(0, 255, 255); // Cyan
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw a speed symbol (S)
            fill(0, 0, 0); // Black text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("S", powerup.x + scl/2, powerup.y + scl/2);
        } else if (powerup.pickupType === 'invisibility') {
            // Draw invisibility powerup as a purple circle with glow
            fill(138, 43, 226); // Purple
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw an invisibility symbol (I)
            fill(255, 255, 255); // White text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("I", powerup.x + scl/2, powerup.y + scl/2);
        } else if (powerup.pickupType === 'life') {
            // Draw life powerup as a pink/red circle (heart color)
            fill(255, 20, 147); // Deep pink
            noStroke();
            ellipse(powerup.x + scl/2, powerup.y + scl/2, scl * 0.6, scl * 0.6);

            // Draw a life symbol (heart/L)
            fill(255, 255, 255); // White text
            textSize(20);
            textAlign(CENTER, CENTER);
            text("♥", powerup.x + scl/2, powerup.y + scl/2);
        }
    });
}

function drawBombs() {
    if (bombSprite) {
        bombs.forEach(bomb => {
            image(bombSprite, bomb.x, bomb.y, scl, scl);
        });
    } else {
        // Fallback: Draw as black circle
        bombs.forEach(bomb => {
            fill(0);
            noStroke();
            ellipse(bomb.x + scl/2, bomb.y + scl/2, scl * 0.7, scl * 0.7);
        });
    }
}

function drawExplosions() {
    fill(255, 100, 0, 180); // Orange with transparency
    noStroke();

    explosions.forEach(explosion => {
        rect(explosion.x, explosion.y, scl, scl);
    });
}

function updateAvatarDisplay() {
    // Update the avatar display canvas with the player's character
    if (!playerId || !playerCharacterMap.has(playerId)) return;

    const characterIndex = playerCharacterMap.get(playerId);
    const sprite = characterSprites[characterIndex];

    if (!sprite) return;

    const avatarCanvas = document.getElementById('avatar-display');
    const yourColorDiv = document.getElementById('your-color');

    if (avatarCanvas && yourColorDiv) {
        const ctx = avatarCanvas.getContext('2d');
        // Clear the canvas
        ctx.clearRect(0, 0, avatarCanvas.width, avatarCanvas.height);
        // Draw the character sprite scaled to 32x32
        ctx.imageSmoothingEnabled = false; // Pixelated rendering
        ctx.drawImage(sprite.canvas, 0, 0, 32, 32);
        // Show the avatar display
        yourColorDiv.style.display = 'block';
    }
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

// Advance a player's render position toward its server position using a
// velocity model: accelerate when a run starts, cruise at the server's move
// speed across intermediate tiles, and brake to a stop only once the server
// reports the player is no longer moving (i.e. on the final tile).
function updateRenderPosition(player, dt) {
    if (player.renderSpeed === undefined) player.renderSpeed = 0;
    if (!player.waypoints) player.waypoints = [];

    // Remaining distance along the tile-by-tile waypoint path (segments are
    // axis-aligned, so Manhattan distance equals the path length)
    let dist = 0;
    let px = player.renderX;
    let py = player.renderY;
    for (const w of player.waypoints) {
        dist += Math.abs(w.x - px) + Math.abs(w.y - py);
        px = w.x;
        py = w.y;
    }

    // Fell too far behind (e.g. tab was inactive): fast-forward to the end
    if (dist > scl * 3) {
        player.waypoints = [];
        player.renderX = player.targetX;
        player.renderY = player.targetY;
        player.renderSpeed = 0;
        return;
    }

    if (dist < 0.01) {
        player.renderX = player.targetX;
        player.renderY = player.targetY;
        player.waypoints = [];
        // Keep momentum between tiles while the run continues so mid-run
        // patch jitter doesn't re-trigger acceleration on every tile
        if (!player.isMoving) player.renderSpeed = 0;
        return;
    }

    // Speed boosts shorten the server's move interval; match it so the
    // renderer keeps pace with boosted players
    const moveInterval = serverMoveInterval * Math.pow(0.9, player.speedBoosts || 0);
    const cruiseSpeed = scl / moveInterval; // px per ms
    const accel = cruiseSpeed / 150; // reach cruise speed in ~150ms
    const brakeDecel = (cruiseSpeed * cruiseSpeed) / scl; // stop over ~half a tile

    let desiredSpeed;
    if (player.isMoving) {
        // Slight overspeed, growing if we fall behind the server, so the
        // render position catches up instead of lagging further
        const catchUp = dist > scl ? 1 + (dist / scl - 1) * 0.5 : 1;
        desiredSpeed = cruiseSpeed * 1.05 * catchUp;
    } else {
        // Run is over: follow a braking curve that comes to rest exactly
        // at the final tile
        desiredSpeed = Math.min(cruiseSpeed * 1.05, Math.sqrt(2 * brakeDecel * dist));
    }

    if (player.renderSpeed < desiredSpeed) {
        player.renderSpeed = Math.min(desiredSpeed, player.renderSpeed + accel * dt);
    } else {
        player.renderSpeed = desiredSpeed;
    }

    // Advance along the waypoint path, turning at tile corners instead of
    // cutting diagonally toward the newest position
    let step = Math.min(dist, player.renderSpeed * dt);
    while (step > 0.0001 && player.waypoints.length > 0) {
        const w = player.waypoints[0];
        const dx = w.x - player.renderX;
        const dy = w.y - player.renderY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= step) {
            player.renderX = w.x;
            player.renderY = w.y;
            step -= d;
            player.waypoints.shift();
        } else {
            player.renderX += (dx / d) * step;
            player.renderY += (dy / d) * step;
            step = 0;
        }
    }
}

let _lastPlayersDrawTime = 0;

function drawPlayers() {
    const now = Date.now();
    // Frame delta in ms, capped so tab-switch stalls don't cause jumps
    const dt = _lastPlayersDrawTime ? Math.min(now - _lastPlayersDrawTime, 50) : 16;
    _lastPlayersDrawTime = now;

    players.forEach((player, id) => {
        if (!player || !player.alive || !player.color) return;

        // Skip invisible players (unless it's the local player)
        if (player.invisible && id !== playerId) return;

        // Assign character sprite to new players
        if (!playerCharacterMap.has(id)) {
            playerCharacterMap.set(id, nextCharacterIndex % characterSprites.length);
            nextCharacterIndex++;

            // Update avatar display if this is the local player
            if (id === playerId) {
                updateAvatarDisplay();
            }
        }

        updateRenderPosition(player, dt);

        // Get the character sprite for this player
        const characterIndex = playerCharacterMap.get(id);
        const sprite = characterSprites[characterIndex];

        // Check for spawn protection
        const isProtected = player.protectedUntil && player.protectedUntil > now;
        const shouldBlink = isProtected && Math.floor(now / 200) % 2 === 0;

        if (sprite) {
            // Draw character sprite (16x16 scaled to 32x32)
            if (shouldBlink) {
                tint(255, 255, 255, 128); // 50% transparency for blink
            }
            image(sprite, player.renderX, player.renderY, scl, scl);
            noTint();
        } else {
            // Fallback: Draw player as a colored square
            if (shouldBlink) {
                // Extract RGB and add alpha for blinking
                const r = red(player.color);
                const g = green(player.color);
                const b = blue(player.color);
                fill(r, g, b, 128);
            } else {
                fill(player.color);
            }
            noStroke();
            rect(player.renderX, player.renderY, scl, scl);

            // Draw a face or indicator
            fill(255);
            ellipse(player.renderX + scl * 0.35, player.renderY + scl * 0.35, scl * 0.15, scl * 0.15);
            ellipse(player.renderX + scl * 0.65, player.renderY + scl * 0.35, scl * 0.15, scl * 0.15);
        }

        // Draw shield indicator for protected players
        if (isProtected) {
            noFill();
            stroke(100, 200, 255, 180);
            strokeWeight(2);
            ellipse(player.renderX + scl/2, player.renderY + scl/2, scl * 1.2, scl * 1.2);
            noStroke();
        }
    });
}

// Cached DOM elements and values for drawUI (avoid querying DOM every frame)
let _uiCache = {
    playersAliveEl: null,
    invisibilityEl: null,
    livesCountEl: null,
    lastAlive: -1,
    lastInvisible: null,
    lastLives: -1,
    initialized: false
};

function _initUICache() {
    _uiCache.playersAliveEl = document.getElementById('players-alive');
    _uiCache.invisibilityEl = document.getElementById('invisibility-status');
    _uiCache.livesCountEl = document.getElementById('lives-count');
    _uiCache.initialized = true;
}

function drawUI() {
    if (!_uiCache.initialized) _initUICache();

    // Update players alive (only when changed)
    const alivePlayers = Array.from(players.values()).filter(p => p.alive).length;
    if (_uiCache.playersAliveEl && alivePlayers !== _uiCache.lastAlive) {
        _uiCache.lastAlive = alivePlayers;
        _uiCache.playersAliveEl.textContent = `${alivePlayers} Alive`;
    }

    // Update invisibility status (only when changed)
    if (_uiCache.invisibilityEl && players.has(playerId)) {
        const myPlayer = players.get(playerId);
        const now = Date.now();
        const isInvisible = !!(myPlayer.invisibleUntil && myPlayer.invisibleUntil > now);
        if (isInvisible !== _uiCache.lastInvisible) {
            _uiCache.lastInvisible = isInvisible;
            _uiCache.invisibilityEl.style.display = isInvisible ? 'block' : 'none';
        }
    }

    // Update lives (only when changed)
    if (_uiCache.livesCountEl && players.has(playerId)) {
        const lives = players.get(playerId).lives || 0;
        if (lives !== _uiCache.lastLives) {
            _uiCache.lastLives = lives;
            _uiCache.livesCountEl.textContent = lives;
        }
    }

    // Update active bombs display (only when player is dead)
    updateActiveBombsDisplay();
}

function updateActiveBombsDisplay() {
    const activeBombsDisplay = document.getElementById('active-bombs-display');
    const activeBombsList = document.getElementById('active-bombs-list');

    if (!activeBombsDisplay || !activeBombsList || !players.has(playerId)) {
        return;
    }

    const myPlayer = players.get(playerId);

    // Only show when player is dead
    if (!myPlayer || myPlayer.alive) {
        activeBombsDisplay.style.display = 'none';
        return;
    }

    // Show the display
    activeBombsDisplay.style.display = 'block';

    // Build the death message
    let html = '';

    // Show who killed you (always show something to debug)
    if (myPlayer.killedBy === 'self') {
        html += `<div style="background-color: #550000; padding: 8px 12px; border-radius: 5px; margin-bottom: 10px; border: 2px solid #AA0000; text-align: center;">`;
        html += `<span style="color: #FF6666; font-weight: bold; font-size: 14px;">💥 You killed yourself!</span>`;
        html += `</div>`;
    } else if (myPlayer.killedBy === 'lava') {
        html += `<div style="background-color: #552200; padding: 8px 12px; border-radius: 5px; margin-bottom: 10px; border: 2px solid #FF6600; text-align: center;">`;
        html += `<span style="color: #FF9933; font-weight: bold; font-size: 14px;">🌋 Killed by lava!</span>`;
        html += `</div>`;
    } else if (myPlayer.killedBy) {
        const killer = players.get(myPlayer.killedBy);
        if (killer) {
            const killerName = killer.playerName || `Player ${myPlayer.killedBy.substring(0, 6)}...`;
            const characterIndex = playerCharacterMap.get(myPlayer.killedBy);
            const sprite = characterSprites[characterIndex];

            html += `<div style="background-color: #330033; padding: 8px 12px; border-radius: 5px; margin-bottom: 10px; border: 2px solid #AA00AA; display: flex; align-items: center; gap: 8px; justify-content: center;">`;

            // Add killer's character sprite
            if (sprite) {
                html += `<canvas id="killer-avatar" width="24" height="24" style="image-rendering: pixelated;"></canvas>`;
            }

            html += `<span style="color: #FF66FF; font-weight: bold; font-size: 14px;">💀 Killed by ${killerName}</span>`;
            html += `</div>`;

            // Draw killer sprite after HTML is inserted
            setTimeout(() => {
                const canvas = document.getElementById('killer-avatar');
                if (sprite && canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, 24, 24);
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(sprite.canvas, 0, 0, 24, 24);
                }
            }, 0);
        }
    } else {
        // Fallback message if killedBy is not set
        html += `<div style="background-color: #333333; padding: 8px 12px; border-radius: 5px; margin-bottom: 10px; border: 2px solid #666666; text-align: center;">`;
        html += `<span style="color: #FFFFFF; font-weight: bold; font-size: 14px;">☠️ You died!</span>`;
        html += `</div>`;
    }

    // Count active bombs per player
    const bombCounts = new Map();
    bombs.forEach(bomb => {
        const count = bombCounts.get(bomb.playerId) || 0;
        bombCounts.set(bomb.playerId, count + 1);
    });

    // Show active bombs if any
    if (bombCounts.size > 0) {
        html += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #444;">`;
        html += `<div style="color: #999; font-size: 11px; margin-bottom: 5px;">Active Bombs:</div>`;
        html += `<div style="display: flex; flex-wrap: wrap; gap: 8px;">`;

        bombCounts.forEach((count, playerIdKey) => {
            const player = players.get(playerIdKey);
            if (player) {
                const displayName = player.playerName || `Player ${playerIdKey.substring(0, 6)}...`;
                const characterIndex = playerCharacterMap.get(playerIdKey);
                const sprite = characterSprites[characterIndex];

                html += `<div style="background-color: #333; padding: 5px 8px; border-radius: 3px; display: flex; align-items: center; gap: 6px;">`;

                // Add character sprite if available
                if (sprite) {
                    html += `<canvas id="bomb-avatar-${playerIdKey}" width="16" height="16" style="image-rendering: pixelated;"></canvas>`;
                }

                html += `<span style="color: #fff;">${displayName}:</span>`;
                html += `<span style="color: #FFD700; font-weight: bold;">${count} 💣</span>`;
                html += `</div>`;
            }
        });

        html += `</div></div>`;
    }

    activeBombsList.innerHTML = html;

    // Draw character sprites onto the canvases
    bombCounts.forEach((count, playerIdKey) => {
        const characterIndex = playerCharacterMap.get(playerIdKey);
        const sprite = characterSprites[characterIndex];
        const canvas = document.getElementById(`bomb-avatar-${playerIdKey}`);

        if (sprite && canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 16, 16);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(sprite.canvas, 0, 0, 16, 16);
        }
    });
}

function drawWinnerMessage() {
    const winner = players.get(winnerId);
    const winnerName = winnerId === playerId
        ? "You"
        : (winner && winner.playerName ? winner.playerName : `Player ${winnerId.substring(0, 6)}...`);
    const message = winner ? `${winnerName} wins!` : "Game Over!";

    fill(0, 0, 0, 150);
    rect(0, height / 2 - 50, width, 100);

    fill(255);
    textSize(32);
    textAlign(CENTER, CENTER);
    text(message, width / 2, height / 2 - 10);

    textSize(16);
    text("Returning to the lobby...", width / 2, height / 2 + 30);
}

function keyPressed() {
    // Don't handle game controls if welcome modal is visible or if typing in input
    const welcomeModal = document.getElementById('welcome-modal');
    if (welcomeModal && welcomeModal.style.display !== 'none') {
        return true; // Allow normal keyboard input in modal
    }
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        return true; // Allow typing in input fields
    }

    // Prevent default for arrow keys and WASD to disable scrolling
    // Using keyCodes for WASD: W=87, A=65, S=83, D=68 (physical position, ignores layout)
    if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, 32, 87, 65, 83, 68].includes(keyCode)) {
        event.preventDefault();
    }

    // Game controls only apply during an active game
    if (!room || gamePhase !== 'playing' || winnerId) return false;

    if (!players.has(playerId)) return false;

    // Snake: single keypress steers, no key-hold tracking
    if (gameType === 'snake') {
        let direction = null;
        if (keyCode === UP_ARROW || keyCode === 87) {
            direction = { x: 0, y: -1 };
        } else if (keyCode === DOWN_ARROW || keyCode === 83) {
            direction = { x: 0, y: 1 };
        } else if (keyCode === LEFT_ARROW || keyCode === 65) {
            direction = { x: -1, y: 0 };
        } else if (keyCode === RIGHT_ARROW || keyCode === 68) {
            direction = { x: 1, y: 0 };
        }
        if (direction) room.send('direction', direction);
        return false;
    }

    const localPlayer = players.get(playerId);
    if (!localPlayer.alive) return false;

    // Track key press
    keysPressed[keyCode] = true;

    // Handle space bar for bombs (separate from directional keys)
    if (key === ' ' || keyCode === 32) {
        room.send('placeBomb');
        return false;
    }

    // Movement with arrow keys and WASD (using keyCodes for layout independence)
    let direction = null;
    if (keyCode === UP_ARROW || keyCode === 87) { // UP or W
        direction = { x: 0, y: -1 };
    } else if (keyCode === DOWN_ARROW || keyCode === 83) { // DOWN or S
        direction = { x: 0, y: 1 };
    } else if (keyCode === LEFT_ARROW || keyCode === 65) { // LEFT or A
        direction = { x: -1, y: 0 };
    } else if (keyCode === RIGHT_ARROW || keyCode === 68) { // RIGHT or D
        direction = { x: 1, y: 0 };
    }

    // If a direction key was pressed, add it to the array if not already there
    if (direction) {
        // Remove this key if it's already in the array (to update its position)
        directionKeys = directionKeys.filter(k => k.keyCode !== keyCode);
        // Add to the end (most recent)
        directionKeys.push({ keyCode, direction });
        // Send all held directions so the server can combine them
        // (e.g. holding up + right moves up and right around obstacles)
        room.send('setDirections', directionKeys.map(k => k.direction));
    }

    return false; // Prevent default behavior
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

    // Prevent default for arrow keys and WASD
    if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, 32, 87, 65, 83, 68].includes(keyCode)) {
        event.preventDefault();
    }

    if (!room || gamePhase !== 'playing') return false;
    if (gameType === 'snake') return false; // Snake has no key-release handling
    if (!players.has(playerId)) return false;

    const localPlayer = players.get(playerId);
    if (!localPlayer || !localPlayer.alive) return false;

    // Remove key from tracking
    keysPressed[keyCode] = false;

    // Remove this key from directionKeys array
    directionKeys = directionKeys.filter(k => k.keyCode !== keyCode);

    // Send the remaining held directions (empty list stops movement)
    room.send('setDirections', directionKeys.map(k => k.direction));

    return false; // Prevent default behavior
}
