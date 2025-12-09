let scl = 30; // Tile size (reduced for 50% more density)
let socket;
let playerId;
let players = new Map(); // Map of playerId -> player data
let bombPickups = []; // Bomb pickups on the map
let bombs = []; // Active bombs
let explosions = []; // Active explosions
let indestructibleWalls = []; // Permanent walls
let destructibleWalls = []; // Destructible walls
let winnerId = null;
let winnerDetectedTime = null;
let winDelaySeconds = 3;
let keysPressed = {}; // Track which keys are currently pressed

function setup() {
    const canvas = createCanvas(960, 800); // 20% wider
    canvas.parent('game-container');
    frameRate(30);

    // Connect to Socket.io server
    socket = io('/bomberman');

    socket.on('connect', () => {
        console.log('Connected to Bomberman server');
    });

    socket.on('init', (data) => {
        playerId = data.playerId;
        // Initialize all players
        data.gameState.players.forEach(player => {
            players.set(player.id, player);
        });
        bombPickups = data.gameState.bombPickups || [];
        bombs = data.gameState.bombs || [];
        explosions = data.gameState.explosions || [];
        indestructibleWalls = data.gameState.indestructibleWalls || [];
        destructibleWalls = data.gameState.destructibleWalls || [];

        // Set canvas size from server
        if (data.gameState.width && data.gameState.height) {
            if (width !== data.gameState.width || height !== data.gameState.height) {
                resizeCanvas(data.gameState.width, data.gameState.height);
            }
        }
    });

    socket.on('gameState', (state) => {
        // Update all players
        players.clear();
        state.players.forEach(player => {
            players.set(player.id, player);
        });
        bombPickups = state.bombPickups || [];
        bombs = state.bombs || [];
        explosions = state.explosions || [];
        indestructibleWalls = state.indestructibleWalls || [];
        destructibleWalls = state.destructibleWalls || [];

        // Update canvas size if grid dimensions changed
        if (state.width && state.height) {
            if (width !== state.width || height !== state.height) {
                resizeCanvas(state.width, state.height);
            }
        }

        // Check if this is the first time we're detecting a winner
        if (state.winnerId && !winnerId) {
            winnerDetectedTime = Date.now();
        }

        // Reset winner tracking when game restarts
        if (!state.winnerId && winnerId) {
            winnerDetectedTime = null;
        }

        winnerId = state.winnerId;
    });

    socket.on('playerLeft', (id) => {
        players.delete(id);
    });

    socket.on('playerJoined', (data) => {
        if (data.playerId !== playerId) {
            players.set(data.playerId, data.playerData);
        }
    });

    // Sound effect listeners
    socket.on('playEatSound', () => {
        const eatSound = document.getElementById('eatSound');
        if (eatSound) {
            eatSound.currentTime = 0;
            eatSound.play().catch(e => console.error("Error playing eat sound:", e));
        }
    });

    socket.on('playDieSound', () => {
        const dieSound = document.getElementById('dieSound');
        if (dieSound) {
            dieSound.currentTime = 0;
            dieSound.play().catch(e => console.error("Error playing die sound:", e));
        }
    });

    socket.on('playNewSound', () => {
        const newSound = document.getElementById('newSound');
        if (newSound) {
            newSound.currentTime = 0;
            newSound.play().catch(e => console.error("Error playing new sound:", e));
        }
    });

    socket.on('playWinSound', () => {
        const winSound = document.getElementById('winSound');
        if (winSound) {
            winSound.currentTime = 0;
            winSound.play().catch(e => console.error("Error playing win sound:", e));
        }
    });

    // Reset button listener
    const resetButton = document.getElementById('resetButton');
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            if (socket && playerId) {
                socket.emit('resetGame');
            }
        });
    }

    // Music toggle listener
    const toggleMusicButton = document.getElementById('toggleMusicButton');
    const backgroundMusic = document.getElementById('backgroundMusic');

    if (toggleMusicButton && backgroundMusic) {
        let isMusicPlaying = true;

        backgroundMusic.play().catch(error => {
            console.error("Initial music play failed:", error);
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
    }
}

function draw() {
    background(34, 139, 34); // Green background

    // Draw grid
    drawGrid();

    // Draw walls
    drawWalls();

    // Draw bomb pickups
    drawBombPickups();

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

function drawGrid() {
    stroke(50, 150, 50);
    strokeWeight(1);

    // Vertical lines
    for (let x = 0; x <= width; x += scl) {
        line(x, 0, x, height);
    }

    // Horizontal lines
    for (let y = 0; y <= height; y += scl) {
        line(0, y, width, y);
    }
}

function drawWalls() {
    // Draw indestructible walls (dark gray)
    fill(80, 80, 80);
    noStroke();
    indestructibleWalls.forEach(wall => {
        rect(wall.x, wall.y, scl, scl);
    });

    // Draw destructible walls (brown)
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

function drawBombs() {
    bombs.forEach(bomb => {
        // Draw bomb as black circle
        fill(0);
        noStroke();
        ellipse(bomb.x + scl/2, bomb.y + scl/2, scl * 0.7, scl * 0.7);
    });
}

function drawExplosions() {
    fill(255, 100, 0, 180); // Orange with transparency
    noStroke();

    explosions.forEach(explosion => {
        rect(explosion.x, explosion.y, scl, scl);
    });
}

function drawPlayers() {
    players.forEach((player, id) => {
        if (player && player.x !== undefined && player.y !== undefined && player.color && player.alive) {
            // Draw player as a colored square
            fill(player.color);
            noStroke();
            rect(player.x, player.y, scl, scl);

            // Draw a face or indicator
            fill(255);
            ellipse(player.x + scl * 0.35, player.y + scl * 0.35, scl * 0.15, scl * 0.15);
            ellipse(player.x + scl * 0.65, player.y + scl * 0.35, scl * 0.15, scl * 0.15);
        }
    });
}

function drawUI() {
    const localPlayer = players.get(playerId);

    if (localPlayer) {
        // Draw bomb count
        fill(0, 0, 0, 150);
        noStroke();
        rect(10, 10, 200, 40);

        fill(255);
        textSize(20);
        textAlign(LEFT, TOP);
        const availableBombs = localPlayer.maxBombs - localPlayer.activeBombs;
        text(`Bombs: ${availableBombs}/${localPlayer.maxBombs}`, 20, 20);
    }

    // Draw player count
    fill(0, 0, 0, 150);
    noStroke();
    rect(10, 60, 200, 40);

    fill(255);
    textSize(20);
    textAlign(LEFT, TOP);
    const alivePlayers = Array.from(players.values()).filter(p => p.alive).length;
    text(`Players Alive: ${alivePlayers}`, 20, 70);
}

function drawWinnerMessage() {
    const winner = players.get(winnerId);
    const winnerName = winnerId === playerId ? "You" : `Player ${winnerId.substring(0, 6)}...`;
    const message = winner ? `${winnerName} wins!` : "Game Over!";

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
    // Prevent default for arrow keys to disable scrolling
    if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, 32].includes(keyCode)) {
        event.preventDefault();
    }

    // Handle restart if there's a winner
    if (winnerId) {
        if (winnerDetectedTime) {
            const elapsedTime = (Date.now() - winnerDetectedTime) / 1000;
            if (elapsedTime >= winDelaySeconds) {
                socket.emit('requestRestart');
                winnerDetectedTime = null;
            }
        } else {
            socket.emit('requestRestart');
        }
        return false;
    }

    if (!players.has(playerId)) return false;

    const localPlayer = players.get(playerId);
    if (!localPlayer.alive) return false;

    // Track key press
    keysPressed[keyCode] = true;

    // Movement with arrow keys
    if (keyCode === UP_ARROW && !keysPressed.lastDirection) {
        socket.emit('moveStart', { x: 0, y: -1 });
        keysPressed.lastDirection = UP_ARROW;
    } else if (keyCode === DOWN_ARROW && !keysPressed.lastDirection) {
        socket.emit('moveStart', { x: 0, y: 1 });
        keysPressed.lastDirection = DOWN_ARROW;
    } else if (keyCode === LEFT_ARROW && !keysPressed.lastDirection) {
        socket.emit('moveStart', { x: -1, y: 0 });
        keysPressed.lastDirection = LEFT_ARROW;
    } else if (keyCode === RIGHT_ARROW && !keysPressed.lastDirection) {
        socket.emit('moveStart', { x: 1, y: 0 });
        keysPressed.lastDirection = RIGHT_ARROW;
    } else if (key === ' ' || keyCode === 32) {
        // Space bar to place bomb
        socket.emit('placeBomb');
    }

    return false; // Prevent default behavior
}

function keyReleased() {
    // Prevent default for arrow keys
    if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, 32].includes(keyCode)) {
        event.preventDefault();
    }

    if (!players.has(playerId)) return false;

    const localPlayer = players.get(playerId);
    if (!localPlayer || !localPlayer.alive) return false;

    // Remove key from tracking
    keysPressed[keyCode] = false;

    // Stop movement when the current direction key is released
    if (keyCode === keysPressed.lastDirection) {
        socket.emit('moveStop');
        keysPressed.lastDirection = null;
    }

    return false; // Prevent default behavior
}
