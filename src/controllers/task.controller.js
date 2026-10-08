'use strict';

const taskService = require('../services/task.service');
const timeService = require('../services/timeEntry.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await taskService.listTasks(req.user, req.query);
  return paginated(res, items, meta, 'Tasks retrieved');
});

const getOne = asyncHandler(async (req, res) => {
  const task = await taskService.getTask(req.params.id, req.user);
  return ok(res, task.toJSON(), 'Task retrieved');
});

const create = asyncHandler(async (req, res) => {
  const task = await taskService.createTask(req.user, req.body);
  return created(res, task.toJSON(), 'Task created');
});

const update = asyncHandler(async (req, res) => {
  const task = await taskService.updateTask(req.params.id, req.user, req.body);
  return ok(res, task.toJSON(), 'Task updated');
});

const remove = asyncHandler(async (req, res) => {
  const result = await taskService.deleteTask(req.params.id, req.user);
  return ok(res, result, 'Task deleted');
});

const startTime = asyncHandler(async (req, res) => {
  const entry = await timeService.startTimer(req.params.id, req.user, req.body);
  return created(res, entry.toJSON(), 'Timer started');
});

const stopTime = asyncHandler(async (req, res) => {
  const entry = await timeService.stopTimer(req.params.id, req.user, req.body);
  return ok(res, entry.toJSON(), 'Timer stopped');
});

const getTime = asyncHandler(async (req, res) => {
  const report = await timeService.getTaskTime(req.params.id, req.user, req.query);
  // `totals` and the caller's live `running` timer ride along in `meta` so the
  // paginated envelope stays intact.
  return res.status(200).json({
    success: true,
    message: 'Time entries retrieved',
    data: report.items,
    meta: { ...report.meta, totals: report.totals, running: report.running },
  });
});

module.exports = { list, getOne, create, update, remove, startTime, stopTime, getTime };
