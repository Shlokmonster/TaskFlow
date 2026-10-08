'use strict';

const { Server } = require('socket.io');

const env = require('../config/env');
const logger = require('../config/logger');
const { setIO, rooms } = require('../utils/socketRegistry');
const socketAuth = require('./auth');
const { joinUserRooms } = require('./rooms');
const { registerHandlers } = require('./handlers');

/**
 * Attach Socket.io to the HTTP server and publish the instance to the registry
 * so services can broadcast without importing this module.
 *
 * Server → client events (always emitted after a successful database write):
 *   task:created, task:updated, task:deleted, task:assigned
 *   comment:added, comment:updated, comment:deleted
 *   project:updated, project:deleted
 *   team:updated, team:deleted
 *   time:started, time:stopped
 *   notification            (mirror of the FCM push, for connected clients)
 *
 * Client → server events: join:project, leave:project, join:team, leave:team,
 *   typing:start, typing:stop, whoami. Each acknowledges with { ok, error? }.
 */
function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigin(), methods: ['GET', 'POST'], credentials: true },
    pingTimeout: 25000,
    pingInterval: 20000,
    maxHttpBufferSize: 1e6,
  });

  setIO(io);

  io.use(socketAuth);

  io.on('connection', async (socket) => {
    logger.debug('Socket connected: %s (user %s)', socket.id, socket.user.id);

    try {
      await joinUserRooms(socket);
    } catch (err) {
      logger.warn('Failed to join rooms for socket %s: %s', socket.id, err.message);
    }

    socket.emit('connected', { user: socket.user, rooms: [...socket.rooms] });

    registerHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      logger.debug('Socket disconnected: %s (%s)', socket.id, reason);
    });

    socket.on('error', (err) => {
      logger.warn('Socket error on %s: %s', socket.id, err.message);
    });
  });

  logger.info('Socket.io initialised');
  return io;
}

module.exports = { initSockets, rooms };
