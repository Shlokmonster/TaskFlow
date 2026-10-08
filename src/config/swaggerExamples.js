'use strict';

/**
 * Enrichment pass over the generated OpenAPI document.
 *
 * The JSDoc in `routes/*.js` describes the *shape* of each request (types, enums,
 * required fields), which is what a reader wants. It is not enough to *test* with:
 * Swagger UI prefills the "Try it out" editor from the media-type `example`, and
 * without one it invents `"project": "string"` — which fails validation, so the
 * first click of every write endpoint is an error.
 *
 * Keeping the ready-to-send payloads here instead of inlining them in 42 JSDoc
 * blocks means they can be reviewed and kept consistent in one place. Placeholder
 * ids are real ObjectId shapes so they pass format validation; the guide printed at
 * the bottom of the docs page explains to swap them for ids copied from a list call.
 */

/** A syntactically valid ObjectId used wherever a real resource id is needed. */
const DEMO_ID = '665f1c2a9b3e4d5f6a7b8c9d';

/** Path parameter examples, so the URL box is prefilled rather than left as `{id}`. */
const PATH_PARAMS = {
  id: DEMO_ID,
  userId: DEMO_ID,
  projectId: DEMO_ID,
  taskId: DEMO_ID,
  teamId: DEMO_ID,
  commentId: DEMO_ID,
};

/** Ready-to-send bodies, keyed by `METHOD /path`. */
const REQUEST_EXAMPLES = {
  // --- Auth ---------------------------------------------------------------
  'POST /api/auth/register': {
    name: 'Ada Lovelace',
    email: 'ada@taskflow.dev',
    password: 'Passw0rd!',
    fcmToken: 'optional-device-token',
  },
  'POST /api/auth/login': {
    email: 'lead@taskflow.dev',
    password: 'Passw0rd!',
    fcmToken: 'optional-device-token',
  },
  'POST /api/auth/firebase': {
    firebaseToken: 'PASTE_A_FIREBASE_ID_TOKEN',
  },
  'PATCH /api/auth/me': {
    name: 'Liam Lead',
    avatarUrl: 'https://example.com/avatar.png',
  },
  'POST /api/auth/logout': {
    fcmToken: 'optional-device-token',
  },

  // --- Projects -----------------------------------------------------------
  // Names and keys here deliberately avoid the seeded Apollo/Atlas rows: a
  // duplicate key is a 409, and the whole point of these bodies is that the
  // first click succeeds.
  'POST /api/projects': {
    name: 'Orion Rollout',
    key: 'ORI',
    description: 'Roll the new dashboard out to every region',
    status: 'active',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-06-30T00:00:00.000Z',
    tags: ['frontend', 'q1'],
  },
  'PUT /api/projects/{id}': {
    status: 'on-hold',
    description: 'Paused pending design review',
    endDate: '2026-08-31T00:00:00.000Z',
  },
  'POST /api/projects/{id}/members': {
    members: [DEMO_ID],
  },

  // --- Tasks --------------------------------------------------------------
  'POST /api/tasks': {
    title: 'Wire up the payment webhook',
    description: 'Idempotent handler for provider callbacks',
    project: DEMO_ID,
    assignedTo: DEMO_ID,
    status: 'todo',
    priority: 'high',
    deadline: '2026-12-01T00:00:00.000Z',
    estimatedHours: 16,
    tags: ['backend', 'payments'],
  },
  'PUT /api/tasks/{id}': {
    status: 'in-progress',
    progress: 35,
    priority: 'critical',
    deadline: '2026-12-15T00:00:00.000Z',
  },
  'POST /api/tasks/{id}/time/start': {
    note: 'Pairing on the webhook',
  },
  'POST /api/tasks/{id}/time/stop': {},

  // --- Comments -----------------------------------------------------------
  'POST /api/comments': {
    task: DEMO_ID,
    body: 'Deploy target is Render — @lead@taskflow.dev please confirm the env vars.',
  },
  'PUT /api/comments/{id}': {
    body: 'Edited: please reuse the existing table component.',
  },

  // --- Teams --------------------------------------------------------------
  'POST /api/teams': {
    name: 'Growth',
    description: 'Onboarding, activation and lifecycle messaging',
    members: [{ user: DEMO_ID, role: 'member' }],
  },
  // Description only: `members` needs a real user id, and leaving it out keeps
  // this a one-click success once the path id is a real team.
  'PUT /api/teams/{id}': {
    description: 'Core platform squad',
  },

  // --- Admin --------------------------------------------------------------
  'PATCH /api/admin/users/{id}/role': { role: 'lead' },
  'PATCH /api/admin/users/{id}/status': { isActive: false },
};

/**
 * A stable, human-readable operationId — gives every operation a permanent
 * deep link (`#/Tasks/post_api_tasks`) that the guide links to.
 */
function operationIdFor(method, pathKey) {
  const slug = pathKey
    .replace(/^\//, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+$/, '');
  return `${method.toLowerCase()}_${slug}`;
}

function applyExamples(spec) {
  const methods = ['get', 'post', 'put', 'patch', 'delete'];

  for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;

      operation.operationId = operationIdFor(method, pathKey);

      // Prefill path parameters so the URL box is ready to send.
      for (const parameter of operation.parameters || []) {
        if (parameter.in === 'path' && PATH_PARAMS[parameter.name]) {
          parameter.example = PATH_PARAMS[parameter.name];
        }
      }

      const example = REQUEST_EXAMPLES[`${method.toUpperCase()} ${pathKey}`];
      const json = operation.requestBody?.content?.['application/json'];
      if (example && json) {
        json.example = example;
      }
    }
  }

  return spec;
}

/** Operations that accept a body — used by the test that guards this file. */
function documentedWriteOperations() {
  return Object.keys(REQUEST_EXAMPLES);
}

module.exports = { applyExamples, documentedWriteOperations, DEMO_ID, REQUEST_EXAMPLES };
