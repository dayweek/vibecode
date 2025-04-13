let scl = 20;
let socket;
let playerId;
let players = new Map(); // Map of playerId -> player data
let food = [];
let score = 0;
let winnerId = null; // Track the winner locally
let baseSpeed = 10;
let speedIncrement = 0.5;
let lastUpdate = 0;
const UPDATE_INTERVAL = 50; // Update every 50ms
let lastFrameTime = 0;
const FRAME_INTERVAL = 1000 / baseSpeed; // Target frame interval in milliseconds

function setup() {
    const canvas = createCanvas(800, 800);
    // Parent the canvas to the game-container div
    canvas.parent('game-container'); 
    frameRate(baseSpeed);
    
    // Connect to Socket.io server
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('init', (data) => {
        playerId = data.playerId;
        // Initialize all players
        data.gameState.players.forEach(player => {
            players.set(player.id, player);
        });
        food = data.gameState.food;
    });
    
    socket.on('gameState', (state) => {
        // Update all players
        state.players.forEach(player => {
            players.set(player.id, player);
        });
        food = state.food;
        winnerId = state.winnerId; // Update local winnerId from state
    });
    
    socket.on('playerLeft', (id) => {
        players.delete(id);
    });

    // Add new player when notified by server
    socket.on('playerJoined', (data) => {
        if (data.playerId !== playerId) { // Don't re-add self if already initialized
            players.set(data.playerId, data.playerData);
        }
    });

    // Listen for sound effect events
    socket.on('playEatSound', () => {
        if (eatSound) {
            eatSound.currentTime = 0; // Rewind to start
            eatSound.play().catch(e => console.error("Error playing eat sound:", e));
        }
    });

    socket.on('playDieSound', () => {
        if (dieSound) {
            dieSound.currentTime = 0; // Rewind to start
            dieSound.play().catch(e => console.error("Error playing die sound:", e));
        }
    });

    socket.on('playNewSound', () => {
        if (newSound) {
            newSound.currentTime = 0; // Rewind to start
            newSound.play().catch(e => console.error("Error playing new sound:", e));
        }
    });

    socket.on('playWinSound', () => {
        if (winSound) {
            winSound.currentTime = 0; // Rewind to start
            winSound.play().catch(e => console.error("Error playing win sound:", e));
        }
    });

    // Reset button listener
    const resetButton = document.getElementById('resetButton');
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            if (socket && playerId) {
                console.log('Sending reset request...');
                socket.emit('resetGame');
            }
        });
    } else {
        console.error("Reset button not found!");
    }

    // Music toggle listener
    const toggleMusicButton = document.getElementById('toggleMusicButton');
    const backgroundMusic = document.getElementById('backgroundMusic');
    const eatSound = document.getElementById('eatSound');
    const dieSound = document.getElementById('dieSound');
    const newSound = document.getElementById('newSound');
    const winSound = document.getElementById('winSound');

    if (toggleMusicButton && backgroundMusic) {
        let isMusicPlaying = true; // Start assuming music is playing (or will play soon)
        
        // Attempt to play music immediately
        backgroundMusic.play().catch(error => {
            console.error("Initial music play failed (browser might require user interaction first):", error);
            // If play failed initially, update state and button text
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

function draw() {
    const currentTime = millis();
    const deltaTime = currentTime - lastFrameTime;
    
    if (deltaTime >= FRAME_INTERVAL) {
        lastFrameTime = currentTime;
        
        background(51);
        
        // Draw all players
        players.forEach((player, id) => {
            // Add checks to ensure player and segments exist before drawing
            if (player && player.segments && Array.isArray(player.segments) && player.color) {
                fill(player.color);
                player.segments.forEach(segment => {
                    if (segment && typeof segment.x === 'number' && typeof segment.y === 'number') {
                        rect(segment.x, segment.y, scl, scl);
                    }
                });

                // Draw score for the local player
                if (id === playerId) {
                    score = player.score;
                    fill(255);
                    textSize(20);
                    textAlign(LEFT);
                    text("Score: " + score, 10, height - 10);
                }
            } else {
                 console.warn(`Attempted to draw invalid player data for ID: ${id}`);
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
    }
    
    // Request next frame
    requestAnimationFrame(draw);
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
    const winnerName = winnerId === playerId ? "You" : `Player ${winnerId.substring(0, 6)}...`; // Shorten ID for display
    const message = winner ? `${winnerName} wins with ${winner.score} points!` : "Game Over!";
    
    fill(0, 0, 0, 150); // Semi-transparent background
    rect(0, height / 2 - 50, width, 100);
    
    fill(255);
    textSize(32);
    textAlign(CENTER, CENTER);
    text(message, width / 2, height / 2 - 10);
    textSize(16);
    text("Press any key to restart", width / 2, height / 2 + 30);
}

function keyPressed() {
    // If there is a winner, any key press requests a restart
    if (winnerId) {
        socket.emit('requestRestart');
        return; // Don't process regular direction input
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
        socket.emit('direction', direction);
    }
} 