'use strict';

const express = require('express');

const controller = require('../controllers/task.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { idParam } = require('../validators/common.validator');
const { createTaskBody, updateTaskBody, listTasksQuery, startTimerBody, stopTimerBody } = require('../validators/task.validator');
const { taskTimeQuery } = require('../validators/timeEntry.validator');

const router = express.Router();

router.use(authenticate);

/**
 * @swagger
 * /api/tasks:
 *   get:
 *     summary: List and filter tasks
 *     description: |
 *       A `member` sees tasks in the projects they belong to, a `lead` sees their
 *       projects, an `admin` sees everything. Passing `?project=` you cannot access
 *       returns 403 rather than an empty list.
 *     tags: [Tasks]
 *     parameters:
 *       - { in: query, name: project, schema: { type: string } }
 *       - { in: query, name: assignee, schema: { type: string }, description: Alias of assignedTo }
 *       - { in: query, name: status, schema: { type: string }, description: 'Comma separated: todo,in-progress,review,done' }
 *       - { in: query, name: priority, schema: { type: string }, description: 'Comma separated: low,medium,high,critical' }
 *       - { in: query, name: dueBefore, schema: { type: string, format: date-time } }
 *       - { in: query, name: dueAfter, schema: { type: string, format: date-time } }
 *       - { in: query, name: tags, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string }, description: Matches title, description and tags }
 *       - { in: query, name: mine, schema: { type: boolean }, description: Only tasks assigned to the caller }
 *       - { in: query, name: overdue, schema: { type: boolean } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: sort, schema: { type: string, example: '-deadline' }, description: 'Sortable: createdAt, updatedAt, title, deadline, startDate, priority, status, progress' }
 *     responses:
 *       200:
 *         description: Paginated tasks
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedEnvelope'
 *                 - type: object
 *                   properties: { data: { type: array, items: { $ref: '#/components/schemas/Task' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *   post:
 *     summary: Create a task (project lead or admin)
 *     description: |
 *       The assignee must already be a member of the project. Dependencies must
 *       exist, belong to the same project, and not create a cycle.
 *       Emits `task:created` (and `task:assigned` + a push when assigned).
 *     tags: [Tasks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, project]
 *             properties:
 *               title: { type: string, example: Wire up the payment webhook }
 *               description: { type: string }
 *               project: { type: string }
 *               assignedTo: { type: string, nullable: true }
 *               status: { type: string, enum: [todo, in-progress, review, done], default: todo }
 *               priority: { type: string, enum: [low, medium, high, critical], default: medium }
 *               startDate: { type: string, format: date-time }
 *               deadline: { type: string, format: date-time, nullable: true }
 *               progress: { type: integer, minimum: 0, maximum: 100 }
 *               dependencies: { type: array, items: { type: string } }
 *               tags: { type: array, items: { type: string } }
 *               estimatedHours: { type: number, nullable: true }
 *     responses:
 *       201: { description: Task created }
 *       400: { description: Unknown assignee/dependency, cross-project dependency or a dependency cycle }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/', validate({ query: listTasksQuery }), controller.list);
router.post('/', authorize('lead', 'admin'), validate({ body: createTaskBody }), controller.create);

/**
 * @swagger
 * /api/tasks/{id}:
 *   get:
 *     summary: Get a task
 *     tags: [Tasks]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Task with populated project, assignee, creator and dependencies }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   put:
 *     summary: Update a task
 *     description: |
 *       - `admin` / project `lead` — any field.
 *       - `member` — only `status` and `progress`, and only on a task assigned to them.
 *
 *       Side effects: a status change broadcasts `task:updated` to the project room;
 *       reassignment emits `task:assigned` and pushes to the new assignee; a changed
 *       deadline pushes to the assignee.
 *     tags: [Tasks]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               assignedTo: { type: string, nullable: true }
 *               status: { type: string, enum: [todo, in-progress, review, done] }
 *               priority: { type: string, enum: [low, medium, high, critical] }
 *               startDate: { type: string, format: date-time }
 *               deadline: { type: string, format: date-time, nullable: true }
 *               progress: { type: integer, minimum: 0, maximum: 100 }
 *               dependencies: { type: array, items: { type: string } }
 *               tags: { type: array, items: { type: string } }
 *               estimatedHours: { type: number, nullable: true }
 *     responses:
 *       200: { description: Task updated }
 *       400: { description: Invalid dependency or deadline }
 *       403: { description: 'A member editing a field other than status/progress, or a task not assigned to them' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     summary: Delete a task (project lead or admin)
 *     description: Cascades to the task's comments and time entries, and detaches it from any dependents.
 *     tags: [Tasks]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: 'Task deleted — broadcasts `task:deleted`' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', validate({ params: idParam }), controller.getOne);
router.put('/:id', validate({ params: idParam, body: updateTaskBody }), controller.update);
router.delete('/:id', authorize('lead', 'admin'), validate({ params: idParam }), controller.remove);

/**
 * @swagger
 * /api/tasks/{id}/time/start:
 *   post:
 *     summary: Start a timer on a task
 *     description: A user may only have one timer running at a time; starting a second returns 409.
 *     tags: [Tasks]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { note: { type: string } } }
 *     responses:
 *       201: { description: Timer started }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { description: A timer is already running }
 * /api/tasks/{id}/time/stop:
 *   post:
 *     summary: Stop your running timer on a task
 *     tags: [Tasks]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { note: { type: string } } }
 *     responses:
 *       200: { description: Timer stopped, duration recorded }
 *       404: { description: No running timer for this user and task }
 * /api/tasks/{id}/time:
 *   get:
 *     summary: Time entries and totals for a task
 *     description: A `member` sees only their own entries; a `lead` or `admin` sees everyone's. Totals are returned under `meta.totals`.
 *     tags: [Tasks]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: user, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *     responses:
 *       200: { description: 'Time entries; `meta.totals.perUser` and `meta.running` included' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/:id/time/start', validate({ params: idParam, body: startTimerBody }), controller.startTime);
router.post('/:id/time/stop', validate({ params: idParam, body: stopTimerBody }), controller.stopTime);
router.get('/:id/time', validate({ params: idParam, query: taskTimeQuery }), controller.getTime);

module.exports = router;
