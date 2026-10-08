'use strict';

const express = require('express');

const controller = require('../controllers/project.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { idParam, objectId } = require('../validators/common.validator');
const Joi = require('joi');
const { createProjectBody, updateProjectBody, listProjectsQuery, addMembersBody } = require('../validators/project.validator');

const router = express.Router();

router.use(authenticate);

/**
 * @swagger
 * /api/projects:
 *   get:
 *     summary: List projects with a progress report
 *     description: |
 *       Returns the projects the caller can see — a `member`/`lead` gets the projects
 *       they own, are a member of, or that belong to their team; an `admin` gets all.
 *
 *       Every project carries a `progress` block: `totalTasks`, `completed`,
 *       `inProgress`, `review`, `todo`, `overdue`, `completionPercentage`
 *       (completed ÷ total, rounded to 1 dp), `averageProgress` and a `byPriority`
 *       breakdown. Tasks with no deadline are never counted as overdue.
 *     tags: [Projects]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { in: query, name: status, schema: { type: string }, description: 'Comma separated: planning,active,on-hold,completed,archived' }
 *       - { in: query, name: team, schema: { type: string } }
 *       - { in: query, name: owner, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string }, description: Matches name, key or description }
 *       - { in: query, name: tags, schema: { type: string }, description: Comma separated tags }
 *       - { in: query, name: sort, schema: { type: string, example: '-createdAt' } }
 *     responses:
 *       200:
 *         description: Paginated projects, each with a progress report
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedEnvelope'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/Project'
 *                           - type: object
 *                             properties: { progress: { $ref: '#/components/schemas/ProjectProgress' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     summary: Create a project (lead or admin)
 *     description: The creator becomes the owner and is always added to `members`.
 *     tags: [Projects]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, key]
 *             properties:
 *               name: { type: string, example: Apollo Redesign }
 *               key: { type: string, example: APO, description: 'Unique short code, 2-10 letters/digits' }
 *               description: { type: string }
 *               status: { type: string, enum: [planning, active, on-hold, completed, archived] }
 *               team: { type: string, nullable: true }
 *               members: { type: array, items: { type: string } }
 *               startDate: { type: string, format: date-time }
 *               endDate: { type: string, format: date-time, nullable: true }
 *               tags: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Project created }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { description: Project key already in use }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/', validate({ query: listProjectsQuery }), controller.list);
router.post('/', authorize('lead', 'admin'), validate({ body: createProjectBody }), controller.create);

/**
 * @swagger
 * /api/projects/{id}:
 *   get:
 *     summary: Get a project
 *     tags: [Projects]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: 'Project with `progress` and `taskCount`' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   put:
 *     summary: Update a project (owner, project lead or admin)
 *     tags: [Projects]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               key: { type: string }
 *               description: { type: string }
 *               status: { type: string, enum: [planning, active, on-hold, completed, archived] }
 *               team: { type: string, nullable: true }
 *               members: { type: array, items: { type: string }, description: Replaces the member list; the owner is always retained }
 *               startDate: { type: string, format: date-time }
 *               endDate: { type: string, format: date-time, nullable: true }
 *               tags: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: 'Project updated — broadcasts `project:updated` to the project and team rooms' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     summary: Delete a project (owner or admin)
 *     description: Cascades — deletes the project's tasks, their comments and their time entries.
 *     tags: [Projects]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: 'Project deleted — broadcasts `project:deleted`' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', validate({ params: idParam }), controller.getOne);
router.put('/:id', authorize('lead', 'admin'), validate({ params: idParam, body: updateProjectBody }), controller.update);
router.delete('/:id', authorize('lead', 'admin'), validate({ params: idParam }), controller.remove);

/**
 * @swagger
 * /api/projects/{id}/progress:
 *   get:
 *     summary: Progress report for one project
 *     tags: [Projects]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200:
 *         description: Progress report
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessEnvelope'
 *                 - type: object
 *                   properties: { data: { $ref: '#/components/schemas/ProjectProgress' } }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/projects/{id}/gantt:
 *   get:
 *     summary: Gantt data for a project
 *     description: |
 *       Every task rendered as a bar: `start` (startDate), `end` (deadline, else
 *       completion, else start), `progress`, `dependencies`, plus the overall
 *       project `window`. A task with no deadline is flagged `isMilestone`.
 *     tags: [Projects]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200:
 *         description: Gantt payload
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessEnvelope'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         project: { type: object }
 *                         window: { type: object, properties: { start: { type: string, format: date-time }, end: { type: string, format: date-time } } }
 *                         taskCount: { type: integer }
 *                         tasks: { type: array, items: { $ref: '#/components/schemas/GanttTask' } }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id/progress', validate({ params: idParam }), controller.progress);
router.get('/:id/gantt', validate({ params: idParam }), controller.gantt);

/**
 * @swagger
 * /api/projects/{id}/members:
 *   post:
 *     summary: Add members to a project
 *     tags: [Projects]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [members]
 *             properties:
 *               members: { type: array, items: { type: string }, example: ["665f1c2a9b3e4d5f6a7b8c9d"] }
 *     responses:
 *       200: { description: 'Members added — they receive a push and join the project socket room' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 * /api/projects/{id}/members/{userId}:
 *   delete:
 *     summary: Remove a member from a project
 *     description: The owner cannot be removed. Tasks assigned to the removed member are unassigned.
 *     tags: [Projects]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: userId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Member removed }
 *       400: { description: Cannot remove the owner }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/members', authorize('lead', 'admin'), validate({ params: idParam, body: addMembersBody }), controller.addMembers);
router.delete(
  '/:id/members/:userId',
  authorize('lead', 'admin'),
  validate({ params: Joi.object({ id: objectId.required(), userId: objectId.required() }) }),
  controller.removeMember
);

module.exports = router;
