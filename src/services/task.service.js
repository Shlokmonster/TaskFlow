'use strict';

const { Task, Comment, TimeEntry, User, Project } = require('../models');
const ApiError = require('../utils/ApiError');
const { isAdmin, changedFields, sameId } = require('../utils/rbac');
const { getPagination, buildMeta } = require('../utils/pagination');
const { searchOr } = require('../utils/text');
const { emitToProject, emitToUser, emitToRooms, rooms } = require('../utils/socketRegistry');
const access = require('./access.service');
const { notifyUsers, TYPES } = require('./notification.service');
const logger = require('../config/logger');

const POPULATE = [
  { path: 'project', select: 'name key status owner members' },
  { path: 'assignedTo', select: 'name email avatarUrl role' },
  { path: 'createdBy', select: 'name email avatarUrl role' },
  { path: 'dependencies', select: 'title status progress' },
];

const SORTABLE = ['createdAt', 'updatedAt', 'title', 'deadline', 'startDate', 'priority', 'status', 'progress'];

/** Visible project ids, or throw 403 when a specific project is requested. */
async function resolveProjectScope(user, requestedProjectId) {
  if (requestedProjectId) {
    const project = await access.loadProject(requestedProjectId);
    access.assertProjectAccess(project, user);
    return { project, projectIds: null };
  }
  if (isAdmin(user)) return { project: null, projectIds: null };
  return { project: null, projectIds: await access.getVisibleProjectIds(user) };
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

/**
 * Validate dependency ids and reject cycles.
 *
 * Rules: every dependency must exist, belong to the same project, and adding
 * the edges must not create a loop (checked with a DFS over the project's
 * existing dependency graph).
 */
async function validateDependencies(taskId, dependencyIds = [], projectId) {
  const unique = [...new Set(dependencyIds.map(String))];
  if (!unique.length) return [];

  if (taskId && unique.includes(String(taskId))) {
    throw ApiError.badRequest('A task cannot depend on itself');
  }

  const found = await Task.find({ _id: { $in: unique } }).select('_id project').lean();
  const foundIds = new Set(found.map((t) => String(t._id)));
  const missing = unique.filter((id) => !foundIds.has(id));
  if (missing.length) {
    throw ApiError.badRequest(`Unknown dependency id(s): ${missing.join(', ')}`);
  }

  const foreign = found.filter((t) => String(t.project) !== String(projectId));
  if (foreign.length) {
    throw ApiError.badRequest('Dependencies must belong to the same project as the task');
  }

  if (taskId) {
    // Build `task → its dependencies` for the whole project, then walk the
    // proposed edges looking for a path back to the task itself.
    const all = await Task.find({ project: projectId }).select('dependencies').lean();
    const graph = new Map(all.map((t) => [String(t._id), (t.dependencies || []).map(String)]));
    const start = String(taskId);
    graph.set(start, unique);

    const seen = new Set();
    const stack = [...unique];
    while (stack.length) {
      const node = stack.pop();
      if (node === start) throw ApiError.badRequest('This dependency would create a circular reference');
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...(graph.get(node) || []));
    }
  }

  return unique;
}

/** The assignee must already be a member of the project. */
async function assertAssigneeIsMember(assignedTo, projectId) {
  if (!assignedTo) return null;

  const user = await User.findById(assignedTo);
  if (!user) throw ApiError.badRequest(`Unknown user id: ${assignedTo}`);

  const project = await Project.findById(projectId).select('owner members name').lean();
  const isMember = project && (String(project.owner) === String(assignedTo) || (project.members || []).some((m) => String(m) === String(assignedTo)));

  if (!isMember) {
    throw ApiError.badRequest(`Cannot assign this task: ${user.name} is not a member of the project`);
  }
  return user;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function listTasks(user, query = {}) {
  const { page, limit, skip, sort } = getPagination(query, { allowedSort: SORTABLE, defaultSort: '-createdAt' });
  const { project, projectIds } = await resolveProjectScope(user, query.project);

  const filter = {};
  if (project) filter.project = project._id;
  else if (projectIds) filter.project = { $in: projectIds };

  const assignee = query.assignee || query.assignedTo;
  if (assignee) filter.assignedTo = assignee;
  if (query.mine) filter.assignedTo = user._id;
  if (query.createdBy) filter.createdBy = query.createdBy;
  if (query.status?.length) filter.status = { $in: query.status };
  if (query.priority?.length) filter.priority = { $in: query.priority };

  if (query.dueBefore || query.dueAfter) {
    filter.deadline = {};
    if (query.dueBefore) filter.deadline.$lte = new Date(query.dueBefore);
    if (query.dueAfter) filter.deadline.$gte = new Date(query.dueAfter);
  }

  if (query.overdue) {
    filter.deadline = { ...(filter.deadline || {}), $ne: null, $lt: new Date() };
    filter.status = { $ne: 'done' };
  }

  if (query.tags) {
    filter.tags = { $in: String(query.tags).split(',').map((t) => t.trim()).filter(Boolean) };
  }

  if (query.search) {
    filter.$or = searchOr(query.search, ['title', 'description', 'tags']);
  }

  const [tasks, total] = await Promise.all([
    Task.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    Task.countDocuments(filter),
  ]);

  return { items: tasks.map((t) => t.toJSON()), meta: buildMeta(page, limit, total) };
}

async function getTask(taskId, user) {
  const task = await Task.findById(taskId).populate(POPULATE);
  if (!task) throw ApiError.notFound('Task');

  const project = task.project && task.project._id ? task.project : await access.loadProject(task.project);
  access.assertTaskAccess(task, project, user);

  return task;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function createTask(user, payload) {
  const project = await access.loadProject(payload.project);
  // Creating a task is a project-management action.
  access.assertProjectManage(project, user);

  if (payload.assignedTo) await assertAssigneeIsMember(payload.assignedTo, project._id);

  const dependencies = await validateDependencies(null, payload.dependencies || [], project._id);

  const task = await Task.create({
    ...payload,
    dependencies,
    assignedTo: payload.assignedTo || null,
    createdBy: user._id,
    project: project._id,
    startDate: payload.startDate || new Date(),
  });

  await task.populate(POPULATE);
  const json = task.toJSON();

  emitToProject(project._id, 'task:created', { task: json, actorId: String(user._id) });

  if (task.assignedTo) {
    // Union emit: the assignee's user room, plus the project room for everyone
    // else — a socket in both receives the event exactly once.
    emitToRooms([rooms.user(task.assignedTo._id), rooms.project(project._id)], 'task:assigned', {
      task: json,
      from: null,
      to: json.assignedTo,
      actorId: String(user._id),
    });

    await notifyUsers({
      userIds: [task.assignedTo._id],
      type: TYPES.TASK_ASSIGNED,
      title: 'New task assigned',
      body: `${user.name} assigned you "${task.title}" in ${project.name}`,
      data: { taskId: String(task._id), projectId: String(project._id) },
      excludeUserId: user._id,
    });
  }

  return task;
}

async function updateTask(taskId, user, payload) {
  const task = await Task.findById(taskId);
  if (!task) throw ApiError.notFound('Task');

  const project = await access.loadProject(task.project);
  access.assertTaskAccess(task, project, user);

  const scope = access.resolveTaskWriteScope(task, project, user);

  // A member may only move their own task's status/progress forward.
  if (!scope.full) {
    const attempted = Object.keys(payload).filter((field) => !scope.fields.includes(field));
    if (attempted.length) {
      throw ApiError.forbidden(`You may only change: ${scope.fields.join(', ')}. Rejected field(s): ${attempted.join(', ')}`);
    }
  }

  const before = task.toObject();
  const previousAssignee = task.assignedTo ? String(task.assignedTo) : null;
  const previousDeadline = task.deadline ? task.deadline.getTime() : null;
  const previousStatus = task.status;

  if (payload.project && String(payload.project) !== String(task.project)) {
    throw ApiError.badRequest('A task cannot be moved to a different project');
  }

  if (payload.assignedTo !== undefined && payload.assignedTo) {
    await assertAssigneeIsMember(payload.assignedTo, task.project);
  }

  if (payload.dependencies) {
    payload.dependencies = await validateDependencies(task._id, payload.dependencies, task.project);
  }

  if (payload.deadline && payload.startDate && new Date(payload.deadline) < new Date(payload.startDate)) {
    throw ApiError.badRequest('Deadline must be on or after the start date');
  }
  if (payload.deadline && !payload.startDate && task.startDate && new Date(payload.deadline) < task.startDate) {
    throw ApiError.badRequest('Deadline must be on or after the start date');
  }

  Object.entries(payload).forEach(([key, value]) => {
    if (key === 'project') return; // never reassign a task across projects
    task[key] = value;
  });

  await task.save();
  await task.populate(POPULATE);

  const after = task.toObject();
  const changes = changedFields(
    before,
    Object.fromEntries(Object.keys(payload).filter((k) => k !== 'project').map((k) => [k, after[k]]))
  );

  const json = task.toJSON();
  const assigneeId = task.assignedTo ? String(task.assignedTo._id || task.assignedTo) : null;

  // Broadcast to the project room and the assignee, de-duplicated.
  emitToRooms([rooms.project(project._id), ...(assigneeId ? [rooms.user(assigneeId)] : [])], 'task:updated', {
    task: json,
    changes,
    previousStatus,
    actorId: String(user._id),
  });

  // --- Reassignment --------------------------------------------------------
  if (payload.assignedTo !== undefined && assigneeId !== previousAssignee) {
    emitToRooms([rooms.project(project._id), ...(assigneeId ? [rooms.user(assigneeId)] : []), ...(previousAssignee ? [rooms.user(previousAssignee)] : [])], 'task:assigned', {
      task: json,
      from: previousAssignee,
      to: json.assignedTo,
      actorId: String(user._id),
    });

    if (assigneeId) {
      await notifyUsers({
        userIds: [assigneeId],
        type: TYPES.TASK_ASSIGNED,
        title: previousAssignee ? 'Task reassigned to you' : 'New task assigned',
        body: `${user.name} assigned you "${task.title}" in ${project.name}`,
        data: { taskId: String(task._id), projectId: String(project._id) },
        excludeUserId: user._id,
      });
    }
  }

  // --- Deadline change -----------------------------------------------------
  const newDeadline = task.deadline ? task.deadline.getTime() : null;
  if (payload.deadline !== undefined && newDeadline !== previousDeadline && assigneeId) {
    await notifyUsers({
      userIds: [assigneeId],
      type: TYPES.TASK_DEADLINE_CHANGED,
      title: 'Deadline updated',
      body: task.deadline
        ? `"${task.title}" is now due ${task.deadline.toISOString().slice(0, 10)}`
        : `"${task.title}" no longer has a deadline`,
      data: { taskId: String(task._id), projectId: String(project._id) },
      excludeUserId: user._id,
    });
  }

  logger.debug('Task %s updated by %s — changes: %s', task._id, user.email, changes.join(', ') || 'none');
  return task;
}

async function deleteTask(taskId, user) {
  const task = await Task.findById(taskId);
  if (!task) throw ApiError.notFound('Task');

  const project = await access.loadProject(task.project);
  access.assertProjectManage(project, user);

  await Promise.all([
    Comment.deleteMany({ task: task._id }),
    TimeEntry.deleteMany({ task: task._id }),
    // Detach this task from anything that depended on it.
    Task.updateMany({ dependencies: task._id }, { $pull: { dependencies: task._id } }),
  ]);

  await Task.deleteOne({ _id: task._id });

  emitToProject(project._id, 'task:deleted', {
    taskId: String(task._id),
    projectId: String(project._id),
    actorId: String(user._id),
  });

  return { taskId: String(task._id) };
}

module.exports = {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  validateDependencies,
  assertAssigneeIsMember,
  POPULATE,
};
