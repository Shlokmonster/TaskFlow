'use strict';

const { Team, Project, User } = require('../models');
const ApiError = require('../utils/ApiError');
const { isAdmin, changedFields } = require('../utils/rbac');
const { getPagination, buildMeta } = require('../utils/pagination');
const { searchOr } = require('../utils/text');
const { emitToTeam, syncSocketRooms, rooms } = require('../utils/socketRegistry');
const access = require('./access.service');
const { notifyUsers, TYPES } = require('./notification.service');

const POPULATE = [
  { path: 'lead', select: 'name email avatarUrl role' },
  { path: 'members.user', select: 'name email avatarUrl role' },
  { path: 'projects', select: 'name key status' },
];

const SORTABLE = ['createdAt', 'updatedAt', 'name'];

async function assertUsersExist(ids = []) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return [];

  const found = await User.find({ _id: { $in: unique } }).distinct('_id');
  const foundSet = new Set(found.map(String));
  const missing = unique.filter((id) => !foundSet.has(id));
  if (missing.length) throw ApiError.badRequest(`Unknown user id(s): ${missing.join(', ')}`);
  return unique;
}

/** Normalise `[{user, role}]` (or bare ids) and guarantee the lead is listed. */
function normaliseMembers(members = [], leadId) {
  const map = new Map();

  members.forEach((entry) => {
    const id = String(entry?.user || entry);
    if (!id) return;
    map.set(id, { user: id, role: entry?.role === 'lead' ? 'lead' : 'member', joinedAt: entry?.joinedAt || new Date() });
  });

  if (leadId) {
    const existing = map.get(String(leadId));
    map.set(String(leadId), { user: String(leadId), role: 'lead', joinedAt: existing?.joinedAt || new Date() });
  }

  return [...map.values()];
}

async function listTeams(user, query = {}) {
  const { page, limit, skip, sort } = getPagination(query, { allowedSort: SORTABLE, defaultSort: '-createdAt' });

  const filter = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  // Combined with $and so a search clause can never widen the membership scope.
  const conditions = [];
  if (!isAdmin(user)) {
    conditions.push({ $or: [{ lead: user._id }, { 'members.user': user._id }] });
  }
  if (query.search) {
    conditions.push({ $or: searchOr(query.search, ['name', 'description']) });
  }
  if (conditions.length) filter.$and = conditions;

  const [teams, total] = await Promise.all([
    Team.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    Team.countDocuments(filter),
  ]);

  return { items: teams.map((t) => t.toJSON()), meta: buildMeta(page, limit, total) };
}

async function getTeam(teamId, user) {
  const team = await Team.findById(teamId).populate(POPULATE);
  if (!team) throw ApiError.notFound('Team');
  access.assertTeamAccess(team, user);
  return team;
}

async function createTeam(user, payload) {
  const existing = await Team.findOne({ name: payload.name });
  if (existing) throw ApiError.conflict(`A team named '${payload.name}' already exists`);

  const leadId = payload.lead ? String(payload.lead) : String(user._id);
  // A lead may create a team for themselves; assigning someone else as lead is
  // an admin action.
  if (payload.lead && !isAdmin(user) && leadId !== String(user._id)) {
    throw ApiError.forbidden('Only an admin can create a team led by someone else');
  }

  const ids = await assertUsersExist([leadId, ...payload.members.map((m) => m.user || m)]);
  if (payload.projects?.length) {
    const found = await Project.find({ _id: { $in: payload.projects } }).distinct('_id');
    if (found.length !== new Set(payload.projects.map(String)).size) {
      throw ApiError.badRequest('One or more project ids do not exist');
    }
  }

  const team = await Team.create({
    name: payload.name,
    description: payload.description || '',
    lead: leadId,
    members: normaliseMembers(payload.members, leadId),
    projects: payload.projects || [],
  });

  await team.populate(POPULATE);
  syncSocketRooms(leadId, { join: [rooms.team(team._id)] });

  const event = { team: team.toJSON(), actorId: String(user._id), action: 'created' };
  emitToTeam(team._id, 'team:updated', event);

  const memberIds = (team.members || []).map((m) => String(m.user?._id || m.user)).filter((id) => id !== String(user._id));
  if (memberIds.length) {
    memberIds.forEach((id) => syncSocketRooms(id, { join: [rooms.team(team._id)] }));
    await notifyUsers({
      userIds: memberIds,
      type: TYPES.GENERAL,
      title: 'Added to a team',
      body: `You were added to the ${team.name} team`,
      data: { teamId: String(team._id) },
      excludeUserId: user._id,
    });
  }

  void ids;
  return team;
}

async function updateTeam(teamId, user, payload) {
  const team = await access.loadTeam(teamId);
  access.assertTeamManage(team, user);

  if (payload.name && payload.name !== team.name) {
    const duplicate = await Team.findOne({ name: payload.name, _id: { $ne: team._id } });
    if (duplicate) throw ApiError.conflict(`A team named '${payload.name}' already exists`);
  }

  if (payload.lead && !isAdmin(user) && String(payload.lead) !== String(user._id)) {
    throw ApiError.forbidden('Only an admin can hand a team to another lead');
  }

  if (payload.projects) {
    const found = await Project.find({ _id: { $in: payload.projects } }).distinct('_id');
    if (found.length !== new Set(payload.projects.map(String)).size) {
      throw ApiError.badRequest('One or more project ids do not exist');
    }
  }

  const before = team.toObject();
  const previousMembers = (before.members || []).map((m) => String(m.user));

  const leadId = payload.lead ? String(payload.lead) : String(team.lead);

  if (payload.members) {
    await assertUsersExist(payload.members.map((m) => m.user || m));
    payload.members = normaliseMembers(payload.members, leadId);
  }

  Object.entries(payload).forEach(([key, value]) => {
    team[key] = value;
  });
  if (payload.lead && !payload.members) {
    team.members = normaliseMembers(team.members.map((m) => ({ user: String(m.user), role: m.role, joinedAt: m.joinedAt })), leadId);
  }

  await team.save();
  await team.populate(POPULATE);

  const after = team.toObject();
  const currentMembers = (after.members || []).map((m) => String(m.user));

  const added = currentMembers.filter((id) => !previousMembers.includes(id));
  const removed = previousMembers.filter((id) => !currentMembers.includes(id));

  added.forEach((id) => syncSocketRooms(id, { join: [rooms.team(team._id)] }));
  removed.forEach((id) => syncSocketRooms(id, { leave: [rooms.team(team._id)] }));

  const changes = changedFields(before, Object.fromEntries(Object.keys(payload).map((k) => [k, after[k]])));
  emitToTeam(team._id, 'team:updated', { team: team.toJSON(), changes, actorId: String(user._id) });

  if (added.length) {
    await notifyUsers({
      userIds: added,
      type: TYPES.GENERAL,
      title: 'Added to a team',
      body: `You were added to the ${team.name} team`,
      data: { teamId: String(team._id) },
      excludeUserId: user._id,
    });
  }

  return team;
}

/** Admin only. Unlinks the team from its projects rather than deleting them. */
async function deleteTeam(teamId, user) {
  const team = await access.loadTeam(teamId);
  if (!isAdmin(user)) throw ApiError.forbidden('Only an admin can delete a team');

  await Promise.all([
    Project.updateMany({ team: team._id }, { $set: { team: null } }),
    Team.deleteOne({ _id: team._id }),
  ]);

  emitToTeam(team._id, 'team:deleted', { teamId: String(team._id), actorId: String(user._id) });
  return { teamId: String(team._id) };
}

module.exports = { listTeams, getTeam, createTeam, updateTeam, deleteTeam, POPULATE };
