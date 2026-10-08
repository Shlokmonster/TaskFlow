'use strict';

const adminService = require('../services/admin.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, paginated } = require('../utils/ApiResponse');

const listUsers = asyncHandler(async (req, res) => {
  const { items, meta } = await adminService.listUsers(req.query);
  return paginated(res, items, meta, 'Users retrieved');
});

const getUser = asyncHandler(async (req, res) => {
  const user = await adminService.getUser(req.params.id);
  return ok(res, user.toJSON(), 'User retrieved');
});

const listProjects = asyncHandler(async (req, res) => {
  const { items, meta } = await adminService.listProjects(req.query);
  return paginated(res, items, meta, 'Projects retrieved');
});

const updateUserRole = asyncHandler(async (req, res) => {
  const result = await adminService.updateUserRole(req.params.id, req.user, req.body.role);
  return ok(res, result, `Role updated to ${req.body.role}`);
});

const updateUserStatus = asyncHandler(async (req, res) => {
  const user = await adminService.updateUserStatus(req.params.id, req.user, req.body.isActive);
  return ok(res, user.toJSON(), user.isActive ? 'Account activated' : 'Account deactivated');
});

const stats = asyncHandler(async (_req, res) => {
  const [summary, roles] = await Promise.all([adminService.getStats(), adminService.listRoles()]);
  return ok(res, { ...summary, roles }, 'Platform statistics');
});

module.exports = { listUsers, getUser, listProjects, updateUserRole, updateUserStatus, stats };
