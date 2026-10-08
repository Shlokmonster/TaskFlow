'use strict';

const express = require('express');
const Joi = require('joi');

const controller = require('../controllers/admin.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { idParam, paginationFields, search } = require('../validators/common.validator');

const router = express.Router();

// Every route below requires the admin role.
router.use(authenticate, authorize('admin'));

const listUsersQuery = Joi.object({
  ...paginationFields,
  role: Joi.string().trim().max(60),
  isActive: Joi.boolean().truthy('true', '1').falsy('false', '0'),
  search,
});

const listProjectsQuery = Joi.object({
  ...paginationFields,
  status: Joi.string().trim().max(80),
  search,
});

const roleBody = Joi.object({ role: Joi.string().valid('member', 'lead', 'admin').required() });
const statusBody = Joi.object({ isActive: Joi.boolean().required() });

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: List all users (admin)
 *     tags: [Admin]
 *     parameters:
 *       - { in: query, name: role, schema: { type: string }, description: 'Comma separated: member,lead,admin' }
 *       - { in: query, name: isActive, schema: { type: boolean } }
 *       - { in: query, name: search, schema: { type: string }, description: Matches name or email }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200:
 *         description: Paginated users. Password hashes and device tokens are never returned.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedEnvelope'
 *                 - type: object
 *                   properties: { data: { type: array, items: { $ref: '#/components/schemas/User' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 * /api/admin/projects:
 *   get:
 *     summary: List all projects with progress (admin)
 *     tags: [Admin]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: Paginated projects with owner, members, team and progress }
 *       403: { $ref: '#/components/responses/Forbidden' }
 * /api/admin/stats:
 *   get:
 *     summary: Platform statistics (admin)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Counts for users, projects, teams, comments and tasks (by status, overdue, unassigned, completion %)
 *       403: { $ref: '#/components/responses/Forbidden' }
 * /api/admin/users/{id}:
 *   get:
 *     summary: Get one user (admin)
 *     tags: [Admin]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: User }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/admin/users/{id}/role:
 *   patch:
 *     summary: Change a user's role (admin)
 *     description: You cannot change your own role, and the last remaining active admin cannot be demoted.
 *     tags: [Admin]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [role], properties: { role: { type: string, enum: [member, lead, admin] } } }
 *     responses:
 *       200: { description: Role updated }
 *       400: { description: Self-change or last-admin protection }
 *       404: { $ref: '#/components/responses/NotFound' }
 * /api/admin/users/{id}/status:
 *   patch:
 *     summary: Activate or deactivate a user (admin)
 *     description: Deactivating blocks login immediately. You cannot deactivate yourself or the last active admin.
 *     tags: [Admin]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [isActive], properties: { isActive: { type: boolean } } }
 *     responses:
 *       200: { description: Status updated }
 *       400: { description: Self-deactivation or last-admin protection }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/users', validate({ query: listUsersQuery }), controller.listUsers);
router.get('/users/:id', validate({ params: idParam }), controller.getUser);
router.patch('/users/:id/role', validate({ params: idParam, body: roleBody }), controller.updateUserRole);
router.patch('/users/:id/status', validate({ params: idParam, body: statusBody }), controller.updateUserStatus);
router.get('/projects', validate({ query: listProjectsQuery }), controller.listProjects);
router.get('/stats', controller.stats);

module.exports = router;
