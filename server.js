const express = require('express');
const { Server: ColyseusServer, matchMaker } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { GameRoom } = require('./game-room');

const PORT = process.env.PORT || 3000;

// Initialize Colyseus server with rooms and static file serving
const colyseusServer = new ColyseusServer({
    transport: new WebSocketTransport({
        pingInterval: 6000,
        pingMaxRetries: 4,
    }),
    // Mount static files on the transport's Express app
    express: (app) => {
        // Public listing of all rooms for the room browser
        app.get('/api/rooms', async (req, res) => {
            try {
                const rooms = await matchMaker.query({ name: 'game' });
                res.json(rooms.map(r => ({
                    roomId: r.roomId,
                    clients: r.clients,
                    maxClients: r.maxClients,
                    metadata: r.metadata || {},
                })));
            } catch (e) {
                console.error('Failed to list rooms:', e);
                res.status(500).json({ error: 'Failed to list rooms' });
            }
        });

        app.use(express.static('.'));
    },
});

// One generic room type; the host picks the game (snake or bomberman)
// inside the room's lobby.
colyseusServer.define('game', GameRoom);

colyseusServer.listen(PORT).then(() => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Room browser available at http://localhost:${PORT}/`);
});
