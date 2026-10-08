'use strict';

const commentService = require('../services/comment.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated } = require('../utils/ApiResponse');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await commentService.listComments(req.user, req.query);
  return paginated(res, items, meta, 'Comments retrieved');
});

const listByTask = asyncHandler(async (req, res) => {
  const { items, meta } = await commentService.listTaskComments(req.params.id, req.user, req.query);
  return paginated(res, items, meta, 'Comments retrieved');
});

const getOne = asyncHandler(async (req, res) => {
  const comment = await commentService.getComment(req.params.id, req.user);
  return ok(res, comment.toJSON(), 'Comment retrieved');
});

const create = asyncHandler(async (req, res) => {
  const comment = await commentService.createComment(req.user, req.body);
  return created(res, comment.toJSON(), 'Comment added');
});

const update = asyncHandler(async (req, res) => {
  const comment = await commentService.updateComment(req.params.id, req.user, req.body);
  return ok(res, comment.toJSON(), 'Comment updated');
});

const remove = asyncHandler(async (req, res) => {
  const result = await commentService.deleteComment(req.params.id, req.user);
  return ok(res, result, 'Comment deleted');
});

module.exports = { list, listByTask, getOne, create, update, remove };
