'use strict';

const Joi = require('joi');
const { objectId, paginationFields, search } = require('./common.validator');

const teamMember = Joi.object({
  user: objectId.required(),
  role: Joi.string().valid('member', 'lead').default('member'),
});

const createTeamBody = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  description: Joi.string().trim().max(1000).allow(''),
  lead: objectId,
  members: Joi.array().items(teamMember).max(100).default([]),
  projects: Joi.array().items(objectId).max(100).default([]),
});

const updateTeamBody = Joi.object({
  name: Joi.string().trim().min(2).max(80),
  description: Joi.string().trim().max(1000).allow(''),
  lead: objectId,
  members: Joi.array().items(teamMember).max(100),
  projects: Joi.array().items(objectId).max(100),
  isActive: Joi.boolean(),
}).min(1);

const listTeamsQuery = Joi.object({
  ...paginationFields,
  search,
  isActive: Joi.boolean().truthy('true', '1').falsy('false', '0'),
  sort: Joi.string().trim().max(120),
});

module.exports = { createTeamBody, updateTeamBody, listTeamsQuery };
