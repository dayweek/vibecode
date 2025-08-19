# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a real-time multiplayer Snake game built with Node.js, Express, Socket.IO, and p5.js. Players control snakes in a shared game world, competing to eat food and grow while avoiding collisions with other snakes or themselves.

## Development Commands

- `npm start` - Start the production server
- `npm run dev` - Start development server with nodemon for auto-reload
- `npm install` - Install dependencies

## Architecture

### Backend (server.js)
- Express server serving static files and handling HTTP requests
- Socket.IO server managing real-time multiplayer communication
- Game state managed server-side with authoritative updates
- Game loop running at 50ms intervals (20fps) for game state updates
- Player movement speed increases with score using exponential decay
- Collision detection, food generation, and win condition handling
- Inactivity timeout (20 seconds) to clean up idle players

### Frontend (sketch.js + index.html)
- p5.js canvas-based rendering at configurable frame rate
- Socket.IO client receiving game state updates from server
- Audio system with background music and sound effects
- Client-side input handling (arrow keys) with server validation
- Winner detection with restart delay mechanism

### Game Mechanics
- Grid-based movement (20px scale)
- Screen wrapping (snakes wrap around edges)
- Color assignment system (20 predefined colors)
- Score-based speed increase using `speedFactor = 0.95`
- Win condition at 20 points
- Reset functionality that disconnects other players

### Audio Files
The game uses several audio files:
- `Pixelated Love.mp3` - Background music (loops)
- `eat.mp3` - Food consumption sound
- `die.mp3` - Collision/death sound  
- `new.mp3` - New player joined sound
- `win.mp3` - Victory sound

## Deployment

Uses Render.com for deployment (render.yaml configuration included).

## Key Implementation Details

- Server maintains authoritative game state in `gameState` object
- Players are stored in a Map with socket.id as key
- Movement timing controlled server-side with `lastMoveTime` tracking
- Food spawning includes collision checking to avoid spawning on snakes
- Client receives regular game state broadcasts but processes input locally first