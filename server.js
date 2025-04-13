const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Available colors for players
const COLORS = [
    '#FF0000', // Red
    '#00FF00', // Lime
    '#0000FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Magenta
    '#00FFFF', // Cyan
    '#FFA500', // Orange
    '#800080', // Purple
    '#FFFFFF', // White
    '#ADD8E6'  // LightBlue
];

// Game state
const gameState = {
    players: new Map(), // Map of playerId -> player data
    food: [],
    width: 600,
    height: 600,
    scale: 20,
    updateInterval: 50, // ms per game update tick
    baseMoveInterval: 200, // ms between moves at base speed
    speedFactor: 0.95, // Speed multiplier per score point (lower is faster)
    usedColors: new Set() // Keep track of colors currently in use
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

    gameState.players.forEach((player, playerId) => {
        // Determine time needed for next move based on score
        const moveInterval = gameState.baseMoveInterval * Math.pow(gameState.speedFactor, player.score);
        
        // Check if enough time has passed to move
        if (now - player.lastMoveTime >= moveInterval) {
            player.lastMoveTime = now; // Reset move timer

            // Calculate new head position (one grid cell)
            const newHeadX = player.segments[0].x + player.direction.x * gameState.scale;
            const newHeadY = player.segments[0].y + player.direction.y * gameState.scale;
            
            // Store the position of the last segment *before* moving
            const tailPosition = { ...player.segments[player.segments.length - 1] };
            let ateFood = false;

            // Update tail segments (move each segment to the position of the one before it)
            for (let i = player.segments.length - 1; i > 0; i--) {
                player.segments[i] = { ...player.segments[i - 1] };
            }

            // Update head position
            player.segments[0].x = newHeadX;
            player.segments[0].y = newHeadY;

            // Wrap around the screen
            if (player.segments[0].x >= gameState.width) player.segments[0].x = 0;
            if (player.segments[0].x < 0) player.segments[0].x = gameState.width - gameState.scale;
            if (player.segments[0].y >= gameState.height) player.segments[0].y = 0;
            if (player.segments[0].y < 0) player.segments[0].y = gameState.height - gameState.scale;

            // Check for food collision
            gameState.food.forEach((food, index) => {
                if (player.segments[0].x === food.x && player.segments[0].y === food.y) {
                    // Add new segment using the stored tail position
                    player.segments.push(tailPosition);
                    player.score++;
                    ateFood = true;
                    // Remove eaten food
                    gameState.food.splice(index, 1);
                    // Generate new food
                    generateFood(1);
                }
            });

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
                // Reset player on collision
                player.segments = [{ x: Math.floor(Math.random() * (gameState.width / gameState.scale)) * gameState.scale,
                                   y: Math.floor(Math.random() * (gameState.height / gameState.scale)) * gameState.scale }];
                player.score = 0;
                player.direction = { x: 1, y: 0 }; // Reset direction
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
        timestamp: Date.now()
    };

    io.emit('gameState', state);
}

// Start game loop
setInterval(() => {
    updateGameState();
    broadcastGameState();
}, gameState.updateInterval); // Use defined interval

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
        score: 0,
        color: color,
        lastMoveTime: Date.now() // Initialize move timer
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

    // Handle direction changes
    socket.on('direction', (direction) => {
        const player = gameState.players.get(socket.id);
        if (player && player.segments.length > 0) { // Check if player exists and has segments
            // Prevent 180-degree turns only if snake has more than one segment
            const isOppositeDirection = player.direction.x === -direction.x && player.direction.y === -direction.y;
            if (!(player.segments.length > 1 && isOppositeDirection)) {
                player.direction = direction;
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
        playerToKeep.lastMoveTime = Date.now(); // Prevent immediate move

        // Broadcast the updated state (now with only one player, reset)
        broadcastGameState(); 
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        const player = gameState.players.get(socket.id);
        if (player) {
            gameState.usedColors.delete(player.color); // Release the color
            gameState.players.delete(socket.id);
            io.emit('playerLeft', socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 