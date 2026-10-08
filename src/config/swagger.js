'use strict';

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const env = require('./env');
const { applyExamples } = require('./swaggerExamples');

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'TaskFlow API',
    version: '1.0.0',
    description: [
      'Production-quality task management backend.',
      '',
      '**Authentication** — call `POST /api/auth/login`, then send the returned JWT as',
      '`Authorization: Bearer <token>` on every protected route.',
      '',
      '**Roles** — `member` (works on their own assigned tasks), `lead` (creates projects,',
      'tasks and teams, manages their team), `admin` (full access, including `/api/admin`).',
      'Role checks are always combined with a resource-level membership/ownership check.',
      '',
      '**Envelope** — success responses are `{ success, message, data, meta? }`; errors are',
      '`{ success: false, error: { code, message, details? } }`.',
    ].join('\n'),
    license: { name: 'MIT' },
  },
  // Rewritten per request in app.js so "Try it out" always targets the host
  // serving the page; this entry is the fallback for anything reading the
  // document outside a request (a linter, a codegen run).
  servers: [
    {
      url: env.PUBLIC_URL || `http://localhost:${env.PORT}`,
      description: env.PUBLIC_URL ? 'This deployment' : 'Local development',
    },
  ],
  tags: [
    { name: 'Auth', description: 'Registration, login (password + Firebase) and profile' },
    { name: 'Projects', description: 'Project CRUD, membership, progress reports and Gantt data' },
    { name: 'Tasks', description: 'Task CRUD, filtering, dependencies and time tracking' },
    { name: 'Comments', description: 'Task comments with threading and mentions' },
    { name: 'Teams', description: 'Team CRUD and membership' },
    { name: 'Admin', description: 'Administrative endpoints — admin role required' },
    { name: 'Health', description: 'Liveness probes' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      SuccessEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Success' },
          data: { type: 'object' },
        },
      },
      PaginatedEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Success' },
          data: { type: 'array', items: { type: 'object' } },
          meta: {
            type: 'object',
            properties: {
              page: { type: 'integer', example: 1 },
              limit: { type: 'integer', example: 20 },
              total: { type: 'integer', example: 42 },
              totalPages: { type: 'integer', example: 3 },
              hasNextPage: { type: 'boolean' },
              hasPrevPage: { type: 'boolean' },
            },
          },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: ['BAD_REQUEST', 'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE'],
              },
              message: { type: 'string', example: 'Task not found' },
              details: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '665f1c2a9b3e4d5f6a7b8c9d' },
          name: { type: 'string', example: 'Ada Lovelace' },
          email: { type: 'string', format: 'email', example: 'ada@taskflow.dev' },
          role: { type: 'string', enum: ['member', 'lead', 'admin'] },
          avatarUrl: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Project: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', example: 'Apollo Redesign' },
          key: { type: 'string', example: 'APO' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['planning', 'active', 'on-hold', 'completed', 'archived'] },
          owner: { $ref: '#/components/schemas/User' },
          team: { type: 'string', nullable: true },
          members: { type: 'array', items: { $ref: '#/components/schemas/User' } },
          startDate: { type: 'string', format: 'date-time', nullable: true },
          endDate: { type: 'string', format: 'date-time', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProjectProgress: {
        type: 'object',
        description: 'Attached to every project returned by GET /api/projects.',
        properties: {
          totalTasks: { type: 'integer', example: 12 },
          completed: { type: 'integer', example: 5 },
          inProgress: { type: 'integer', example: 3 },
          review: { type: 'integer', example: 1 },
          todo: { type: 'integer', example: 3 },
          overdue: { type: 'integer', example: 2 },
          completionPercentage: { type: 'number', example: 41.7, description: 'completed / totalTasks × 100, rounded to 1 decimal' },
          averageProgress: { type: 'number', example: 44.2, description: 'Mean of each task\'s own progress field' },
          byPriority: {
            type: 'object',
            properties: { low: { type: 'integer' }, medium: { type: 'integer' }, high: { type: 'integer' }, critical: { type: 'integer' } },
          },
        },
      },
      Task: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string', example: 'Wire up the payment webhook' },
          description: { type: 'string' },
          project: { type: 'string', description: 'Project id (populated as an object on reads)' },
          assignedTo: { $ref: '#/components/schemas/User' },
          createdBy: { $ref: '#/components/schemas/User' },
          status: { type: 'string', enum: ['todo', 'in-progress', 'review', 'done'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          startDate: { type: 'string', format: 'date-time' },
          deadline: { type: 'string', format: 'date-time', nullable: true },
          progress: { type: 'integer', minimum: 0, maximum: 100 },
          dependencies: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          estimatedHours: { type: 'number', nullable: true },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Comment: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          task: { type: 'string' },
          author: { $ref: '#/components/schemas/User' },
          body: { type: 'string' },
          parent: { type: 'string', nullable: true },
          mentions: { type: 'array', items: { $ref: '#/components/schemas/User' } },
          editedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Team: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', example: 'Platform' },
          description: { type: 'string' },
          lead: { $ref: '#/components/schemas/User' },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                user: { $ref: '#/components/schemas/User' },
                role: { type: 'string', enum: ['member', 'lead'] },
                joinedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
          projects: { type: 'array', items: { type: 'string' } },
          isActive: { type: 'boolean' },
        },
      },
      TimeEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          task: { type: 'string' },
          user: { $ref: '#/components/schemas/User' },
          startedAt: { type: 'string', format: 'date-time' },
          endedAt: { type: 'string', format: 'date-time', nullable: true },
          durationSeconds: { type: 'integer', nullable: true },
          note: { type: 'string' },
          running: { type: 'boolean' },
        },
      },
      GanttTask: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          start: { type: 'string', format: 'date-time' },
          end: { type: 'string', format: 'date-time' },
          progress: { type: 'integer' },
          status: { type: 'string' },
          priority: { type: 'string' },
          assignee: { type: 'string', nullable: true },
          dependencies: { type: 'array', items: { type: 'string' } },
          isMilestone: { type: 'boolean' },
        },
      },
    },
    responses: {
      Unauthorized: { description: 'Missing or invalid token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
      Forbidden: { description: 'Authenticated but not allowed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
      NotFound: { description: 'Resource not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
      ValidationError: { description: 'Payload or query failed validation', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
    },
  },
  security: [{ bearerAuth: [] }],
};

const swaggerSpec = applyExamples(
  swaggerJsdoc({
    definition,
    apis: [
      path.join(__dirname, '..', 'routes', '*.js'),
      path.join(__dirname, '..', 'models', '*.js'),
    ],
  })
);

module.exports = { swaggerSpec, definition };
