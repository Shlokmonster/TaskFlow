'use strict';

const projectService = require('../services/project.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await projectService.listProjects(req.user, req.query);
  return paginated(res, items, meta, 'Projects retrieved');
});

const getOne = asyncHandler(async (req, res) => {
  const project = await projectService.getProject(req.params.id, req.user);
  return ok(res, project, 'Project retrieved');
});

const create = asyncHandler(async (req, res) => {
  const project = await projectService.createProject(req.user, req.body);
  return created(res, project.toJSON(), 'Project created');
});

const update = asyncHandler(async (req, res) => {
  const project = await projectService.updateProject(req.params.id, req.user, req.body);
  return ok(res, project.toJSON(), 'Project updated');
});

const remove = asyncHandler(async (req, res) => {
  const result = await projectService.deleteProject(req.params.id, req.user);
  return ok(res, result, 'Project deleted');
});

const addMembers = asyncHandler(async (req, res) => {
  const { added, project } = await projectService.addMembers(req.params.id, req.user, req.body.members);
  return ok(res, { added, project: project.toJSON() }, `${added.length} member(s) added`);
});

const removeMember = asyncHandler(async (req, res) => {
  const { project } = await projectService.removeMember(req.params.id, req.user, req.params.userId);
  return ok(res, project.toJSON(), 'Member removed');
});

const progress = asyncHandler(async (req, res) => {
  const report = await projectService.getProgress(req.params.id, req.user);
  return ok(res, report, 'Progress report retrieved');
});

const gantt = asyncHandler(async (req, res) => {
  const data = await projectService.getGantt(req.params.id, req.user);
  return ok(res, data, 'Gantt data retrieved');
});

module.exports = { list, getOne, create, update, remove, addMembers, removeMember, progress, gantt };
