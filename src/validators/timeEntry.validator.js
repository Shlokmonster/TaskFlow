'use strict';

const Joi = require('joi');
const { objectId, paginationFields, date } = require('./common.validator');

const taskTimeQuery = Joi.object({
  ...paginationFields,
  user: objectId,
  from: date,
  to: date,
});

module.exports = { taskTimeQuery };
