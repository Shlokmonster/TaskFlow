'use strict';

const Task = require('../models/task.model');

const EMPTY_PROGRESS = Object.freeze({
  totalTasks: 0,
  completed: 0,
  inProgress: 0,
  review: 0,
  todo: 0,
  overdue: 0,
  completionPercentage: 0,
  averageProgress: 0,
  byPriority: { low: 0, medium: 0, high: 0, critical: 0 },
});

const round = (value, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
};

/** Turn one aggregation row into the public progress shape. */
function toProgress(row) {
  if (!row) return { ...EMPTY_PROGRESS, byPriority: { ...EMPTY_PROGRESS.byPriority } };
  const total = row.totalTasks || 0;
  return {
    totalTasks: total,
    completed: row.completed || 0,
    inProgress: row.inProgress || 0,
    review: row.review || 0,
    todo: row.todo || 0,
    // A task with no deadline is never overdue — note the explicit null guard,
    // MongoDB's BSON ordering would otherwise sort null *before* every date.
    overdue: row.overdue || 0,
    completionPercentage: total ? round(((row.completed || 0) / total) * 100) : 0,
    averageProgress: round(row.averageProgress),
    byPriority: {
      low: row.low || 0,
      medium: row.medium || 0,
      high: row.high || 0,
      critical: row.critical || 0,
    },
  };
}

/**
 * Progress report for a set of projects in a single aggregation.
 *
 * @param {Array<string|import('mongoose').Types.ObjectId>} projectIds
 * @param {{ now?: Date }} [options]
 * @returns {Promise<Map<string, object>>} projectId → progress
 */
async function buildProjectProgress(projectIds = [], { now = new Date() } = {}) {
  const ids = projectIds.filter(Boolean);
  const result = new Map(ids.map((id) => [String(id), toProgress(null)]));
  if (!ids.length) return result;

  const statusCount = (status) => ({ $cond: [{ $eq: ['$status', status] }, 1, 0] });

  const rows = await Task.aggregate([
    { $match: { project: { $in: ids } } },
    {
      $group: {
        _id: '$project',
        totalTasks: { $sum: 1 },
        completed: { $sum: statusCount('done') },
        inProgress: { $sum: statusCount('in-progress') },
        review: { $sum: statusCount('review') },
        todo: { $sum: statusCount('todo') },
        overdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$deadline', null] },
                  { $lt: ['$deadline', now] },
                  { $ne: ['$status', 'done'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        averageProgress: { $avg: '$progress' },
        low: { $sum: { $cond: [{ $eq: ['$priority', 'low'] }, 1, 0] } },
        medium: { $sum: { $cond: [{ $eq: ['$priority', 'medium'] }, 1, 0] } },
        high: { $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] } },
        critical: { $sum: { $cond: [{ $eq: ['$priority', 'critical'] }, 1, 0] } },
      },
    },
  ]);

  rows.forEach((row) => result.set(String(row._id), toProgress(row)));
  return result;
}

/** Progress report for a single project. */
async function buildSingleProjectProgress(projectId) {
  const map = await buildProjectProgress([projectId]);
  return map.get(String(projectId)) || toProgress(null);
}

module.exports = { buildProjectProgress, buildSingleProjectProgress, toProgress, EMPTY_PROGRESS };
