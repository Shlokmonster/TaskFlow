'use strict';

const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/ApiResponse');

const register = asyncHandler(async (req, res) => {
  const session = await authService.register(req.body);
  return created(res, session, 'Account created successfully');
});

const login = asyncHandler(async (req, res) => {
  const session = await authService.login(req.body);
  return ok(res, session, 'Logged in successfully');
});

/** Firebase-only entry point — mirrors /login with a Firebase ID token. */
const loginWithFirebase = asyncHandler(async (req, res) => {
  const session = await authService.loginWithFirebase(req.body);
  return ok(res, session, 'Logged in successfully');
});

const me = asyncHandler(async (req, res) => ok(res, req.user.toJSON(), 'Current user'));

const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateMe(req.user._id, req.body);
  return ok(res, user.toJSON(), 'Profile updated');
});

const logout = asyncHandler(async (req, res) => {
  const result = await authService.logout(req.user._id, req.body.fcmToken);
  return ok(res, result, 'Logged out');
});

module.exports = { register, login, loginWithFirebase, me, updateMe, logout };
