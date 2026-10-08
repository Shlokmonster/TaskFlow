'use strict';

const { Project, Team } = require('../models');
const { rooms, syncSocketRooms } = require('../utils/socketRegistry');
const logger = require('../config/logger');

/**
 * Rooms a user is entitled to, derived from the database (never from the
 * client). Used both when a socket connects and when membership changes.
 */
async function entitlementsFor(userId) {
  const [projects, teams] = await Promise.all([
    Project.find({ $or: [{ owner: userId }, { members: userId }] }).select('_id').lean(),
    Team.find({ $or: [{ lead: userId }, { 'members.user': userId }] }).select('_id').lean(),
  ]);

  return {
    projects: projects.map((p) => rooms.project(p._id)),
    teams: teams.map((t) => rooms.team(t._id)),
  };
}

/** Join a freshly connected socket to its user / project / team rooms. */
async function joinUserRooms(socket) {
  const { projects, teams } = await entitlementsFor(socket.user.id);

  socket.join(rooms.user(socket.user.id));
  if (projects.length) socket.join(projects);
  if (teams.length) teams.forEach((room) => socket.join(room));

  logger.debug('Socket %s joined %d project + %d team room(s)', socket.id, projects.length, teams.length);
  return { projects, teams };
}

/** Re-validate a client-requested project join against the database. */
async function canJoinProject(userId, projectId) {
  const project = await Project.findOne({
    _id: projectId,
    $or: [{ owner: userId }, { members: userId }],
  }).select('_id');
  return Boolean(project);
}

/** Re-validate a client-requested team join against the database. */
async function canJoinTeam(userId, teamId) {
  const team = await Team.findOne({
    _id: teamId,
    $or: [{ lead: userId }, { 'members.user': userId }],
  }).select('_id');
  return Boolean(team);
}

/** Push room changes onto a user's already-connected sockets. */
function syncUserRooms(userId, changes) {
  return syncSocketRooms(userId, changes);
}

module.exports = { entitlementsFor, joinUserRooms, canJoinProject, canJoinTeam, syncUserRooms };
