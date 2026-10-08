'use strict';

const { Comment, Task, Project, User } = require('../models');
const ApiError = require('../utils/ApiError');
const { isAdmin, isLead, sameId } = require('../utils/rbac');
const { getPagination, buildMeta } = require('../utils/pagination');
const { emitToRooms, rooms } = require('../utils/socketRegistry');
const access = require('./access.service');
const { notifyUsers, TYPES } = require('./notification.service');

const POPULATE = [{ path: 'author', select: 'name email avatarUrl role' }, { path: 'mentions', select: 'name email' }];

const SORTABLE = ['createdAt', 'updatedAt'];
const MENTION_REGEX = /@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/**
 * Resolve the people a comment notifies.
 *
 * Two sources: an explicit `mentions` array (must be project members) and any
 * `@email` written in the body that matches a project member.
 */
async function resolveMentions(explicitIds = [], body = '', projectId) {
  const candidates = new Set(explicitIds.map(String));

  const emailMatches = [...String(body).matchAll(MENTION_REGEX)].map((m) => m[1].toLowerCase());
  if (emailMatches.length) {
    const users = await User.find({ email: { $in: emailMatches } }).select('_id').lean();
    users.forEach((u) => candidates.add(String(u._id)));
  }

  if (!candidates.size) return [];

  const project = await Project.findById(projectId).select('owner members').lean();
  const memberIds = new Set([String(project.owner), ...(project.members || []).map(String)]);

  const outsiders = [...candidates].filter((id) => !memberIds.has(id));
  if (outsiders.length) {
    throw ApiError.badRequest(`Mentioned user(s) are not members of this project: ${outsiders.join(', ')}`);
  }

  return [...candidates];
}

/** Every user with a stake in a task's discussion. */
function commentAudience(task, mentions = []) {
  return [task.assignedTo, task.createdBy, ...mentions].filter(Boolean).map(String);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Comments across the tasks this user can see. */
async function listComments(user, query = {}) {
  const { page, limit, skip, sort } = getPagination(query, { allowedSort: SORTABLE, defaultSort: '-createdAt' });

  const filter = {};
  if (query.task) {
    const task = await Task.findById(query.task);
    if (!task) throw ApiError.notFound('Task');
    const project = await access.loadProject(task.project);
    access.assertTaskAccess(task, project, user);
    filter.task = task._id;
  } else if (!isAdmin(user)) {
    const projectIds = await access.getVisibleProjectIds(user);
    const taskIds = await Task.find({ project: { $in: projectIds } }).distinct('_id');
    filter.task = { $in: taskIds };
  }

  if (query.author) filter.author = query.author;
  if (query.parent !== undefined) filter.parent = query.parent || null;

  const [comments, total] = await Promise.all([
    Comment.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    Comment.countDocuments(filter),
  ]);

  return { items: comments.map((c) => c.toJSON()), meta: buildMeta(page, limit, total) };
}

async function listTaskComments(taskId, user, query = {}) {
  const task = await Task.findById(taskId);
  if (!task) throw ApiError.notFound('Task');

  const project = await access.loadProject(task.project);
  access.assertTaskAccess(task, project, user);

  const { page, limit, skip, sort } = getPagination(query, { allowedSort: SORTABLE, defaultSort: 'createdAt' });

  const [comments, total] = await Promise.all([
    Comment.find({ task: task._id }).populate(POPULATE).sort(sort).skip(skip).limit(limit),
    Comment.countDocuments({ task: task._id }),
  ]);

  // Threaded shape: top-level comments each carrying their replies.
  const all = comments.map((c) => c.toJSON());
  const roots = all.filter((c) => !c.parent);
  const repliesByParent = all.reduce((acc, c) => {
    if (!c.parent) return acc;
    const key = String(c.parent);
    acc[key] = acc[key] || [];
    acc[key].push(c);
    return acc;
  }, {});

  const threaded = roots.map((root) => ({ ...root, replies: repliesByParent[String(root.id)] || [] }));

  return { items: threaded, meta: buildMeta(page, limit, total), flat: all };
}

async function getComment(commentId, user) {
  const comment = await Comment.findById(commentId).populate(POPULATE);
  if (!comment) throw ApiError.notFound('Comment');

  const task = await Task.findById(comment.task);
  if (!task) throw ApiError.notFound('Task');

  const project = await access.loadProject(task.project);
  access.assertTaskAccess(task, project, user);

  return comment;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function createComment(user, payload) {
  const task = await Task.findById(payload.task);
  if (!task) throw ApiError.notFound('Task');

  const project = await access.loadProject(task.project);
  access.assertTaskAccess(task, project, user);

  if (payload.parent) {
    const parent = await Comment.findById(payload.parent);
    if (!parent) throw ApiError.notFound('Parent comment');
    if (String(parent.task) !== String(task._id)) {
      throw ApiError.badRequest('A reply must belong to the same task as its parent comment');
    }
  }

  const mentions = await resolveMentions(payload.mentions || [], payload.body, project._id);

  const comment = await Comment.create({
    task: task._id,
    author: user._id,
    body: payload.body,
    parent: payload.parent || null,
    mentions,
  });

  await comment.populate(POPULATE);
  const json = comment.toJSON();

  emitToRooms(
    [rooms.project(project._id), ...commentAudience(task, mentions).map(rooms.user)],
    'comment:added',
    { comment: json, taskId: String(task._id), projectId: String(project._id), actorId: String(user._id) }
  );

  const audience = commentAudience(task, mentions).filter((id) => id !== String(user._id));
  if (audience.length) {
    const mentioned = new Set(mentions.map(String));
    const data = { taskId: String(task._id), projectId: String(project._id), commentId: String(comment._id) };

    await notifyUsers({
      userIds: audience,
      type: TYPES.COMMENT_ADDED,
      title: 'New comment',
      body: `${user.name} commented on "${task.title}"`,
      data,
      excludeUserId: user._id,
    });

    const mentionedAudience = audience.filter((id) => mentioned.has(id));
    if (mentionedAudience.length) {
      await notifyUsers({
        userIds: mentionedAudience,
        type: TYPES.MENTIONED,
        title: 'You were mentioned',
        body: `${user.name} mentioned you on "${task.title}"`,
        data,
        excludeUserId: user._id,
      });
    }
  }

  return comment;
}

async function updateComment(commentId, user, payload) {
  const comment = await Comment.findById(commentId);
  if (!comment) throw ApiError.notFound('Comment');

  if (!sameId(comment.author, user) && !isAdmin(user)) {
    throw ApiError.forbidden('You can only edit your own comments');
  }

  comment.body = payload.body;
  comment.editedAt = new Date();
  await comment.save();
  await comment.populate(POPULATE);

  const task = await Task.findById(comment.task).select('project').lean();
  emitToRooms([rooms.project(task.project)], 'comment:updated', {
    comment: comment.toJSON(),
    taskId: String(comment.task),
    actorId: String(user._id),
  });

  return comment;
}

async function deleteComment(commentId, user) {
  const comment = await Comment.findById(commentId);
  if (!comment) throw ApiError.notFound('Comment');

  const task = await Task.findById(comment.task);
  if (!task) throw ApiError.notFound('Task');

  // Author, an admin, or a lead on the owning project.
  const isAuthor = sameId(comment.author, user);
  if (!isAuthor && !isAdmin(user)) {
    const project = await access.loadProject(task.project);
    const leadOnProject = isLead(user) && project.hasMember(user);
    if (!leadOnProject) {
      throw ApiError.forbidden('You can only delete your own comments');
    }
  }

  await Promise.all([
    Comment.deleteOne({ _id: comment._id }),
    Comment.deleteMany({ parent: comment._id }), // drop replies with the thread
  ]);

  emitToRooms([rooms.project(task.project)], 'comment:deleted', {
    commentId: String(comment._id),
    taskId: String(task._id),
    actorId: String(user._id),
  });

  return { commentId: String(comment._id) };
}

module.exports = { listComments, listTaskComments, getComment, createComment, updateComment, deleteComment, POPULATE };
