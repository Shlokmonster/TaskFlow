'use strict';

/**
 * Resource-level access control.
 *
 * Roles alone are never enough: a `lead` may only touch projects they belong
 * to and a `member` may only touch tasks assigned to them. Every service that
 * mutates a resource funnels through these helpers so the rule lives in one
 * place.
 */

const { Project, Team } = require('../models');
const ApiError = require('../utils/ApiError');
const { isAdmin, isLead, isProjectMember, isProjectOwner, isTeamMember, isTeamLead, sameId, MEMBER_TASK_EDITABLE_FIELDS } = require('../utils/rbac');

/** Load a project or throw 404. */
async function loadProject(projectId) {
  const project = await Project.findById(projectId);
  if (!project) throw ApiError.notFound('Project');
  return project;
}

async function loadTeam(teamId) {
  const team = await Team.findById(teamId);
  if (!team) throw ApiError.notFound('Team');
  return team;
}

/**
 * Can this user see the project at all?
 * admin → always · owner/member → yes · otherwise no.
 */
function assertProjectAccess(project, user) {
  if (isAdmin(user)) return true;
  if (isProjectMember(project, user)) return true;
  throw ApiError.forbidden('You do not have access to this project');
}

/**
 * Can this user modify the project, its tasks and its membership?
 * admin → always · owner → yes · lead who is a member → yes.
 */
function assertProjectManage(project, user) {
  if (isAdmin(user)) return true;
  if (isProjectOwner(project, user)) return true;
  if (isLead(user) && isProjectMember(project, user)) return true;
  throw ApiError.forbidden('Only the project owner, a project lead or an admin can perform this action');
}

/** Deleting a project is narrower: the owner or an admin. */
function assertProjectDelete(project, user) {
  if (isAdmin(user)) return true;
  if (isProjectOwner(project, user)) return true;
  throw ApiError.forbidden('Only the project owner or an admin can delete a project');
}

/**
 * Project ids this user may read. `null` means "no restriction" (admin).
 * Team membership grants visibility of the projects linked to that team.
 */
async function getVisibleProjectIds(user) {
  if (isAdmin(user)) return null;

  const teamIds = await Team.find({
    $or: [{ lead: user._id }, { 'members.user': user._id }],
  }).distinct('_id');

  return Project.find({
    $or: [{ owner: user._id }, { members: user._id }, { team: { $in: teamIds } }],
  }).distinct('_id');
}

/** Can this user read the task? (assignee, project member or admin) */
function assertTaskAccess(task, project, user) {
  if (isAdmin(user)) return true;
  if (sameId(task.assignedTo, user)) return true;
  if (isProjectMember(project, user)) return true;
  throw ApiError.forbidden('You do not have access to this task');
}

/**
 * What may this user change on the task?
 *
 * @returns {{ full: boolean, fields: string[]|null }} `fields: null` means all.
 */
function resolveTaskWriteScope(task, project, user) {
  if (isAdmin(user)) return { full: true, fields: null };
  if (isLead(user) && isProjectMember(project, user)) return { full: true, fields: null };
  if (sameId(task.assignedTo, user)) return { full: false, fields: [...MEMBER_TASK_EDITABLE_FIELDS] };
  throw ApiError.forbidden('You can only update tasks that are assigned to you');
}

function assertTeamAccess(team, user) {
  if (isAdmin(user)) return true;
  if (isTeamMember(team, user)) return true;
  throw ApiError.forbidden('You do not have access to this team');
}

function assertTeamManage(team, user) {
  if (isAdmin(user)) return true;
  if (isTeamLead(team, user)) return true;
  throw ApiError.forbidden('Only the team lead or an admin can perform this action');
}

/** Users referenced by a task that should hear about changes to it. */
function taskAudience(task) {
  return [task.assignedTo, task.createdBy].filter(Boolean).map(String);
}

module.exports = {
  loadProject,
  loadTeam,
  assertProjectAccess,
  assertProjectManage,
  assertProjectDelete,
  getVisibleProjectIds,
  assertTaskAccess,
  resolveTaskWriteScope,
  assertTeamAccess,
  assertTeamManage,
  taskAudience,
};
