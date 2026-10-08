'use strict';

const { User, Project, Task, Team, Comment } = require('../models');
const ApiError = require('../utils/ApiError');
const { sameId } = require('../utils/rbac');
const { getPagination, buildMeta } = require('../utils/pagination');
const { searchOr } = require('../utils/text');
const { buildProjectProgress } = require('../utils/projectProgress');
const logger = require('../config/logger');

const PUBLIC_USER_FIELDS = 'name email role avatarUrl isActive lastLoginAt createdAt updatedAt';

async function listUsers(query = {}) {
  const { page, limit, skip, sort } = getPagination(query, {
    allowedSort: ['createdAt', 'updatedAt', 'name', 'email', 'role', 'lastLoginAt'],
    defaultSort: '-createdAt',
  });

  const filter = {};
  if (query.role?.length) filter.role = { $in: [].concat(query.role) };
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) filter.$or = searchOr(query.search, ['name', 'email']);

  const [users, total] = await Promise.all([
    // `password` is select:false, and the explicit projection keeps it that way.
    User.find(filter).select(PUBLIC_USER_FIELDS).sort(sort).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  return { items: users.map((u) => u.toJSON()), meta: buildMeta(page, limit, total) };
}

async function listProjects(query = {}) {
  const { page, limit, skip, sort } = getPagination(query, {
    allowedSort: ['createdAt', 'updatedAt', 'name', 'status', 'endDate'],
    defaultSort: '-createdAt',
  });

  const filter = {};
  if (query.status) filter.status = { $in: [].concat(query.status) };
  if (query.search) filter.$or = searchOr(query.search, ['name', 'key', 'description']);

  const [projects, total] = await Promise.all([
    Project.find(filter)
      .populate([
        { path: 'owner', select: 'name email role' },
        { path: 'members', select: 'name email role' },
        { path: 'team', select: 'name' },
      ])
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Project.countDocuments(filter),
  ]);

  const progress = await buildProjectProgress(projects.map((p) => p._id));

  return {
    items: projects.map((p) => ({ ...p.toJSON(), progress: progress.get(String(p._id)) })),
    meta: buildMeta(page, limit, total),
  };
}

async function getUser(userId) {
  const user = await User.findById(userId).select(PUBLIC_USER_FIELDS);
  if (!user) throw ApiError.notFound('User');
  return user;
}

/** Count active admins so the last one cannot be demoted or deactivated. */
async function countActiveAdmins(excludingUserId = null) {
  const filter = { role: 'admin', isActive: true };
  if (excludingUserId) filter._id = { $ne: excludingUserId };
  return User.countDocuments(filter);
}

async function updateUserRole(userId, actor, role) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User');

  if (sameId(user._id, actor._id)) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  if (user.role === 'admin' && role !== 'admin') {
    const remaining = await countActiveAdmins(user._id);
    if (remaining === 0) throw ApiError.badRequest('The last remaining admin cannot be demoted');
  }

  const previous = user.role;
  user.role = role;
  await user.save();

  logger.info('Role changed: %s %s → %s (by %s)', user.email, previous, role, actor.email);
  return { user: user.toJSON(), previousRole: previous };
}

async function updateUserStatus(userId, actor, isActive) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User');

  if (sameId(user._id, actor._id)) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }

  if (!isActive && user.role === 'admin') {
    const remaining = await countActiveAdmins(user._id);
    if (remaining === 0) throw ApiError.badRequest('The last remaining admin cannot be deactivated');
  }

  user.isActive = isActive;
  await user.save();

  logger.info('Account %s %s (by %s)', user.email, isActive ? 'activated' : 'deactivated', actor.email);
  return user;
}

async function getStats() {
  const now = new Date();

  const [users, activeUsers, projects, teams, comments, tasksByStatus, overdue, unassigned] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true }),
    Project.countDocuments(),
    Team.countDocuments(),
    Comment.countDocuments(),
    Task.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Task.countDocuments({ deadline: { $ne: null, $lt: now }, status: { $ne: 'done' } }),
    Task.countDocuments({ assignedTo: null }),
  ]);

  const tasks = { todo: 0, 'in-progress': 0, review: 0, done: 0 };
  tasksByStatus.forEach((row) => {
    if (row._id in tasks) tasks[row._id] = row.count;
  });

  const totalTasks = Object.values(tasks).reduce((sum, n) => sum + n, 0);

  return {
    users: { total: users, active: activeUsers, inactive: users - activeUsers },
    projects: { total: projects },
    teams: { total: teams },
    comments: { total: comments },
    tasks: {
      total: totalTasks,
      byStatus: tasks,
      overdue,
      unassigned,
      completionPercentage: totalTasks ? Math.round((tasks.done / totalTasks) * 1000) / 10 : 0,
    },
  };
}

async function listRoles() {
  const rows = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);
  return rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
}

module.exports = { listUsers, listProjects, getUser, updateUserRole, updateUserStatus, getStats, listRoles };
