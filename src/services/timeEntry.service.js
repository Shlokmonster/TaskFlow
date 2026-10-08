'use strict';

const mongoose = require('mongoose');

const { TimeEntry, Task } = require('../models');
const ApiError = require('../utils/ApiError');
const { isAdmin } = require('../utils/rbac');
const { getPagination, buildMeta } = require('../utils/pagination');
const { emitToRooms, rooms } = require('../utils/socketRegistry');
const access = require('./access.service');

const POPULATE = [{ path: 'user', select: 'name email avatarUrl' }];

/** Timers are personal: only the owner (or an admin) sees them. */
function assertTimerOwnership(entry, user) {
  if (isAdmin(user)) return true;
  if (String(entry.user) !== String(user._id)) {
    throw ApiError.forbidden('You can only manage your own time entries');
  }
  return true;
}

async function loadTaskWithAccess(taskId, user) {
  const task = await Task.findById(taskId);
  if (!task) throw ApiError.notFound('Task');
  const project = await access.loadProject(task.project);
  access.assertTaskAccess(task, project, user);
  return { task, project };
}

/** Start a timer. A user may only have one running at a time. */
async function startTimer(taskId, user, { note = '' } = {}) {
  const { task, project } = await loadTaskWithAccess(taskId, user);

  const running = await TimeEntry.findOne({ user: user._id, endedAt: null });
  if (running) {
    if (String(running.task) === String(task._id)) {
      throw ApiError.conflict('A timer is already running for this task');
    }
    throw ApiError.conflict('You already have a running timer — stop it before starting another');
  }

  const entry = await TimeEntry.create({
    task: task._id,
    user: user._id,
    startedAt: new Date(),
    endedAt: null,
    note,
  });

  await entry.populate(POPULATE);

  emitToRooms([rooms.project(project._id), rooms.user(user._id)], 'time:started', {
    entry: entry.toJSON(),
    taskId: String(task._id),
    userId: String(user._id),
  });

  return entry;
}

/** Stop the caller's running timer on this task. */
async function stopTimer(taskId, user, { note } = {}) {
  const { task, project } = await loadTaskWithAccess(taskId, user);

  const entry = await TimeEntry.findOne({ task: task._id, user: user._id, endedAt: null });
  if (!entry) throw ApiError.notFound('Running timer');

  entry.endedAt = new Date();
  entry.durationSeconds = Math.max(0, Math.round((entry.endedAt.getTime() - entry.startedAt.getTime()) / 1000));
  if (note) entry.note = note;

  await entry.save();
  await entry.populate(POPULATE);

  emitToRooms([rooms.project(project._id), rooms.user(user._id)], 'time:stopped', {
    entry: entry.toJSON(),
    taskId: String(task._id),
    userId: String(user._id),
  });

  return entry;
}

/** Entries for one task plus per-user totals. */
async function getTaskTime(taskId, user, query = {}) {
  const { task } = await loadTaskWithAccess(taskId, user);

  const { page, limit, skip, sort } = getPagination(query, {
    allowedSort: ['startedAt', 'durationSeconds'],
    defaultSort: '-startedAt',
  });

  // A member only ever sees their own entries; a lead sees everyone's.
  const entryFilter = { task: task._id };
  if (!isAdmin(user) && user.role === 'member') entryFilter.user = user._id;
  if (query.user && (isAdmin(user) || user.role === 'lead')) entryFilter.user = query.user;

  if (query.from || query.to) {
    entryFilter.startedAt = {};
    if (query.from) entryFilter.startedAt.$gte = new Date(query.from);
    if (query.to) entryFilter.startedAt.$lte = new Date(query.to);
  }

  const [entries, total, totals] = await Promise.all([
    TimeEntry.find(entryFilter).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    TimeEntry.countDocuments(entryFilter),
    TimeEntry.aggregate([
      { $match: { ...entryFilter, task: task._id, endedAt: { $ne: null } } },
      { $group: { _id: '$user', totalSeconds: { $sum: '$durationSeconds' }, entries: { $sum: 1 } } },
    ]),
  ]);

  const running = await TimeEntry.findOne({ task: task._id, user: user._id, endedAt: null });

  return {
    items: entries.map((e) => e.toJSON()),
    meta: buildMeta(page, limit, total),
    totals: {
      totalSeconds: totals.reduce((sum, row) => sum + row.totalSeconds, 0),
      perUser: totals.map((row) => ({ userId: String(row._id), totalSeconds: row.totalSeconds, entries: row.entries })),
    },
    running: running ? running.toJSON() : null,
  };
}

/**
 * Totals grouped by user (default) or by task, scoped to what the caller may
 * see: a member sees their own time, a lead sees their projects, an admin sees
 * everything.
 */
async function getSummary(user, query = {}) {
  const { page, limit, skip, sort } = getPagination(query, {
    allowedSort: ['totalSeconds'],
    defaultSort: '-startedAt',
  });

  const match = { endedAt: { $ne: null } };

  if (query.task) match.task = new mongoose.Types.ObjectId(String(query.task));
  if (query.user) match.user = new mongoose.Types.ObjectId(String(query.user));

  if (!isAdmin(user)) {
    if (user.role === 'lead') {
      const projectIds = await access.getVisibleProjectIds(user);
      const taskIds = await Task.find({ project: { $in: projectIds } }).distinct('_id');
      match.task = query.task ? match.task : { $in: taskIds };
      if (query.task && !taskIds.map(String).includes(String(query.task))) {
        throw ApiError.forbidden('You do not have access to this task');
      }
    } else if (!query.user || String(query.user) !== String(user._id)) {
      match.user = user._id;
    }
  }

  if (query.from || query.to) {
    match.startedAt = {};
    if (query.from) match.startedAt.$gte = new Date(query.from);
    if (query.to) match.startedAt.$lte = new Date(query.to);
  }

  const groupBy = query.groupBy === 'task' ? 'task' : 'user';
  const bucket = groupBy === 'task' ? '$task' : '$user';

  const [rows, totals] = await Promise.all([
    TimeEntry.aggregate([
      { $match: match },
      { $group: { _id: bucket, totalSeconds: { $sum: '$durationSeconds' }, entries: { $sum: 1 }, lastStartedAt: { $max: '$startedAt' } } },
      { $sort: groupBy === 'task' ? { totalSeconds: -1 } : { totalSeconds: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: groupBy === 'task' ? 'tasks' : 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'ref',
          pipeline: [{ $project: groupBy === 'task' ? { title: 1, project: 1 } : { name: 1, email: 1 } }],
        },
      },
    ]),
    TimeEntry.aggregate([{ $match: match }, { $group: { _id: null, totalSeconds: { $sum: '$durationSeconds' }, entries: { $sum: 1 } } }]),
  ]);

  const grand = totals[0] || { totalSeconds: 0, entries: 0 };

  return {
    groupBy,
    items: rows.map((row) => ({
      id: String(row._id),
      label: row.ref?.[0]?.title || row.ref?.[0]?.name || String(row._id),
      email: row.ref?.[0]?.email || null,
      totalSeconds: row.totalSeconds,
      totalHours: Math.round((row.totalSeconds / 3600) * 100) / 100,
      entries: row.entries,
      lastStartedAt: row.lastStartedAt,
    })),
    meta: buildMeta(page, limit, grand.entries),
    totals: { totalSeconds: grand.totalSeconds, totalHours: Math.round((grand.totalSeconds / 3600) * 100) / 100 },
  };
}

module.exports = { startTimer, stopTimer, getTaskTime, getSummary, assertTimerOwnership };
