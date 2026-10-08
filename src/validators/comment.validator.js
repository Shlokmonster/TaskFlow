'use strict';

const Joi = require('joi');
const { objectId, paginationFields } = require('./common.validator');

const createCommentBody = Joi.object({
  task: objectId.required(),
  body: Joi.string().trim().min(1).max(2000).required(),
  parent: objectId.allow(null),
  // Explicit mentions are validated against project membership in the service.
  mentions: Joi.array().items(objectId).max(20).default([]),
});

const updateCommentBody = Joi.object({
  body: Joi.string().trim().min(1).max(2000).required(),
});

const listCommentsQuery = Joi.object({
  ...paginationFields,
  task: objectId,
  author: objectId,
  parent: objectId.allow(null),
  sort: Joi.string().trim().max(120),
});

module.exports = { createCommentBody, updateCommentBody, listCommentsQuery };
