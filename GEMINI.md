# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a real-time multiplayer gaming platform featuring two games: **Snake** and **Bomberman**. Both are built with Node.js, Express, Socket.IO, and p5.js, sharing server infrastructure while using separate Socket.IO namespaces.

## Development Commands

- `npm start` - Start the production server (both games)
- `npm run dev` - Start development server with nodemon for auto-reload
- `npm install` - Install dependencies

## Architecture

### Backend (server.js)
- Express server serving static files and handling HTTP requests
- Socket.IO server managing real-time multiplayer communication for both games
- Two separate game instances:
  - Snake game on default namespace (`/`)
  - Bomberman game on `/bomberman` namespace
- Server-authoritative game loops with 50-100ms update intervals
- Inactivity timeouts to clean up idle players
- Shared color assignment system (20 predefined colors)

### Snake Game

#### Backend (server.js)
- Game loop running at 50ms intervals (20fps)
- Player movement speed increases with score using exponential decay
- Food generation with collision avoidance
- Win condition at 20 points
- 20-second inactivity timeout

#### Frontend (sketch.js + index.html)
- Available at `http://localhost:3000/`
- p5.js canvas-based rendering (800x800px)
- Arrow key controls for snake movement
- Background music and sound effects (eat, die, new player, win)
- Winner detection with restart delay

#### Game Mechanics
- Grid-based movement (20px scale)
- Screen wrapping (snakes wrap around edges)
- Score-based speed increase using `speedFactor = 0.95`
- Collision with other snakes or self causes reset
- Players grow by eating food

### Bomberman Game

#### Backend (bomberman-server.js)
- Game loop running at 100ms intervals
- **Dynamic grid sizing** based on player count:
  - 1-4 players: 16x14 grid (480x420px)
  - 5-12 players: 24x20 grid (720x600px)
  - 13-20 players: 32x27 grid (960x810px)
- Grid automatically resizes when players join/leave
- 60-second inactivity timeout
- Tile-based movement at 300ms intervals

#### Frontend (bomberman-sketch.js + bomberman.html)
- Available at `http://localhost:3000/bomberman.html`
- p5.js canvas with dynamic resizing
- Continuous movement (hold arrow key to keep moving)
- Space bar to place bombs
- Scrolling disabled for better UX

#### Game Mechanics
- **Tile-based grid** (30px per tile)
- **Player spawning**: 8 spawn points distributed across corners and edges
  - Players distributed evenly across spawn points
  - L-shaped safe zones at each spawn (4 tiles horizontal + 4 tiles vertical)
- **Movement**: Players can pass through each other but not through walls or bombs
- **Walls**:
  - Indestructible walls at even row/even col positions (excluding edges)
  - Destructible walls randomly placed (40% density)
  - 25% of destructible walls contain hidden bomb pickups
- **Bombs**:
  - Players start with 1 bomb
  - Bomb pickups increase **simultaneous bomb limit** (not consumed)
  - 3-second fuse before explosion
  - Cross-pattern explosion (2 tiles in each direction)
  - Explosions destroy destructible walls and stop at indestructible walls
  - 0.5-second explosion duration
- **Bomb System**:
  - `maxBombs`: Maximum bombs that can be placed simultaneously
  - `activeBombs`: Currently placed bombs
  - Can place bombs up to limit, which frees up when they explode
- **Death**: Players die when caught in explosions
- **No initial pickups**: Bombs only drop from destroying destructible walls

### Audio Files
Both games use audio files:
- `Pixelated Love.mp3` - Background music (loops)
- `eat.mp3` - Food/pickup consumption sound
- `die.mp3` - Death sound
- `new.mp3` - New player joined sound
- `win.mp3` - Victory sound

## Deployment

Uses Render.com for deployment (render.yaml configuration included).

## Key Implementation Details

### Snake Game
- Server maintains authoritative game state in `gameState` object
- Players stored in a Map with socket.id as key
- Movement timing controlled server-side with `lastMoveTime` tracking
- Food spawning includes collision checking
- Pending direction system prevents 180-degree turns

### Bomberman Game
- Uses Socket.IO namespace `/bomberman` to isolate from Snake game
- **Dynamic grid sizing** recalculates on player join/disconnect
- Server maintains authoritative bomb and explosion state
- Continuous movement via `moveStart`/`moveStop` events
- Safe spawn zones prevent immediate death from first bomb
- Wall generation ensures all areas accessible after destroying destructible walls
- Bomb collision prevents players from walking through bombs
- Players can walk through each other for better gameplay
