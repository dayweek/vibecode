# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A real-time multiplayer gaming platform with seven games — **Bomberman**, **Snake**, **Hangman**, **Vibe Check**, **Draw It**, **Who Am I?** and **Space Hunt** — played through a single room system. Built with Node.js, **Colyseus** (`colyseus` + `@colyseus/ws-transport`), Express (static files + room-list API), and p5.js on the client.

There is one entry point: `/` shows a public room browser. Anyone can create a room (becoming its host), and inside the room's lobby the host picks which game to play. There are no per-game URLs.

## Development Commands

- `npm start` - Start the server
- `npm run dev` - Start development server with nodemon for auto-reload
- `npm install` - Install dependencies

Open **http://localhost:3000/** (override port with the `PORT` env var). Multiplayer: open the URL in multiple tabs/devices, or share a room link (`/?room=<roomId>`).

## File Map

Server (Node/Colyseus):

- `server.js` — Colyseus server; serves static files, exposes `GET /api/rooms` (public room list), defines the single `game` room type
- `schema.js` — the unified Colyseus schema shared by all games (`GameState`, `Player`, `Bomb`, `Wall`, …)
- `game-room.js` — `GameRoom`: lobby lifecycle, join/leave/reconnection, game dispatch; per-game logic is mixed into its prototype from the six `*-room.js` files
- `bomberman-room.js` / `snake-room.js` / `hangman-room.js` / `vibecheck-room.js` / `drawit-room.js` / `whoami-room.js` / `spacehunt-room.js` — each game's config, message handlers and game loop (exported as method objects, `this` = the room)

Client (p5.js, global mode — all files share globals):

- `index.html` — the whole client UI: welcome modal (name), room browser, lobby, and in-game HUD; loads the seven sketch files
- `game-sketch.js` — shared core: Colyseus connection, room browser/lobby UI, player state sync, sounds, and p5 lifecycle dispatch (`draw`/`keyPressed`/`mousePressed`/… route to the active game)
- `bomberman-sketch.js` / `snake-sketch.js` / `hangman-sketch.js` / `vibecheck-sketch.js` / `drawit-sketch.js` / `whoami-sketch.js` / `spacehunt-sketch.js` — each game's asset loading, state sync (`sync*State`), rendering (`draw*Game`) and input handlers
- `bomberman-assets/` — sprites and sounds for Bomberman rendering (character sprites are also used for lobby avatars)

## Room Lifecycle (all games)

- One Colyseus room type: `game`. Room state has `phase` (`'lobby'` | `'playing'`) and `gameType` (`'bomberman'` | `'snake'` | `'hangman'` | `'vibecheck'` | `'drawit'` | `'whoami'` | `'spacehunt'`).
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

## Vibe Check

- Wavelength-style party game; needs at least 2 players (best with 3+). Host configures rounds (`setVibeRounds`, 1–10, default 5)
- Each round one player is the **psychic** (role rotates through a shuffled order): the server privately sends them a target position 0–100 (`vibeTarget` message — never in synced state during the round) on a random scale pair like "Cheap ↔ Expensive"
- The psychic types a clue into an HTML input under the canvas (`vibeClue`, max 60 chars) → guess phase: everyone else clicks/drags a marker on the canvas scale (`vibeGuess`) and locks it in (`vibeLock`)
- The reveal fires when all guessers lock or the 60s guess deadline passes; the clue phase has a 90s deadline — a timeout or the psychic leaving hands the same round to the next psychic
- Scoring by distance from the target: ≤3 → 4 pts, ≤8 → 3, ≤15 → 2, ≤25 → 1, else 0; the psychic scores as much as their best guesser. Totals reuse `Player.score`
- Highest total after the last round wins (`winnerId` = sessionId or `'draw'`). With exactly 2 players the psychic and lone guesser always gain equal points, so 2-player games end in a draw
- Turn-based like hangman: the inactivity kick is disabled; the phase deadlines prevent stalls instead
- Client caveat: p5's global `mousePressed`/`mouseDragged` must not `preventDefault` events aimed at HTML UI (see the `event.target.tagName !== 'CANVAS'` guard in `game-sketch.js`), or clicks can't focus the clue input

## Draw It

- Pictionary-style drawing game; needs at least 2 players. Host configures rounds (`setDrawRounds`, 1–10, default 6)
- Each round one player is the **drawer** (role rotates through a shuffled order): the server privately sends them a word (`drawWord` message — the word never enters synced state during the round); everyone else sees only the mask (`drawMasked`), with a hint letter revealed at 40% and 70% of the round (always keeping at least one letter hidden)
- The drawer paints on a shared 580x440 board with mouse/touch: canvas palette with 9 colors (white doubles as eraser), 3 brush sizes and a clear button. Strokes are **not** in the Colyseus schema — the drawer sends batched polyline chunks (`drawStroke` `{c, s, p:[x0,y0,…]}` in board-space coords), the server validates, buffers them (for late joiners, sent as `drawInit` on join) and relays to everyone else; `drawClear` wipes the board. Clients paint chunks into a p5 `createGraphics` buffer
- Guessers type into an HTML input under the canvas (`drawGuess`); wrong guesses are broadcast to the feed (`drawFeed`), near-misses (edit distance 1) get a private "so close" nudge
- Scoring: correct guesses score by order — 5/4/3/2, then 1 — and the drawer gets +2 per correct guesser; totals reuse `Player.score`
- The round reveals when all guessers got it or the 75s deadline passes (`drawReveal` message + the word synced into `drawWord`/`drawMasked`); a drawer leaving hands the same round to the next drawer
- Highest total after the last round wins (`winnerId` = sessionId or `'draw'`); turn-based like hangman, so the inactivity kick is disabled

## Who Am I?

- Guess-the-character party game with no roles; playable solo (minPlayers 1). Host configures rounds (`setWhoRounds`, 1–10, default 5)
- Each round the server picks a famous character (fictional or real) from a built-in pool of ~40 in `whoami-room.js` (`{ name, accepts, clues }`); the name never enters synced state until the reveal. Five pregenerated clues, ordered hard → easy, auto-reveal one at a time every 15s (synced as `whoClues`, newline-joined)
- Everyone guesses via an HTML input under the canvas (`whoGuess`); wrong guesses go to the shared feed (`whoFeed`), near-misses (edit distance 1) get a private nudge. A guess matches the normalized full name, the last name (when ≥ 4 letters), or a per-character `accepts` alias list
- Scoring: points = 6 − clues revealed when you answer (5/4/3/2/1); totals reuse `Player.score`
- The round reveals when everyone has guessed correctly or 15s after the last clue (75s cap) → `whoReveal` message + the name synced into `whoCharacter`; highest total after the last round wins (`winnerId` = sessionId or `'draw'`)
- Inactivity kick disabled like the other party games; solo games skip the last-player-standing walkover (`participantsAtStart > 1` guard)

## Space Hunt

- Asteroids-style real-time PvP deathmatch; needs at least 2 players (`minPlayers 2`). No rounds, no lobby config — first to **20 kills** wins
- Each player flies a triangular ship on a borderless 900x700 arena with **continuous** momentum physics: **↑/W** thrusts, **←→/A D** rotate, **Space** fires. All movement wraps toroidally (leave any edge, reappear on the opposite side)
- Physics runs on the shared 100 ms room tick; ships have `x,y` + `angle` synced (velocity/held-input/respawn/fire timers live in `playerInternal`). The client interpolates position and heading between ticks (`syncSpacehuntFields`, mirroring snake)
- Held controls are sent to the server only when they change (`spaceInput` `{t,l,r,f}`, Bomberman-style), not per frame. Firing is held-to-shoot, gated server-side by `fireCooldown`
- Bullets (`GameState.bullets`, self-contained `Bullet` schema) travel, wrap, and expire after `bulletLife`; a bullet hitting a rival ship destroys it and scores the shooter **+1** (never self-hits or spawn-protected targets)
- Asteroids (`GameState.asteroids`, `Asteroid` schema) spawn off a random edge, drift across and despawn when off-screen (they **pass**, they don't wrap); touching one destroys a ship but scores nobody. **Bullets pass through asteroids** — they're indestructible hazards
- A destroyed ship respawns after `respawnDelay` (3 s) at a spot clear of asteroids with `spawnProtection` (~2.5 s, reuses `Player.protectedUntil`) of invulnerability; the client blinks the ship and shows a "respawning" notice
- Reaching 20 kills sets `winnerId` = sessionId, broadcasts the win sound and returns everyone to the lobby after 5 s. Real-time like snake, so the inactivity kick stays enabled

## Audio Files

`Pixelated Love.mp3` (music), `eat.mp3`, `die.mp3`, `new.mp3`, `win.mp3`, plus explosion/level-up sounds in `bomberman-assets/sound/`. Sound-effect toggle is persisted in localStorage.

## Deployment

Uses Render.com for deployment (render.yaml configuration included).
