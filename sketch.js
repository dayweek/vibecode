let scl = 20;
let socket;
let playerId;
let players = new Map(); // Map of playerId -> player data
let food = [];
let score = 0;
let baseSpeed = 10;
let speedIncrement = 0.5;
let lastUpdate = 0;
const UPDATE_INTERVAL = 50; // Update every 50ms
let lastFrameTime = 0;
const FRAME_INTERVAL = 1000 / baseSpeed; // Target frame interval in milliseconds

function setup() {
    createCanvas(800, 800);
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
    });
    
    socket.on('playerLeft', (id) => {
        players.delete(id);
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

function keyPressed() {
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