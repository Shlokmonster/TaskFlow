'use strict';

const Joi = require('joi');
const { objectId, paginationFields, csvEnum, search, date } = require('./common.validator');

const STATUSES = ['todo', 'in-progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

const createTaskBody = Joi.object({
  title: Joi.string().trim().min(3).max(160).required(),
  description: Joi.string().trim().max(5000).allow(''),
  project: objectId.required(),
  assignedTo: objectId.allow(null),
  status: Joi.string().valid(...STATUSES).default('todo'),
  priority: Joi.string().valid(...PRIORITIES).default('medium'),
  startDate: date,
  deadline: date.allow(null),
  progress: Joi.number().integer().min(0).max(100),
  dependencies: Joi.array().items(objectId).max(50).default([]),
  tags: Joi.array().items(Joi.string().trim().max(40)).max(20).default([]),
  estimatedHours: Joi.number().min(0).max(10000).allow(null),
}).custom((value, helpers) => {
  if (value.deadline && value.startDate && new Date(value.deadline) < new Date(value.startDate)) {
    return helpers.message({ custom: 'deadline must be on or after startDate' });
  }
  return value;
});

const updateTaskBody = Joi.object({
  title: Joi.string().trim().min(3).max(160),
  description: Joi.string().trim().max(5000).allow(''),
  project: objectId,
  assignedTo: objectId.allow(null),
  status: Joi.string().valid(...STATUSES),
  priority: Joi.string().valid(...PRIORITIES),
  startDate: date,
  deadline: date.allow(null),
  progress: Joi.number().integer().min(0).max(100),
  dependencies: Joi.array().items(objectId).max(50),
  tags: Joi.array().items(Joi.string().trim().max(40)).max(20),
  estimatedHours: Joi.number().min(0).max(10000).allow(null),
}).min(1);

const listTasksQuery = Joi.object({
  ...paginationFields,
  project: objectId,
  assignee: objectId,
  assignedTo: objectId,
  createdBy: objectId,
  status: csvEnum(STATUSES),
  priority: csvEnum(PRIORITIES),
  dueBefore: date,
  dueAfter: date,
  tags: Joi.string().trim().max(200),
  search,
  mine: Joi.boolean().truthy('true', '1').falsy('false', '0'),
  overdue: Joi.boolean().truthy('true', '1').falsy('false', '0'),
  sort: Joi.string().trim().max(120),
});

const startTimerBody = Joi.object({ note: Joi.string().trim().max(500).allow('') });

const stopTimerBody = Joi.object({ note: Joi.string().trim().max(500).allow('') });

const timeSummaryQuery = Joi.object({
  ...paginationFields,
  task: objectId,
  user: objectId,
  from: date,
  to: date,
  groupBy: Joi.string().valid('task', 'user').default('user'),
});

module.exports = {
  createTaskBody,
  updateTaskBody,
  listTasksQuery,
  startTimerBody,
  stopTimerBody,
  timeSummaryQuery,
  STATUSES,
  PRIORITIES,
};
