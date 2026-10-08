'use strict';

const teamService = require('../services/team.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await teamService.listTeams(req.user, req.query);
  return paginated(res, items, meta, 'Teams retrieved');
});

const getOne = asyncHandler(async (req, res) => {
  const team = await teamService.getTeam(req.params.id, req.user);
  return ok(res, team.toJSON(), 'Team retrieved');
});

const create = asyncHandler(async (req, res) => {
  const team = await teamService.createTeam(req.user, req.body);
  return created(res, team.toJSON(), 'Team created');
});

const update = asyncHandler(async (req, res) => {
  const team = await teamService.updateTeam(req.params.id, req.user, req.body);
  return ok(res, team.toJSON(), 'Team updated');
});

const remove = asyncHandler(async (req, res) => {
  const result = await teamService.deleteTeam(req.params.id, req.user);
  return ok(res, result, 'Team deleted');
});

module.exports = { list, getOne, create, update, remove };
