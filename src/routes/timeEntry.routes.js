'use strict';

const express = require('express');

const controller = require('../controllers/timeEntry.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { timeSummaryQuery } = require('../validators/task.validator');

const router = express.Router();

router.use(authenticate);

/**
 * @swagger
 * /api/time/summary:
 *   get:
 *     summary: Time tracking summary
 *     description: |
 *       Totals grouped by `user` (default) or `task`. Scope follows the caller's role:
 *       a `member` sees only their own time, a `lead` everything within their projects,
 *       an `admin` everything.
 *     tags: [Tasks]
 *     parameters:
 *       - { in: query, name: groupBy, schema: { type: string, enum: [user, task], default: user } }
 *       - { in: query, name: task, schema: { type: string } }
 *       - { in: query, name: user, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *     responses:
 *       200:
 *         description: 'Totals per bucket, plus `totals.totalSeconds` and `totals.totalHours`'
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/summary', validate({ query: timeSummaryQuery }), controller.summary);

module.exports = router;
