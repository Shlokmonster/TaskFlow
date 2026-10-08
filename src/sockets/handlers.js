'use strict';

const { rooms } = require('../utils/socketRegistry');
const { canJoinProject, canJoinTeam } = require('./rooms');
const logger = require('../config/logger');

/**
 * Client → server events.
 *
 * Every handler answers through the acknowledgement callback so the client can
 * tell success from refusal, and every join is re-checked against the database
 * — a socket can never add itself to a room it has no access to.
 */
function registerHandlers(io, socket) {
  const ack = (callback, payload) => {
    if (typeof callback === 'function') callback(payload);
  };

  socket.on('join:project', async (projectId, callback) => {
    try {
      const allowed = await canJoinProject(socket.user.id, projectId);
      if (!allowed) return ack(callback, { ok: false, error: 'You do not have access to this project' });

      socket.join(rooms.project(projectId));
      logger.debug('Socket %s joined project:%s', socket.id, projectId);
      return ack(callback, { ok: true, room: rooms.project(projectId) });
    } catch (err) {
      return ack(callback, { ok: false, error: err.message });
    }
  });

  socket.on('leave:project', (projectId, callback) => {
    socket.leave(rooms.project(projectId));
    ack(callback, { ok: true });
  });

  socket.on('join:team', async (teamId, callback) => {
    try {
      const allowed = await canJoinTeam(socket.user.id, teamId);
      if (!allowed) return ack(callback, { ok: false, error: 'You do not have access to this team' });

      socket.join(rooms.team(teamId));
      return ack(callback, { ok: true, room: rooms.team(teamId) });
    } catch (err) {
      return ack(callback, { ok: false, error: err.message });
    }
  });

  socket.on('leave:team', (teamId, callback) => {
    socket.leave(rooms.team(teamId));
    ack(callback, { ok: true });
  });

  /** Ephemeral "someone is typing" signal, scoped to a project. */
  socket.on('typing:start', ({ projectId, taskId } = {}, callback) => {
    if (!projectId) return ack(callback, { ok: false, error: 'projectId is required' });
    socket.to(rooms.project(projectId)).emit('typing:start', {
      taskId,
      user: socket.user,
      at: new Date().toISOString(),
    });
    return ack(callback, { ok: true });
  });

  socket.on('typing:stop', ({ projectId, taskId } = {}, callback) => {
    if (!projectId) return ack(callback, { ok: false, error: 'projectId is required' });
    socket.to(rooms.project(projectId)).emit('typing:stop', { taskId, user: socket.user });
    return ack(callback, { ok: true });
  });

  /** Lightweight liveness probe for clients that want to confirm auth. */
  socket.on('whoami', (callback) => ack(callback, { ok: true, user: socket.user }));
}

module.exports = { registerHandlers };
