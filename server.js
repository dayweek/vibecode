const express = require('express');
const { Server: ColyseusServer, matchMaker } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { SnakeRoom } = require('./snake-room');
const { BombermanRoom } = require('./bomberman-room');

const PORT = process.env.PORT || 3000;

// Initialize Colyseus server with rooms and static file serving
const colyseusServer = new ColyseusServer({
    transport: new WebSocketTransport({
        pingInterval: 6000,
        pingMaxRetries: 4,
    }),
    // Mount static files on the transport's Express app
    express: (app) => {
        app.use(express.static('.'));
    },
});

// Define rooms
colyseusServer.define('snake', SnakeRoom);
colyseusServer.define('bomberman', BombermanRoom);

colyseusServer.listen(PORT).then(() => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Snake game available at http://localhost:${PORT}/`);
    console.log(`Bomberman game available at http://localhost:${PORT}/bomberman.html`);
});
