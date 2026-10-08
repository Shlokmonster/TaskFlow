'use strict';

const express = require('express');

const controller = require('../controllers/team.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { idParam } = require('../validators/common.validator');
const { createTeamBody, updateTeamBody, listTeamsQuery } = require('../validators/team.validator');

const router = express.Router();

router.use(authenticate);

/**
 * @swagger
 * /api/teams:
 *   get:
 *     summary: List teams
 *     description: A `member`/`lead` sees the teams they lead or belong to; an `admin` sees all.
 *     tags: [Teams]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200:
 *         description: Paginated teams
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedEnvelope'
 *                 - type: object
 *                   properties: { data: { type: array, items: { $ref: '#/components/schemas/Team' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     summary: Create a team (lead or admin)
 *     description: The creator becomes the lead unless an admin assigns someone else.
 *     tags: [Teams]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: Platform }
 *               description: { type: string }
 *               lead: { type: string, description: Admin only — defaults to the caller }
 *               members:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties: { user: { type: string }, role: { type: string, enum: [member, lead] } }
 *               projects: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Team created }
 *       403: { description: A non-admin tried to create a team led by someone else }
 *       409: { description: Team name already exists }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/', validate({ query: listTeamsQuery }), controller.list);
router.post('/', authorize('lead', 'admin'), validate({ body: createTeamBody }), controller.create);

/**
 * @swagger
 * /api/teams/{id}:
 *   get:
 *     summary: Get a team
 *     tags: [Teams]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Team }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   put:
 *     summary: Update a team (team lead or admin)
 *     description: Replacing `members` syncs live sockets — added users join `team:<id>`, removed users leave it.
 *     tags: [Teams]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               lead: { type: string, description: Admin only }
 *               members:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties: { user: { type: string }, role: { type: string, enum: [member, lead] } }
 *               projects: { type: array, items: { type: string } }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: 'Team updated — broadcasts `team:updated`' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     summary: Delete a team (admin only)
 *     description: Projects linked to the team are unlinked, not deleted.
 *     tags: [Teams]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Team deleted }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', validate({ params: idParam }), controller.getOne);
router.put('/:id', authorize('lead', 'admin'), validate({ params: idParam, body: updateTeamBody }), controller.update);
router.delete('/:id', authorize('admin'), validate({ params: idParam }), controller.remove);

module.exports = router;
