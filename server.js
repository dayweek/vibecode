const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const BombermanGame = require('./bomberman-server');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Available colors for players
const COLORS = [
    // Primary/Secondary
    '#FF0000', // Red
    '#00FF00', // Lime
    '#0000FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Magenta
    '#00FFFF', // Cyan
    // Tertiary/Other
    '#FFA500', // Orange
    '#800080', // Purple
    '#FFFFFF', // White
    '#008000', // Green
    '#ADD8E6', // LightBlue
    '#FFC0CB', // Pink
    '#A52A2A', // Brown
    '#808080', // Gray
    '#FFD700', // Gold
    '#40E0D0', // Turquoise
    '#FA8072', // Salmon
    '#90EE90', // LightGreen
    '#E6E6FA', // Lavender
    '#D2B48C'  // Tan
];

// Game state
const gameState = {
    players: new Map(), // Map of playerId -> player data
    food: [],
    width: 800,
    height: 800,
    scale: 20,
    updateInterval: 50, // ms per game update tick
    baseMoveInterval: 200, // ms between moves at base speed
    speedFactor: 0.95, // Speed multiplier per score point (lower is faster)
    usedColors: new Set(), // Keep track of colors currently in use
    winnerId: null, // ID of the winning player
    winningScore: 20 // Score needed to win
};

// Function to get the next available color
function getAvailableColor() {
    for (const color of COLORS) {
        if (!gameState.usedColors.has(color)) {
            return color;
        }
    }
    // If all base colors are used, fallback to the first color (or handle differently)
    console.warn("All primary colors are in use. Reusing colors.");
    return COLORS[0]; 
}

// Generate random position for food
function generateFood(count = 1) {
    const cols = Math.floor(gameState.width / gameState.scale);
    const rows = Math.floor(gameState.height / gameState.scale);
    
    for (let i = 0; i < count; i++) {
        let x = Math.floor(Math.random() * cols) * gameState.scale;
        let y = Math.floor(Math.random() * rows) * gameState.scale;
        // Ensure food doesn't spawn on a snake
        let validPosition = false;
        while (!validPosition) {
            validPosition = true;
            gameState.players.forEach(player => {
                player.segments.forEach(segment => {
                    if (segment.x === x && segment.y === y) {
                        validPosition = false;
                    }
                });
            });
            if (!validPosition) {
                // Try new position if invalid
                x = Math.floor(Math.random() * cols) * gameState.scale;
                y = Math.floor(Math.random() * rows) * gameState.scale;
            }
        }
        gameState.food.push({ x, y });
    }
}

// Initialize food
generateFood(5);

// Serve static files
app.use(express.static('.'));

// Update game state
function updateGameState() {
    const now = Date.now();

    // Pause game logic if there's a winner
    if (gameState.winnerId) return;

    gameState.players.forEach((player, playerId) => {
        // Determine time needed for next move based on score
        const moveInterval = gameState.baseMoveInterval * Math.pow(gameState.speedFactor, player.score);
        
        // Check if enough time has passed to move
        if (now - player.lastMoveTime >= moveInterval) {
            player.lastMoveTime = now; // Reset move timer
            
            // Apply pending direction change at the moment of movement to prevent race conditions
            if (player.pendingDirection) {
                player.direction = player.pendingDirection;
                player.pendingDirection = null; // Clear pending direction
            }

            // Calculate new head position (one grid cell)
            let newHeadX = player.segments[0].x + player.direction.x * gameState.scale;
            let newHeadY = player.segments[0].y + player.direction.y * gameState.scale;

            // Wrap around the screen for new head position
            if (newHeadX >= gameState.width) newHeadX = 0;
            if (newHeadX < 0) newHeadX = gameState.width - gameState.scale;
            if (newHeadY >= gameState.height) newHeadY = 0;
            if (newHeadY < 0) newHeadY = gameState.height - gameState.scale;

            // Check for food collision at the new head position before moving
            let ateFood = false;
            gameState.food.forEach((food, index) => {
                if (newHeadX === food.x && newHeadY === food.y) {
                    ateFood = true;
                    player.score++;

                    // Emit sound effect event to the player
                    const playerSocket = io.sockets.sockets.get(playerId);
                    if (playerSocket) playerSocket.emit('playEatSound');

                    // Check for win condition
                    if (player.score >= gameState.winningScore) {
                        gameState.winnerId = playerId;
                        console.log(`Player ${playerId} wins!`);
                        io.emit('playWinSound'); // Emit win sound to all
                    }

                    // Remove eaten food
                    gameState.food.splice(index, 1);
                    // Generate new food only if no winner yet
                    if (!gameState.winnerId) {
                        generateFood(1);
                    }
                }
            });

            // Move the snake: if food was eaten, grow by keeping tail; otherwise move normally
            if (ateFood) {
                // When growing: move all segments normally, then add the old tail back
                const tailPosition = { ...player.segments[player.segments.length - 1] };
                
                // Move each segment to the position of the one before it
                for (let i = player.segments.length - 1; i > 0; i--) {
                    player.segments[i] = { ...player.segments[i - 1] };
                }
                // Update head position
                player.segments[0].x = newHeadX;
                player.segments[0].y = newHeadY;
                
                // Add back the tail segment to grow the snake
                player.segments.push(tailPosition);
            } else {
                // Normal movement: move each segment to the position of the one before it
                for (let i = player.segments.length - 1; i > 0; i--) {
                    player.segments[i] = { ...player.segments[i - 1] };
                }
                // Update head position
                player.segments[0].x = newHeadX;
                player.segments[0].y = newHeadY;
            }

            // Check for collisions with other snakes (and self)
            let collisionDetected = false;
            gameState.players.forEach((otherPlayer, otherId) => {
                // Check collision with other snakes' bodies (excluding their head)
                const segmentsToCheck = otherPlayer.segments.slice(otherId === playerId ? 1 : 0); // Don't collide with own head
                segmentsToCheck.forEach(segment => {
                    if (player.segments[0].x === segment.x && player.segments[0].y === segment.y) {
                        collisionDetected = true;
                    }
                });
            });
            
            if (collisionDetected) {
                // Emit sound effect event to the player
                const playerSocket = io.sockets.sockets.get(playerId);
                if (playerSocket) playerSocket.emit('playDieSound');

                // Reset player on collision
                player.segments = [{ x: Math.floor(Math.random() * (gameState.width / gameState.scale)) * gameState.scale,
                                   y: Math.floor(Math.random() * (gameState.height / gameState.scale)) * gameState.scale }];
                player.score = 0;
                player.direction = { x: 1, y: 0 }; // Reset direction
                player.pendingDirection = null; // Clear any pending direction
                player.lastMoveTime = now; // Reset move timer immediately
            }
        }
    });
}

// Broadcast game state to all clients
function broadcastGameState() {
    const state = {
        players: Array.from(gameState.players.entries()).map(([id, player]) => ({
            id,
            segments: player.segments,
            score: player.score,
            color: player.color
        })),
        food: gameState.food,
        winnerId: gameState.winnerId,
        timestamp: Date.now()
    };

    io.emit('gameState', state);
}

// Function to handle disconnection (used by inactivity check and socket disconnect)
function handleDisconnect(playerId) {
    console.log(`Disconnecting player ${playerId}...`);
    const player = gameState.players.get(playerId);
    if (player) {
        gameState.usedColors.delete(player.color); // Release the color
        gameState.players.delete(playerId);
        io.emit('playerLeft', playerId); // Notify clients
    }
}

// Start game loop
setInterval(() => {
    updateGameState();
    broadcastGameState();
}, gameState.updateInterval); // Use defined interval

// Start inactivity check loop
const INACTIVITY_TIMEOUT = 20000; // 20 seconds
setInterval(() => {
    const now = Date.now();
    gameState.players.forEach((player, playerId) => {
        if (now - player.lastActivityTime > INACTIVITY_TIMEOUT) {
            console.log(`Player ${playerId} timed out due to inactivity.`);
            const targetSocket = io.sockets.sockets.get(playerId);
            if (targetSocket) {
                targetSocket.disconnect(true); // Force disconnect socket
            }
            handleDisconnect(playerId); // Clean up game state
        }
    });
}, 1000); // Check every second

// Socket connection handling
io.on('connection', (socket) => {
    console.log('New player connected:', socket.id);

    // Assign the next available color
    const color = getAvailableColor();
    gameState.usedColors.add(color); // Mark color as used

    // Initialize new player
    const newPlayer = {
        segments: [{ x: Math.floor(Math.random() * (gameState.width / gameState.scale)) * gameState.scale,
                     y: Math.floor(Math.random() * (gameState.height / gameState.scale)) * gameState.scale }], // Start at random grid position
        direction: { x: 1, y: 0 },
        pendingDirection: null, // Initialize pending direction for race condition prevention
        score: 0,
        color: color,
        lastMoveTime: Date.now(), // Initialize move timer
        lastActivityTime: Date.now() // Initialize activity timer
    };
    gameState.players.set(socket.id, newPlayer);

    // Send initial game state to new player
    socket.emit('init', {
        playerId: socket.id,
        gameState: {
            players: Array.from(gameState.players.entries()).map(([id, player]) => ({
                id,
                segments: player.segments,
                score: player.score,
                color: player.color
            })),
            food: gameState.food
        }
    });

    // Notify all players about the new player (and play sound)
    io.emit('playerJoined', { 
        playerId: socket.id, 
        playerData: newPlayer 
    }); 
    io.emit('playNewSound');

    // Handle direction changes
    socket.on('direction', (direction) => {
        const player = gameState.players.get(socket.id);
        if (player && player.segments.length > 0) { // Check if player exists and has segments
            player.lastActivityTime = Date.now(); // Update activity time
            
            // Use pending direction to prevent race conditions from rapid key presses
            const currentDirection = player.pendingDirection || player.direction;
            
            // Prevent 180-degree turns only if snake has more than one segment
            const isOppositeDirection = currentDirection.x === -direction.x && currentDirection.y === -direction.y;
            if (!(player.segments.length > 1 && isOppositeDirection)) {
                // Store the new direction as pending, to be applied on next move
                player.pendingDirection = direction;
            }
        }
    });

    // Handle reset request
    socket.on('resetGame', () => {
        console.log(`Reset request received from ${socket.id}`);
        const resetInitiatorId = socket.id;
        const playerToKeep = gameState.players.get(resetInitiatorId);

        if (!playerToKeep) return; // Should not happen, but safety check

        // Disconnect all other players
        gameState.players.forEach((player, id) => {
            if (id !== resetInitiatorId) {
                const targetSocket = io.sockets.sockets.get(id);
                if (targetSocket) {
                    console.log(`Disconnecting player ${id} due to reset.`);
                    // Release color before disconnecting
                    if (player.color) {
                        gameState.usedColors.delete(player.color);
                    }
                    targetSocket.disconnect(true); // Force disconnect
                    gameState.players.delete(id); // Remove from state immediately
                }
            }
        });

        // Reset the initiator's state as well
        playerToKeep.score = 0;
        playerToKeep.segments = [{ x: Math.floor(Math.random() * (gameState.width / gameState.scale)) * gameState.scale,
                                   y: Math.floor(Math.random() * (gameState.height / gameState.scale)) * gameState.scale }];
        playerToKeep.direction = { x: 1, y: 0 }; // Optional: Reset direction too
        playerToKeep.pendingDirection = null; // Clear any pending direction
        playerToKeep.lastMoveTime = Date.now(); // Prevent immediate move

        // Broadcast the updated state (now with only one player, reset)
        broadcastGameState(); 
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        handleDisconnect(socket.id);
    });

    // Handle restart request
    socket.on('requestRestart', () => {
        // Only allow restart if there is a winner
        if (gameState.winnerId) {
            console.log(`Restart requested by ${socket.id}. Resetting game...`);
            gameState.winnerId = null; // Clear the winner
            gameState.food = []; // Clear existing food
            generateFood(5); // Generate new food

            // Reset all players
            gameState.players.forEach((player) => {
                player.score = 0;
                player.segments = [{ x: Math.floor(Math.random() * (gameState.width / gameState.scale)) * gameState.scale,
                                   y: Math.floor(Math.random() * (gameState.height / gameState.scale)) * gameState.scale }];
                player.direction = { x: 1, y: 0 };
                player.pendingDirection = null; // Clear any pending direction
                player.lastMoveTime = Date.now();
                player.lastActivityTime = Date.now();
            });

            // Broadcast the reset state immediately
            broadcastGameState();
        }
    });
});

// Initialize Bomberman game (uses /bomberman namespace)
const bombermanGame = new BombermanGame(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Snake game available at http://localhost:${PORT}/`);
    console.log(`Bomberman game available at http://localhost:${PORT}/bomberman.html`);
}); 