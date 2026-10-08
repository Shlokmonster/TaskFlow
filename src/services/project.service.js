'use strict';

const { Project, Task, Comment, TimeEntry, Team, User } = require('../models');
const ApiError = require('../utils/ApiError');
const { isAdmin, changedFields, sameId } = require('../utils/rbac');
const { getPagination, buildMeta } = require('../utils/pagination');
const { searchOr } = require('../utils/text');
const { buildProjectProgress, buildSingleProjectProgress } = require('../utils/projectProgress');
const { emitToProject, emitToTeam, syncSocketRooms, rooms } = require('../utils/socketRegistry');
const access = require('./access.service');
const { notifyUsers, TYPES } = require('./notification.service');
const logger = require('../config/logger');

const POPULATE = [
  { path: 'owner', select: 'name email avatarUrl role' },
  { path: 'members', select: 'name email avatarUrl role' },
  { path: 'team', select: 'name isActive' },
];

const SORTABLE = ['createdAt', 'updatedAt', 'name', 'key', 'startDate', 'endDate', 'status'];

/** Verify every id in a list resolves to a real user, or throw a 400. */
async function assertUsersExist(ids = []) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return [];

  const found = await User.find({ _id: { $in: unique } }).distinct('_id');
  const foundSet = new Set(found.map(String));
  const missing = unique.filter((id) => !foundSet.has(id));

  if (missing.length) {
    throw ApiError.badRequest(`Unknown user id(s): ${missing.join(', ')}`, missing.map((id) => ({ field: 'members', message: `${id} does not exist` })));
  }
  return unique;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Paginated projects with an embedded progress report. */
async function listProjects(user, query = {}) {
  const { page, limit, skip, sort } = getPagination(query, { allowedSort: SORTABLE, defaultSort: '-createdAt' });

  const filter = {};

  if (!isAdmin(user)) {
    // `null` from getVisibleProjectIds means "no restriction".
    const visible = await access.getVisibleProjectIds(user);
    filter._id = { $in: visible };
  }

  if (query.status?.length) filter.status = { $in: query.status };
  if (query.team) filter.team = query.team;
  if (query.owner) filter.owner = query.owner;
  if (query.tags) filter.tags = { $in: String(query.tags).split(',').map((t) => t.trim()).filter(Boolean) };
  if (query.search) filter.$or = searchOr(query.search, ['name', 'key', 'description']);

  const [projects, total] = await Promise.all([
    Project.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    Project.countDocuments(filter),
  ]);

  const progress = await buildProjectProgress(projects.map((p) => p._id));

  const data = projects.map((project) => ({
    ...project.toJSON(),
    progress: progress.get(String(project._id)),
  }));

  return { items: data, meta: buildMeta(page, limit, total) };
}

async function getProject(projectId, user) {
  const project = await Project.findById(projectId).populate(POPULATE);
  if (!project) throw ApiError.notFound('Project');
  access.assertProjectAccess(project, user);

  const [progress, taskCount] = await Promise.all([
    buildSingleProjectProgress(project._id),
    Task.countDocuments({ project: project._id }),
  ]);

  return { ...project.toJSON(), progress, taskCount };
}

async function getProgress(projectId, user) {
  const project = await access.loadProject(projectId);
  access.assertProjectAccess(project, user);

  const progress = await buildSingleProjectProgress(project._id);
  return {
    project: { id: project._id, name: project.name, key: project.key, status: project.status },
    ...progress,
  };
}

/**
 * Gantt data: every task with a definite start / end, its progress and its
 * dependency edges, plus the overall project window.
 */
async function getGantt(projectId, user) {
  const project = await access.loadProject(projectId);
  access.assertProjectAccess(project, user);

  const tasks = await Task.find({ project: project._id })
    .select('title startDate deadline completedAt progress status priority dependencies assignedTo')
    .populate('assignedTo', 'name email')
    .sort('startDate');

  const rows = tasks.map((task) => {
    const start = task.startDate || task.createdAt;
    const end = task.deadline || task.completedAt || start;
    return {
      id: String(task._id),
      title: task.title,
      start,
      end,
      progress: task.progress,
      status: task.status,
      priority: task.priority,
      assignee: task.assignedTo ? task.assignedTo.name : null,
      assigneeId: task.assignedTo ? String(task.assignedTo._id) : null,
      dependencies: (task.dependencies || []).map(String),
      // A task that starts and ends the same day reads better as a milestone.
      isMilestone: new Date(start).toDateString() === new Date(end).toDateString(),
      isOverdue: Boolean(task.deadline && task.status !== 'done' && task.deadline.getTime() < Date.now()),
    };
  });

  const starts = rows.map((r) => new Date(r.start).getTime()).filter(Number.isFinite);
  const ends = rows.map((r) => new Date(r.end).getTime()).filter(Number.isFinite);

  return {
    project: {
      id: String(project._id),
      name: project.name,
      key: project.key,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
    },
    window: {
      start: starts.length ? new Date(Math.min(...starts)) : project.startDate || null,
      end: ends.length ? new Date(Math.max(...ends)) : project.endDate || null,
    },
    taskCount: rows.length,
    tasks: rows,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function createProject(user, payload) {
  const key = String(payload.key).toUpperCase();

  const duplicate = await Project.findOne({ key });
  if (duplicate) throw ApiError.conflict(`Project key '${key}' is already in use`, [{ field: 'key', message: 'Must be unique' }]);

  if (payload.team) await access.loadTeam(payload.team);

  const memberIds = await assertUsersExist(payload.members || []);

  const project = await Project.create({
    ...payload,
    key,
    owner: user._id,
    members: [...new Set([...memberIds, String(user._id)])],
  });

  await project.populate(POPULATE);

  const event = { project: project.toJSON(), actorId: String(user._id), action: 'created' };
  emitToProject(project._id, 'project:updated', event);
  if (project.team) emitToTeam(project.team._id || project.team, 'project:updated', event);

  // Anyone added at creation time should see the project without a reload.
  syncSocketRooms(user._id, { join: [rooms.project(project._id)] });
  project.members.forEach((m) => syncSocketRooms(m._id || m, { join: [rooms.project(project._id)] }));

  if (memberIds.length) {
    await notifyUsers({
      userIds: memberIds,
      type: TYPES.GENERAL,
      title: 'Added to a project',
      body: `You were added to ${project.name}`,
      data: { projectId: String(project._id) },
      excludeUserId: user._id,
    });
  }

  return project;
}

async function updateProject(projectId, user, payload) {
  const project = await access.loadProject(projectId);
  access.assertProjectManage(project, user);

  if (payload.key && String(payload.key).toUpperCase() !== project.key) {
    const key = String(payload.key).toUpperCase();
    const duplicate = await Project.findOne({ key, _id: { $ne: project._id } });
    if (duplicate) throw ApiError.conflict(`Project key '${key}' is already in use`, [{ field: 'key', message: 'Must be unique' }]);
    payload.key = key;
  }

  if (payload.team) await access.loadTeam(payload.team);
  if (payload.members) payload.members = await assertUsersExist(payload.members);

  const before = project.toObject();
  const previousMembers = (before.members || []).map(String);

  Object.entries(payload).forEach(([key, value]) => {
    project[key] = value;
  });
  if (payload.key) project.key = String(payload.key).toUpperCase();

  await project.save();
  await project.populate(POPULATE);

  const after = project.toObject();
  const changes = changedFields(before, Object.fromEntries(Object.keys(payload).map((k) => [k, after[k]])));

  const event = { project: project.toJSON(), changes, actorId: String(user._id) };
  emitToProject(project._id, 'project:updated', event);
  if (project.team) emitToTeam(project.team._id || project.team, 'project:updated', event);

  // Keep live sockets in sync when membership changed in either direction.
  if (payload.members) {
    const currentMembers = (after.members || []).map(String);
    const added = currentMembers.filter((id) => !previousMembers.includes(id));
    const removed = previousMembers.filter((id) => !currentMembers.includes(id));

    added.forEach((id) => syncSocketRooms(id, { join: [rooms.project(project._id)] }));
    removed.forEach((id) => syncSocketRooms(id, { leave: [rooms.project(project._id)] }));

    if (added.length) {
      await notifyUsers({
        userIds: added,
        type: TYPES.GENERAL,
        title: 'Added to a project',
        body: `You were added to ${project.name}`,
        data: { projectId: String(project._id) },
        excludeUserId: user._id,
      });
    }
  }

  return project;
}

/** Delete a project and cascade to its tasks, comments and time entries. */
async function deleteProject(projectId, user) {
  const project = await access.loadProject(projectId);
  access.assertProjectDelete(project, user);

  const taskIds = await Task.find({ project: project._id }).distinct('_id');

  await Promise.all([
    Comment.deleteMany({ task: { $in: taskIds } }),
    TimeEntry.deleteMany({ task: { $in: taskIds } }),
    Task.deleteMany({ project: project._id }),
  ]);

  const teamId = project.team ? String(project.team) : null;
  const memberIds = (project.members || []).map(String);

  await Promise.all([
    Project.deleteOne({ _id: project._id }),
    Team.updateMany({ projects: project._id }, { $pull: { projects: project._id } }),
  ]);

  const event = { projectId: String(project._id), name: project.name, actorId: String(user._id) };
  emitToProject(project._id, 'project:deleted', event);
  if (teamId) emitToTeam(teamId, 'project:deleted', event);

  memberIds.forEach((id) => syncSocketRooms(id, { leave: [rooms.project(project._id)] }));

  logger.info('Project %s deleted by %s — cascaded %d task(s)', project.key, user.email, taskIds.length);
  return { projectId: String(project._id), deletedTasks: taskIds.length };
}

async function addMembers(projectId, user, memberIds) {
  const project = await access.loadProject(projectId);
  access.assertProjectManage(project, user);

  const ids = await assertUsersExist(memberIds);
  const existing = new Set(project.members.map(String));
  const added = ids.filter((id) => !existing.has(id));

  if (!added.length) return { added: [], project };

  project.members.push(...added);
  await project.save();
  await project.populate(POPULATE);

  added.forEach((id) => syncSocketRooms(id, { join: [rooms.project(project._id)] }));

  const event = { project: project.toJSON(), changes: ['members'], actorId: String(user._id) };
  emitToProject(project._id, 'project:updated', event);

  await notifyUsers({
    userIds: added,
    type: TYPES.GENERAL,
    title: 'Added to a project',
    body: `You were added to ${project.name}`,
    data: { projectId: String(project._id) },
    excludeUserId: user._id,
  });

  return { added, project };
}

async function removeMember(projectId, user, memberId) {
  const project = await access.loadProject(projectId);
  access.assertProjectManage(project, user);

  if (sameId(project.owner, memberId)) {
    throw ApiError.badRequest('The project owner cannot be removed from the project');
  }

  const before = project.members.length;
  project.members = project.members.filter((m) => String(m) !== String(memberId));

  if (project.members.length === before) throw ApiError.notFound('Project member');

  await project.save();
  await project.populate(POPULATE);

  syncSocketRooms(memberId, { leave: [rooms.project(project._id)] });
  emitToProject(project._id, 'project:updated', { project: project.toJSON(), changes: ['members'], actorId: String(user._id) });

  // Unassign any tasks that pointed at the removed member.
  await Task.updateMany({ project: project._id, assignedTo: memberId }, { $set: { assignedTo: null } });

  return { removed: String(memberId), project };
}

module.exports = {
  listProjects,
  getProject,
  getProgress,
  getGantt,
  createProject,
  updateProject,
  deleteProject,
  addMembers,
  removeMember,
  assertUsersExist,
  POPULATE,
};
