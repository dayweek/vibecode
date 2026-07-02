let scl = 20;
let room; // Colyseus room instance
let playerId;
let players = new Map(); // Map of playerId -> player data
let food = [];
let score = 0;
let winnerId = null; // Track the winner locally
let winnerDetectedTime = null; // Track when winner was first detected
let winDelaySeconds = 3; // Delay in seconds before allowing restart
const UPDATE_INTERVAL = 50; // Server update interval in ms
let isDisconnected = false;

function setup() {
    const canvas = createCanvas(800, 800);
    // Parent the canvas to the game-container div
    canvas.parent('game-container');
    frameRate(30); // Smooth rendering for interpolation

    // Connect to Colyseus server
    connectToServer();

    // Reset button listener
    const resetButton = document.getElementById('resetButton');
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            if (room && playerId) {
                console.log('Sending reset request...');
                room.send('resetGame');
            }
        });
    } else {
        console.error("Reset button not found!");
    }

    // Music toggle listener
    const toggleMusicButton = document.getElementById('toggleMusicButton');
    const backgroundMusic = document.getElementById('backgroundMusic');

    if (toggleMusicButton && backgroundMusic) {
        let isMusicPlaying = true;

        backgroundMusic.play().catch(error => {
            console.error("Initial music play failed (browser might require user interaction first):", error);
            isMusicPlaying = false;
            toggleMusicButton.textContent = 'Play Music';
        });

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
    } else {
        console.error("Music elements not found!");
    }
}

async function connectToServer() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const client = new Colyseus.Client(`${wsProtocol}://${window.location.host}`);

    try {
        room = await client.joinOrCreate('snake');
        playerId = room.sessionId;
        isDisconnected = false;
        console.log('Connected to Snake room:', playerId);

        // Sync state on every patch
        room.onStateChange((state) => {
            // Sync players
            const currentIds = new Set();
            state.players.forEach((serverPlayer, id) => {
                currentIds.add(id);

                // Extract segments as plain array
                const segments = [];
                for (let i = 0; i < serverPlayer.segments.length; i++) {
                    segments.push({ x: serverPlayer.segments[i].x, y: serverPlayer.segments[i].y });
                }

                if (players.has(id)) {
                    const local = players.get(id);
                    const head = segments[0];

                    if (local._renderX === undefined) {
                        local._renderX = head.x;
                        local._renderY = head.y;
                    }
                    if (local._targetX !== head.x || local._targetY !== head.y) {
                        local._startX = local._renderX;
                        local._startY = local._renderY;
                        local._targetX = head.x;
                        local._targetY = head.y;
                        local._moveTime = Date.now();
                    }
                    local.segments = segments;
                    local.score = serverPlayer.score;
                    local.color = serverPlayer.color;
                } else {
                    const head = segments[0];
                    players.set(id, {
                        id: id,
                        segments: segments,
                        score: serverPlayer.score,
                        color: serverPlayer.color,
                        _renderX: head.x,
                        _renderY: head.y,
                        _targetX: head.x,
                        _targetY: head.y,
                        _startX: head.x,
                        _startY: head.y,
                        _moveTime: Date.now(),
                    });
                }
            });

            // Remove disconnected players
            for (const [id] of players) {
                if (!currentIds.has(id)) {
                    players.delete(id);
                }
            }

            // Sync food
            food = [];
            for (let i = 0; i < state.food.length; i++) {
                food.push({ x: state.food[i].x, y: state.food[i].y });
            }

            // Winner detection
            const newWinnerId = state.winnerId || null;
            if (newWinnerId && !winnerId) {
                winnerDetectedTime = Date.now();
            }
            if (!newWinnerId && winnerId) {
                winnerDetectedTime = null;
            }
            winnerId = newWinnerId;
        });

        // Sound message listeners
        const eatSound = document.getElementById('eatSound');
        const dieSound = document.getElementById('dieSound');
        const newSound = document.getElementById('newSound');
        const winSound = document.getElementById('winSound');

        room.onMessage('playEatSound', () => {
            if (eatSound) { eatSound.currentTime = 0; eatSound.play().catch(() => {}); }
        });

        room.onMessage('playDieSound', () => {
            if (dieSound) { dieSound.currentTime = 0; dieSound.play().catch(() => {}); }
        });

        room.onMessage('playNewSound', () => {
            if (newSound) { newSound.currentTime = 0; newSound.play().catch(() => {}); }
        });

        room.onMessage('playWinSound', () => {
            if (winSound) { winSound.currentTime = 0; winSound.play().catch(() => {}); }
        });

        room.onError((code, message) => {
            console.error('Room error:', code, message);
        });

        room.onLeave((code) => {
            console.log('Left room:', code);
            isDisconnected = true;
        });

    } catch (e) {
        console.error('Failed to join Snake room:', e);
        isDisconnected = true;
    }
}

function draw() {
    background(51);

    const now = Date.now();

    // Draw all players with head interpolation
    players.forEach((player, id) => {
        if (player && player.segments && Array.isArray(player.segments) && player.color) {
            fill(player.color);

            // Interpolate head position for smooth movement
            if (player._moveTime !== undefined) {
                const t = Math.min((now - player._moveTime) / UPDATE_INTERVAL, 1.0);
                player._renderX = lerp(player._startX ?? player._targetX, player._targetX, t);
                player._renderY = lerp(player._startY ?? player._targetY, player._targetY, t);
            }

            player.segments.forEach((segment, i) => {
                if (segment && typeof segment.x === 'number' && typeof segment.y === 'number') {
                    if (i === 0 && player._renderX !== undefined) {
                        // Draw head at interpolated position
                        rect(player._renderX, player._renderY, scl, scl);
                    } else {
                        rect(segment.x, segment.y, scl, scl);
                    }
                }
            });

            if (id === playerId) {
                score = player.score;
                fill(255);
                textSize(20);
                textAlign(LEFT);
                text("Score: " + score, 10, height - 10);
            }
        }
    });

    // Draw food
    fill(255, 0, 100);
    food.forEach(f => {
        rect(f.x, f.y, scl, scl);
    });

    // Draw player list
    drawPlayerList();

    // Draw winner message if applicable
    if (winnerId) {
        drawWinnerMessage();
    }

    // Draw disconnect overlay
    if (isDisconnected) {
        fill(0, 0, 0, 150);
        rect(0, height / 2 - 30, width, 60);
        fill(255);
        textSize(24);
        textAlign(CENTER, CENTER);
        text("Disconnected — reconnecting...", width / 2, height / 2);
    }
}

function drawPlayerList() {
    fill(255);
    textSize(16);
    textAlign(LEFT);
    let y = 20;
    players.forEach((player, id) => {
        fill(player.color);
        text(`Player ${id === playerId ? '(You)' : ''}: ${player.score}`, 10, y);
        y += 20;
    });
}

function drawWinnerMessage() {
    const winner = players.get(winnerId);
    const winnerName = winnerId === playerId ? "You" : `Player ${winnerId.substring(0, 6)}...`;
    const message = winner ? `${winnerName} wins with ${winner.score} points!` : "Game Over!";

    fill(0, 0, 0, 150);
    rect(0, height / 2 - 50, width, 100);

    fill(255);
    textSize(32);
    textAlign(CENTER, CENTER);
    text(message, width / 2, height / 2 - 10);

    textSize(16);
    if (winnerDetectedTime) {
        const elapsedTime = (Date.now() - winnerDetectedTime) / 1000;
        const remainingTime = Math.max(0, winDelaySeconds - elapsedTime);

        if (remainingTime > 0) {
            text(`Next game starts in ${Math.ceil(remainingTime)} seconds...`, width / 2, height / 2 + 30);
        } else {
            text("Press any key to restart", width / 2, height / 2 + 30);
        }
    } else {
        text("Press any key to restart", width / 2, height / 2 + 30);
    }
}

function keyPressed() {
    // If there is a winner, check if enough time has passed before allowing restart
    if (winnerId) {
        if (winnerDetectedTime) {
            const elapsedTime = (Date.now() - winnerDetectedTime) / 1000;
            if (elapsedTime >= winDelaySeconds) {
                room.send('requestRestart');
                winnerDetectedTime = null;
            }
        } else {
            room.send('requestRestart');
        }
        return;
    }

    // Otherwise, handle direction changes
    if (!players.has(playerId)) return;

    let direction = { x: 0, y: 0 };

    if (keyCode === UP_ARROW) {
        direction = { x: 0, y: -1 };
    } else if (keyCode === DOWN_ARROW) {
        direction = { x: 0, y: 1 };
    } else if (keyCode === RIGHT_ARROW) {
        direction = { x: 1, y: 0 };
    } else if (keyCode === LEFT_ARROW) {
        direction = { x: -1, y: 0 };
    }

    if (direction.x !== 0 || direction.y !== 0) {
        room.send('direction', direction);
    }
}
