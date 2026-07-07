# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A real-time multiplayer gaming platform with three games — **Bomberman**, **Snake** and **Hangman** — played through a single room system. Built with Node.js, **Colyseus** (`colyseus` + `@colyseus/ws-transport`), Express (static files + room-list API), and p5.js on the client.

There is one entry point: `/` shows a public room browser. Anyone can create a room (becoming its host), and inside the room's lobby the host picks which game to play. There are no per-game URLs.

## Development Commands

- `npm start` - Start the server
- `npm run dev` - Start development server with nodemon for auto-reload
- `npm install` - Install dependencies

Open **http://localhost:3000/** (override port with the `PORT` env var). Multiplayer: open the URL in multiple tabs/devices, or share a room link (`/?room=<roomId>`).

## File Map

- `server.js` — Colyseus server; serves static files, exposes `GET /api/rooms` (public room list), defines the single `game` room type
- `game-room.js` — `GameRoom`: lobby lifecycle + both games' server logic and the unified Colyseus schema (`GameState`, `Player`)
- `index.html` — the whole client UI: welcome modal (name), room browser, lobby, and in-game HUD
- `game-sketch.js` — p5.js client: lobby wiring, state sync, and per-game rendering/input
- `bomberman-assets/` — sprites and sounds for Bomberman rendering

## Room Lifecycle (both games)

- One Colyseus room type: `game`. Room state has `phase` (`'lobby'` | `'playing'`) and `gameType` (`'bomberman'` | `'snake'` | `'hangman'`).
- Anyone can create a room from the room browser and becomes its host; rooms are listed via `GET /api/rooms` (metadata: `hostName`, `phase`, `playerCount`, `gameType`) and joinable via `/?room=<roomId>`.
- In the lobby, the **host selects the game** (`setGameType` message; server validates host + lobby phase). Non-hosts see the selection but can't change it.
- Non-host players toggle Ready (`setReady`); the host can start (`startGame`) only when all others are ready.
- Players joining mid-game become spectators and play in the next game.
- When someone wins (or on a draw), everyone returns to the lobby after a short delay (`returnToLobby`).
- Reconnection: clients send a `persistentId` (localStorage); alive Bomberman players can reconnect mid-game. Opening a second tab with the same `persistentId` kicks the first session.
- 60-second inactivity timeout for alive players during a game; lobby/spectators are never kicked.

## Bomberman

- Server loop at 100ms; tile-based movement (32px tiles) at ~195ms intervals, faster with speed boosts
- Grid size is computed once when the host starts the game (based on player count) and stays fixed for that game
- Held-key movement: client sends `setDirections` with all held directions; server combines them (staircase movement around obstacles)
- Space bar places bombs (`placeBomb`): 3s fuse, cross-pattern explosion sized by `bombRange`, chain reactions, 0.5s explosion duration
- Destructible walls drop hidden bomb pickups (raise simultaneous-bomb limit) or powerups: flame (range), speed, invisibility, extra life, or spawn lava
- Lava tiles kill instantly; explosions kill unless the player has lives/spawn protection
- Last participant alive wins (solo games have no win check — they end when the player dies or leaves)

## Snake

- Runs in the same room/loop; fixed 800x800 grid, 20px scale
- Single keypress steering (`direction` message); server prevents 180° turns; base move interval 200ms, faster with score (`0.95^score`)
- Screen edges wrap; eating food grows the snake and increments score
- Colliding with any snake (including self) respawns you at score 0
- First to 20 points wins → everyone returns to the lobby

## Hangman

- Team game: in the lobby every player joins Team Red (`'A'`) or Team Blue (`'B'`) — self-pick or the host's "Random teams" button (`setTeam` / `randomizeTeams`); start is blocked until both teams are non-empty and nobody is unassigned
- Host configures the number of rounds (`setRounds`, 1–10, default 3) and a word theme (`setTheme`: `classic` | `it` | `vacation` | `cinema`); one random word per round from the theme's built-in list (the word itself never leaves the server — only the masked `hangmanRevealed` string is synced)
- Answers may be multi-word phrases ("back to the future"); spaces are shown as gaps from the start and can't be guessed
- Teams alternate turns (the opening team alternates each round); anyone on the active team may guess by clicking/tapping a letter button on the canvas (`guessLetter`)
- Correct guess: +10 points per revealed occurrence and the team keeps its turn; completing the word is +50 and ends the round
- Wrong guess: one of 6 gallows parts for that team and the turn passes; a team with 6 misses is out for the round; if both teams hang, the round ends unsolved
- Highest total score after the last round wins (`winnerId` = `'teamA'` | `'teamB'` | `'draw'`); a team also wins immediately if the whole opposing team leaves
- Turn-based, so the 60-second inactivity kick is disabled during hangman; team assignments survive returning to the lobby

## Audio Files

`Pixelated Love.mp3` (music), `eat.mp3`, `die.mp3`, `new.mp3`, `win.mp3`, plus explosion/level-up sounds in `bomberman-assets/sound/`. Sound-effect toggle is persisted in localStorage.

## Deployment

Uses Render.com for deployment (render.yaml configuration included).
