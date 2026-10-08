'use strict';

const Joi = require('joi');
const { objectId, paginationFields, csvEnum, search, date } = require('./common.validator');

const STATUSES = ['planning', 'active', 'on-hold', 'completed', 'archived'];

const createProjectBody = Joi.object({
  name: Joi.string().trim().min(3).max(120).required(),
  key: Joi.string().trim().uppercase().min(2).max(10).pattern(/^[A-Za-z0-9]+$/).required(),
  description: Joi.string().trim().max(2000).allow(''),
  status: Joi.string().valid(...STATUSES).default('planning'),
  team: objectId.allow(null),
  members: Joi.array().items(objectId).max(200).default([]),
  startDate: date,
  endDate: date.allow(null),
  tags: Joi.array().items(Joi.string().trim().max(40)).max(20).default([]),
}).custom((value, helpers) => {
  if (value.endDate && value.startDate && new Date(value.endDate) < new Date(value.startDate)) {
    return helpers.message({ custom: 'endDate must be on or after startDate' });
  }
  return value;
});

const updateProjectBody = Joi.object({
  name: Joi.string().trim().min(3).max(120),
  key: Joi.string().trim().uppercase().min(2).max(10).pattern(/^[A-Za-z0-9]+$/),
  description: Joi.string().trim().max(2000).allow(''),
  status: Joi.string().valid(...STATUSES),
  team: objectId.allow(null),
  members: Joi.array().items(objectId).max(200),
  startDate: date,
  endDate: date.allow(null),
  tags: Joi.array().items(Joi.string().trim().max(40)).max(20),
}).min(1);

const listProjectsQuery = Joi.object({
  ...paginationFields,
  status: csvEnum(STATUSES),
  team: objectId,
  owner: objectId,
  search,
  tags: Joi.string().trim().max(200),
  sort: Joi.string().trim().max(120),
});

const addMembersBody = Joi.object({
  members: Joi.array().items(objectId).min(1).max(50).required(),
});

module.exports = { createProjectBody, updateProjectBody, listProjectsQuery, addMembersBody, STATUSES };
