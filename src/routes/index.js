'use strict';

const express = require('express');

const env = require('../config/env');
const { dbState } = require('../config/db');
const { isFirebaseEnabled } = require('../config/firebase');

const authRoutes = require('./auth.routes');
const projectRoutes = require('./project.routes');
const taskRoutes = require('./task.routes');
const commentRoutes = require('./comment.routes');
const teamRoutes = require('./team.routes');
const adminRoutes = require('./admin.routes');
const timeRoutes = require('./timeEntry.routes');

const router = express.Router();

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Service health
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Service is up
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     status: { type: string, example: ok }
 *                     database: { type: string, example: connected }
 *                     firebase: { type: boolean, description: Whether push notifications are available }
 *                     uptime: { type: number, example: 42.5 }
 *                     environment: { type: string, example: production }
 */
router.get('/health', (_req, res) =>
  res.status(200).json({
    success: true,
    message: 'TaskFlow API is running',
    data: {
      status: 'ok',
      database: dbState(),
      firebase: isFirebaseEnabled(),
      uptime: Math.round(process.uptime() * 100) / 100,
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    },
  })
);

router.use('/auth', authRoutes);
router.use('/projects', projectRoutes);
router.use('/tasks', taskRoutes);
router.use('/comments', commentRoutes);
router.use('/teams', teamRoutes);
router.use('/admin', adminRoutes);
router.use('/time', timeRoutes);

module.exports = router;
