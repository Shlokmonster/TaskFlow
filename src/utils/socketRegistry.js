'use strict';

/**
 * Socket.io registry.
 *
 * `server.js` installs the io instance here; services and controllers reach it
 * through these helpers. Two things fall out of that:
 *
 *   1. No circular imports — a service never requires `server.js`.
 *   2. Every emit is a safe no-op when io is absent (unit tests, the seed
 *      script, background jobs), so business logic never has to care whether
 *      the realtime layer is running.
 */

let io = null;

const rooms = {
  user: (id) => `user:${id}`,
  project: (id) => `project:${id}`,
  team: (id) => `team:${id}`,
};

function setIO(instance) {
  io = instance || null;
  return io;
}

function getIO() {
  return io;
}

function isSocketReady() {
  return Boolean(io);
}

/** Emit to a raw room name. Silently ignored when sockets are not running. */
function emitToRoom(room, event, payload) {
  if (!io) return false;
  io.to(room).emit(event, payload);
  return true;
}

/**
 * Emit to the **union** of several rooms.
 *
 * `io.to(a).to(b).emit()` delivers once to a socket that is in both rooms,
 * unlike two separate `io.to()` calls — which is why audience overlap between
 * `project:<id>` and `user:<id>` never produces a duplicate event.
 */
function emitToRooms(roomNames, event, payload) {
  if (!io) return false;
  const list = [...new Set(roomNames.filter(Boolean))];
  if (!list.length) return false;
  io.to(list[0]).to(list.slice(1)).emit(event, payload);
  return true;
}

/** Union emit to a project room plus a set of users. */
function emitToProjectAndUsers(projectId, userIds = [], event, payload) {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  return emitToRooms([rooms.project(projectId), ...unique.map(rooms.user)], event, payload);
}

const emitToUser = (userId, event, payload) => emitToRoom(rooms.user(userId), event, payload);
const emitToProject = (projectId, event, payload) => emitToRoom(rooms.project(projectId), event, payload);
const emitToTeam = (teamId, event, payload) => emitToRoom(rooms.team(teamId), event, payload);

/** Fan out to several users, de-duplicated. */
function emitToUsers(userIds = [], event, payload) {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  unique.forEach((id) => emitToUser(id, event, payload));
  return unique.length;
}

/** Force the live sockets of a user into / out of rooms (membership changes). */
function syncSocketRooms(userId, { join = [], leave = [] } = {}) {
  if (!io) return false;
  const userRoom = rooms.user(userId);
  if (join.length) io.in(userRoom).socketsJoin(join);
  if (leave.length) io.in(userRoom).socketsLeave(leave);
  return true;
}

module.exports = {
  rooms,
  setIO,
  getIO,
  isSocketReady,
  emitToRoom,
  emitToRooms,
  emitToUser,
  emitToUsers,
  emitToProject,
  emitToTeam,
  emitToProjectAndUsers,
  syncSocketRooms,
};
