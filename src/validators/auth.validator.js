'use strict';

const Joi = require('joi');
const { email, password, fcmToken } = require('./common.validator');

const registerBody = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  email: email.required(),
  password: password.required(),
  firebaseUid: Joi.string().trim().max(128),
  fcmToken,
  avatarUrl: Joi.string().trim().uri().max(500).allow(null, ''),
  // `role` is intentionally NOT accepted here — self-registration always
  // creates a member. Promoting a user is an admin action.
});

const loginBody = Joi.object({
  email: email,
  password: Joi.string().max(72),
  firebaseToken: Joi.string().trim().max(4096),
  fcmToken,
})
  .or('password', 'firebaseToken')
  .with('password', 'email')
  .messages({
    'object.missing': 'Provide either a password (with email) or a Firebase ID token',
    'object.with': 'An email address is required when logging in with a password',
  });

const firebaseBody = Joi.object({
  firebaseToken: Joi.string().trim().max(4096).required(),
  fcmToken,
  name: Joi.string().trim().min(2).max(80),
});

const updateMeBody = Joi.object({
  name: Joi.string().trim().min(2).max(80),
  avatarUrl: Joi.string().trim().uri().max(500).allow(null, ''),
  fcmToken,
}).min(1);

const logoutBody = Joi.object({ fcmToken });

module.exports = { registerBody, loginBody, firebaseBody, updateMeBody, logoutBody };
