'use strict';

const express = require('express');

const controller = require('../controllers/comment.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { idParam } = require('../validators/common.validator');
const { createCommentBody, updateCommentBody, listCommentsQuery } = require('../validators/comment.validator');

const router = express.Router();

router.use(authenticate);

/**
 * @swagger
 * /api/comments:
 *   post:
 *     summary: Add a comment to a task
 *     description: |
 *       Emits `comment:added` to the project room and pushes to the task's assignee
 *       and creator. Mention people either explicitly via `mentions` (they must be
 *       project members) or by writing `@their-email` in the body — mentions get a
 *       separate "you were mentioned" notification.
 *     tags: [Comments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [task, body]
 *             properties:
 *               task: { type: string }
 *               body: { type: string, maxLength: 2000, example: 'Looks good — @ada@taskflow.dev can you review?' }
 *               parent: { type: string, nullable: true, description: Reply to an existing comment }
 *               mentions: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Comment created }
 *       400: { description: A mentioned user is not a project member, or the parent belongs to another task }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: Task or parent comment not found }
 *   get:
 *     summary: List comments
 *     description: Scoped to the tasks the caller can see. Pass `?task=` for one task's comments.
 *     tags: [Comments]
 *     parameters:
 *       - { in: query, name: task, schema: { type: string } }
 *       - { in: query, name: author, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200:
 *         description: Paginated comments
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedEnvelope'
 *                 - type: object
 *                   properties: { data: { type: array, items: { $ref: '#/components/schemas/Comment' } } }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/', validate({ body: createCommentBody }), controller.create);
router.get('/', validate({ query: listCommentsQuery }), controller.list);

/**
 * @swagger
 * /api/comments/task/{id}:
 *   get:
 *     summary: All comments for a task, threaded
 *     description: Top-level comments each carry a `replies` array.
 *     tags: [Comments]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string }, description: Task id }]
 *     responses:
 *       200: { description: Threaded comments }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/comments/{id}:
 *   get:
 *     summary: Get a single comment
 *     tags: [Comments]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Comment }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   put:
 *     summary: Edit your own comment
 *     description: Only the author (or an admin) may edit. Sets `editedAt`.
 *     tags: [Comments]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [body], properties: { body: { type: string, maxLength: 2000 } } }
 *     responses:
 *       200: { description: 'Comment updated — broadcasts `comment:updated`' }
 *       403: { description: Not the author }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     summary: Delete a comment
 *     description: Allowed for the author, an admin, or a lead on the owning project. Replies are deleted with it.
 *     tags: [Comments]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: 'Comment deleted — broadcasts `comment:deleted`' }
 *       403: { description: Not the author and not a project lead }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/task/:id', validate({ params: idParam }), controller.listByTask);
router.get('/:id', validate({ params: idParam }), controller.getOne);
router.put('/:id', validate({ params: idParam, body: updateCommentBody }), controller.update);
router.delete('/:id', validate({ params: idParam }), controller.remove);

module.exports = router;
