'use strict';

const Joi = require('joi');

/** A 24-character hex Mongo ObjectId. */
const objectId = Joi.string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/)
  .messages({ 'string.pattern.base': '{{#label}} must be a valid id' });

const idParam = Joi.object({ id: objectId.required().label('id') });

const paginationFields = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string().trim().max(120),
};

/** Comma separated `?status=todo,done` → ['todo','done'] */
const csvEnum = (values) =>
  Joi.string()
    .trim()
    .custom((value) => {
      const list = [...new Set(String(value).split(',').map((v) => v.trim()).filter(Boolean))];
      const invalid = list.filter((v) => !values.includes(v));
      if (invalid.length) throw new Error(`contains unsupported value(s): ${invalid.join(', ')}`);
      return list;
    }, 'comma separated enum');

const csvObjectIds = Joi.string()
  .trim()
  .custom((value) => {
    const list = [...new Set(String(value).split(',').map((v) => v.trim()).filter(Boolean))];
    const invalid = list.filter((v) => !/^[0-9a-fA-F]{24}$/.test(v));
    if (invalid.length) throw new Error(`contains invalid id(s): ${invalid.join(', ')}`);
    return list;
  }, 'comma separated object ids');

const search = Joi.string().trim().min(1).max(120);

const password = Joi.string()
  .min(8)
  .max(72) // bcrypt silently truncates beyond 72 bytes
  .messages({ 'string.min': 'Password must be at least 8 characters', 'string.max': 'Password must be at most 72 characters' });

const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(200);

const fcmToken = Joi.string().trim().max(4096);

const date = Joi.date().iso();

module.exports = { objectId, idParam, paginationFields, csvEnum, csvObjectIds, search, password, email, fcmToken, date };
