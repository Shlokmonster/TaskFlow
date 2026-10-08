# TaskFlow

A production-style task management backend: projects, teams, tasks with dependencies,
threaded comments, an RBAC model with real ownership checks, live Socket.io updates and
Firebase Cloud Messaging push notifications.

Built with Node.js + Express + MongoDB, documented with OpenAPI, and tested end to end
with Jest and Supertest.

```
npm install && cp .env.example .env   # set MONGODB_URI + JWT_SECRET
npm run seed                          # demo users, projects and tasks
npm run dev                           # http://localhost:5000/api/docs
```

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Running](#running)
- [Seeding](#seeding)
- [Testing](#testing)
- [API summary](#api-summary)
- [Roles and permissions](#roles-and-permissions)
- [Real-time events](#real-time-events)
- [Push notifications](#push-notifications)
- [Example user flow](#example-user-flow)
- [Deployment](#deployment)
- [Project layout](#project-layout)

---

## Overview

TaskFlow is the backend for a team task manager. A **project** belongs to a lead, has
members, and holds **tasks**. Tasks carry a status (`todo` → `in-progress` → `review` →
`done`), a priority, a deadline, progress, tags and **dependencies** on other tasks in the
same project. Members discuss tasks in **comments** — threaded, with `@email` mentions.

Every write goes through validation, an ownership/membership check and an RBAC check
before it touches the database, and every successful write that other people care about is
broadcast to the right Socket.io rooms and pushed to the right devices.

The API is documented with OpenAPI 3 and browsable at `/api/docs`. A ready-to-import
Postman collection lives at `docs/TaskFlow.postman_collection.json`.

The docs page is built to be *used*, not just read, and to be shown to someone:

- **Every write body is prefilled.** Swagger UI's "Try it out" comes up with a
  ready-to-send payload, so the first click succeeds instead of failing validation.
- **One-click sign-in.** In development the page offers lead / member / admin buttons
  that fetch a token and hand it to Swagger UI's *Authorize* — no copy-paste. They are
  hidden when `NODE_ENV=production`, along with the demo credentials.
- **A guide underneath the UI** (`src/docs/swagger-guide.js`) listing every endpoint with
  the role it needs, a ten-step scripted demo that exercises the whole product, a live
  panel of your real ids to paste into the examples, the Socket.io event reference with a
  watcher script, and the error-code contract.

`npm test` guards it: `tests/docs.test.js` fails if an endpoint lacks an example, lacks a
role label in the guide, or if the guide ever publishes the demo password in production.

---

## Features

**Auth & users**
- Email + password registration and login (bcryptjs, configurable cost)
- Optional Firebase ID-token login (`POST /api/auth/login` with `firebaseToken`, or `POST /api/auth/firebase`)
- JWT access tokens with issuer/audience validation; `GET`/`PATCH /api/auth/me`
- Device registration — `fcmToken` on register/login, unregistered on logout
- Password hashes and FCM tokens are never serialised to a client

**Projects**
- Full CRUD, plus member add/remove
- `GET /api/projects` returns a **per-project progress report** — total, completed,
  in-progress, review, todo, **overdue**, completion %, average progress, by-priority counts
- `GET /api/projects/:id/progress` for the same report on one project
- `GET /api/projects/:id/gantt` for task bars (start, end, progress, dependency edges)

**Tasks**
- Full CRUD with `title`, `description`, `project`, `assignedTo`, `createdBy`, `status`,
  `priority`, `deadline`, `progress`, `dependencies`, `tags`, estimate/actual hours
- Filters: project, assignee, status, priority, `dueBefore`, tags, `mine`, `overdue`,
  full-text-ish `search`, pagination and whitelisted sorting
- Status ↔ progress ↔ `completedAt` kept consistent automatically (`done` ⇒ 100%)
- Dependencies validated for existence, same project, self-reference and **cycles** (DFS)
- Cascade delete: comments and time entries go, dependents are detached

**Teams, comments, admin**
- Teams with members and per-member roles; membership is the source of truth
- Comments with one level of replies and mention resolution
- Admin routes: users list/detail, role changes, activate/deactivate, all projects, platform stats

**Time tracking (optional feature)**
- `POST /api/tasks/:id/time/start`, `POST /api/tasks/:id/time/stop`, `GET /api/tasks/:id/time`
- `GET /api/time/summary?groupBy=user|task` for totals
- One running timer per user, enforced by a partial unique index

**Platform**
- Socket.io with JWT-authenticated handshake and `user:` / `project:` / `team:` rooms
- Firebase Cloud Messaging push, **optional** — the app runs with no Firebase config
- Centralised error handling with stable error codes and consistent JSON envelopes
- helmet, CORS allowlist, rate limiting, request sanitisation against operator injection
- Mongo indexes on every hot query path
- Swagger UI with a built-in testing guide, a Postman collection, a seed script, 118 integration tests, Render/Heroku config

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js (LTS) — developed on v20+ |
| Framework | Express 4 |
| Database | MongoDB with Mongoose 8 |
| Auth | `jsonwebtoken` (JWT) + `bcryptjs`, optional `firebase-admin` |
| Real-time | Socket.io 4 |
| Push | Firebase Cloud Messaging (`firebase-admin`) |
| Validation | Joi (with a generic `validate()` middleware) |
| Docs | `swagger-jsdoc` + `swagger-ui-express` (OpenAPI 3.0.3) |
| Security | `helmet`, `cors`, `express-rate-limit`, custom NoSQL-injection sanitiser |
| Logging | `morgan` + a small levelled logger |
| Tests | Jest + Supertest + `mongodb-memory-server` |

---

## Architecture

Layered and modular — a request flows in one direction only:

```
HTTP request
   │
   ├─ helmet · cors · body parser · sanitize · morgan · rate limit
   │
   ├─ routes/          path + HTTP method → middleware chain + controller
   ├─ middleware/      authenticate (JWT) → authorize (role) → validate (Joi)
   ├─ controllers/     parse the request, call a service, shape the response
   ├─ services/        business logic, RBAC/ownership checks, DB writes, emits
   ├─ models/          Mongoose schemas, hooks, indexes
   └─ utils/           ApiError · ApiResponse · pagination · rbac · socketRegistry
```

**Key rules**

1. **Controllers never touch models directly.** All business logic lives in `services/`.
2. **Every service method that reads or writes a resource calls `access.service.js` first**
   — `assertProjectAccess`, `assertTaskAccess`, `assertProjectManage`, `resolveTaskWriteScope`.
   Roles alone are never enough: the caller must also own, lead or belong to the resource.
3. **Socket emits happen after the write succeeds**, from the service layer, through
   `utils/socketRegistry.js`. That module holds a module-level `io` reference, so services
   never import the socket server (no circular dependency) and emits become no-ops when no
   server is attached (as in tests that don't need sockets).
4. **Push is fired through `notification.service.js`**, which always emits to the user's
   socket room *and* sends FCM, swallowing any Firebase failure after logging it.

```
src/
  config/      env (Joi-validated) · db · logger · firebase (lazy, optional) · swagger
  middleware/  authenticate · authorize · validate · sanitize · rateLimit · error · notFound
  models/      user · team · project · task · comment · timeEntry
  controllers/ one per resource
  services/    business logic + access.service (ownership/RBAC) + notification.service
  routes/      express routers, each carrying its @swagger JSDoc
  sockets/     auth (JWT handshake) · rooms · handlers · index
  utils/       ApiError · ApiResponse · asyncHandler · jwt · pagination · projectProgress · rbac · socketRegistry
  validators/  Joi schemas per resource
scripts/seed.js
tests/         auth · rbac · task · socket · flow (+ setup/)
docs/          TaskFlow.postman_collection.json
```

---

## Setup

**Requirements:** Node.js 18+ (20+ recommended), MongoDB 6+ (local, Docker or Atlas).

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env
#    then set MONGODB_URI and a strong JWT_SECRET:
#    openssl rand -hex 32

# 3. Start MongoDB if it isn't already running
#    macOS:  brew services start mongodb-community
#    Docker: docker run -d -p 27017:27017 --name mongo mongo:7

# 4. Create demo data (optional but recommended)
npm run seed

# 5. Run it
npm run dev
```

Open <http://localhost:5000/api/docs>. The only two variables you must set are
`MONGODB_URI` and `JWT_SECRET`; everything else has a working default.

From there: click **Sign in as lead**, then work down the ten steps in the guide below the
UI — every request body is already filled in, and the guide says what each step should
return. **Reset the data** at any point with `npm run seed`.

> **Port 5000 already in use?** On macOS the AirPlay Receiver (ControlCenter) holds 5000 by
> default, so the server exits with `EADDRINUSE`. Set `PORT=5001` in `.env` (or turn AirPlay
> Receiver off in System Settings → General → AirDrop & Handoff). The server logs which port
> to try and exits non-zero, so a failed bind is never mistaken for a clean shutdown.

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `production` \| `test` |
| `PORT` | no | `5000` | HTTP port |
| `API_PREFIX` | no | `/api` | Prefix for all REST routes |
| `PUBLIC_URL` | no | *(derived)* | Base URL for "Try it out" in the docs. Blank = use the request's own host — the right answer behind Render/Heroku. Set it only if a proxy rewrites the origin the browser sees |
| `DOCS_DEMO_MODE` | no | `true` (`false` in production) | Publish the seeded demo accounts, their password and the guided walkthrough on `/api/docs` |
| `MONGODB_URI` | **yes** | — | Mongo connection string |
| `JWT_SECRET` | **yes** | — | Signing key, ≥ 16 chars. `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | no | `7d` | Token lifetime (`15m`, `7d`, …) |
| `JWT_ISSUER` | no | `taskflow` | `iss` claim, validated on verify |
| `JWT_AUDIENCE` | no | `taskflow-api` | `aud` claim, validated on verify |
| `BCRYPT_SALT_ROUNDS` | no | `12` | bcrypt cost (`4` auto-set in tests) |
| `CORS_ORIGIN` | no | `*` | Comma-separated allowlist, or `*` |
| `RATE_LIMIT_WINDOW_MS` | no | `900000` | Global limiter window (ms) |
| `RATE_LIMIT_MAX` | no | `100` | Requests per window per IP |
| `AUTH_RATE_LIMIT_MAX` | no | `10` | Requests per window on `/api/auth` |
| `JSON_BODY_LIMIT` | no | `1mb` | Max request body size |
| `LOG_LEVEL` | no | `info` | `error` \| `warn` \| `info` \| `debug` |
| `FIREBASE_PROJECT_ID` | no | — | Firebase admin credential (option A) |
| `FIREBASE_CLIENT_EMAIL` | no | — | Firebase admin credential (option A) |
| `FIREBASE_PRIVATE_KEY` | no | — | Private key, keep the `\n` escapes (option A) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | no | — | Path to a service-account JSON file (option B, takes precedence) |
| `USE_IN_MEMORY_DB` | no | `1` | Set `0` to skip the `mongodb-memory-server` download |

Leave every `FIREBASE_*` variable blank to run without push notifications or Firebase
login. The server logs one warning at boot and keeps working — nothing crashes.

`src/config/env.js` validates all of this with Joi at startup and refuses to boot on a bad
value, so a misconfiguration is a clear message at boot rather than a 500 later.

---

## Running

| Command | What it does |
| --- | --- |
| `npm run dev` | nodemon, restarts on change |
| `npm start` | plain `node src/server.js` (production) |
| `npm run seed` | Wipe and recreate demo data |
| `npm run seed -- --keep` | Seed without wiping existing data |
| `npm test` | Full Jest suite (in-memory Mongo) |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:coverage` | Jest with a coverage report |

Useful URLs once running:

| URL | What |
| --- | --- |
| `GET /health` | Liveness — DB state, whether Firebase is enabled, uptime |
| `GET /api/health` | Same, behind the API prefix |
| `GET /api/docs` | Swagger UI plus the testing guide |
| `GET /api/docs/guide.js` | The guide's script (loaded by the docs page) |
| `GET /api/docs.json` | Raw OpenAPI document |

---

## Seeding

`npm run seed` wipes the collections and creates a small but realistic dataset:

| Email | Role | Password |
| --- | --- | --- |
| `admin@taskflow.dev` | admin | `Passw0rd!` |
| `lead@taskflow.dev` | lead | `Passw0rd!` |
| `lead2@taskflow.dev` | lead | `Passw0rd!` |
| `member@taskflow.dev` | member | `Passw0rd!` |
| `member2@taskflow.dev` | member | `Passw0rd!` |
| `member3@taskflow.dev` | member | `Passw0rd!` |

Plus a "Platform" team, two projects (APO, ATL), six tasks spanning every status
(including one deliberately overdue), comments, a task dependency and a completed time
entry. The script prints the credentials when it finishes.

---

## Testing

```bash
npm test
```

```
Test Suites: 7 passed, 7 total
Tests:       118 passed, 118 total
```

Tests run against a real MongoDB started in memory by `mongodb-memory-server` — no
external database needed, and nothing is written to your dev database.

| Suite | Covers |
| --- | --- |
| `tests/auth.test.js` | Register, login, duplicate email, weak password, JWT issue/verify, `/me`, token rejection, password-hash leakage, the graceful 503 when Firebase is unconfigured |
| `tests/rbac.test.js` | Member/lead/admin boundaries, ownership checks, cross-project isolation, demotion taking effect immediately |
| `tests/task.test.js` | Task CRUD, assignment rules, status/progress sync, dependency validation and cycles, every filter, pagination, sorting, cascade delete |
| `tests/socket.test.js` | JWT handshake rejection, room joins, and delivery of `task:created` / `task:updated` / `task:assigned` / `comment:added` / `task:deleted` / `notification` |
| `tests/project.test.js` | Project listing with the progress report, visibility scoping, the overdue/null-deadline boundary, Gantt bars with dependency edges |
| `tests/docs.test.js` | The OpenAPI document and the guide under Swagger UI — every operation has an id and a role label, every body an example, and the demo password never renders in production |
| `tests/flow.test.js` | The 13-step acceptance flow from `PLAN.md` §11, end to end |

`tests/setup/jest.environment.js` works around Node ≥ 22 exposing `localStorage` as an
accessor that throws without `--localstorage-file`; it is wired up as `testEnvironment` in
`jest.config.js`.

---

## API summary

All responses share one envelope. Success:

```json
{ "success": true, "message": "…", "data": { }, "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }
```

Failure:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "details": [{ "field": "title", "message": "…" }] } }
```

Codes: `BAD_REQUEST` (400) · `VALIDATION_ERROR` (422) · `UNAUTHORIZED` (401) ·
`FORBIDDEN` (403) · `NOT_FOUND` (404) · `CONFLICT` (409) · `RATE_LIMITED` (429) ·
`SERVICE_UNAVAILABLE` (503) · `INTERNAL_ERROR` (500).

`422` means a field failed validation and carries a `details` array; `400` means the
request itself was malformed (unparseable JSON, an uncastable id, a business rule such as a
deadline before a start date).

### Auth

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | public | Create an account (always `member`), optional `fcmToken` |
| POST | `/api/auth/login` | public | Email+password or `firebaseToken`, optional `fcmToken` |
| POST | `/api/auth/firebase` | public | Exchange a Firebase ID token for a JWT |
| GET | `/api/auth/me` | any | Current user |
| PATCH | `/api/auth/me` | any | Update name/avatar, register an `fcmToken` |
| POST | `/api/auth/logout` | any | Unregister a device token |

### Projects

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/projects` | any | Projects you can see, each with a progress report |
| POST | `/api/projects` | lead, admin | Create (creator becomes owner) |
| GET | `/api/projects/:id` | member of it | Project detail |
| PUT | `/api/projects/:id` | owner, admin | Update |
| DELETE | `/api/projects/:id` | owner, admin | Delete, cascading to tasks |
| POST | `/api/projects/:id/members` | owner, admin | Add members |
| DELETE | `/api/projects/:id/members/:userId` | owner, admin | Remove a member |
| GET | `/api/projects/:id/progress` | member of it | Progress report |
| GET | `/api/projects/:id/gantt` | member of it | Gantt bars + dependency edges |

### Tasks

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/tasks` | any | Filter, search, sort, paginate |
| POST | `/api/tasks` | lead, admin | Create, optionally assigned |
| GET | `/api/tasks/:id` | project member | Detail |
| PUT | `/api/tasks/:id` | lead/admin, or assignee (`status`/`progress` only) | Update |
| DELETE | `/api/tasks/:id` | lead, admin | Delete + cascade |
| POST | `/api/tasks/:id/time/start` | assignee | Start a timer |
| POST | `/api/tasks/:id/time/stop` | timer owner | Stop it |
| GET | `/api/tasks/:id/time` | project member | Entries + totals |
| GET | `/api/time/summary` | any | Totals grouped by user or task |

Task filters: `project`, `assignee`, `status`, `priority`, `dueBefore`, `tags`, `mine`,
`overdue`, `search`, `page`, `limit`, `sort`.

### Comments

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| POST | `/api/comments` | project member | Add a comment (`parent` for a reply) |
| GET | `/api/comments` | any | List, filterable by `task` / `author` |
| GET | `/api/comments/task/:id` | project member | The thread for a task, replies nested |
| GET | `/api/comments/:id` | project member | One comment |
| PUT | `/api/comments/:id` | author, admin | Edit |
| DELETE | `/api/comments/:id` | author, project lead, admin | Delete (cascades to replies) |

### Teams

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/teams` | any | Teams you belong to (all, for admin) |
| POST | `/api/teams` | lead, admin | Create (creator becomes lead) |
| GET | `/api/teams/:id` | member of it | Detail |
| PUT | `/api/teams/:id` | team lead, admin | Update / change membership |
| DELETE | `/api/teams/:id` | admin | Delete |

### Admin

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/admin/users` | admin | All users, filter by role/status |
| GET | `/api/admin/users/:id` | admin | One user |
| PATCH | `/api/admin/users/:id/role` | admin | Change role |
| PATCH | `/api/admin/users/:id/status` | admin | Activate / deactivate |
| GET | `/api/admin/projects` | admin | All projects, any owner |
| GET | `/api/admin/stats` | admin | Platform counts |

`GET /health` is unauthenticated. Everything else needs `Authorization: Bearer <jwt>`.

---

## Roles and permissions

| Capability | Member | Lead | Admin |
| --- | :---: | :---: | :---: |
| View projects they belong to | ✅ | ✅ | ✅ (all) |
| View / update tasks assigned to them | ✅ (`status`, `progress`) | ✅ | ✅ |
| Comment on tasks they can see | ✅ | ✅ | ✅ |
| Track time on their tasks | ✅ | ✅ | ✅ |
| Create / update projects | ❌ | ✅ (own) | ✅ |
| Create / update / assign tasks | ❌ | ✅ (project scope) | ✅ |
| Manage project members | ❌ | ✅ (own) | ✅ |
| Create teams, manage own team | ❌ | ✅ | ✅ |
| Delete projects / teams | ❌ | owner only | ✅ |
| `/api/admin/*`, role management | ❌ | ❌ | ✅ |

**Role is only half the check.** A lead cannot edit someone else's project, and a member
cannot edit a task that isn't theirs even with a valid token — `access.service.js` verifies
ownership and membership *in addition to* the role, and returns 403 (not 404) with a
message naming the rejected field when a member sends a field they may not change.

---

## Real-time events

Connect with `socket.io-client` and a JWT in the handshake:

```js
const socket = io('http://localhost:5000', { auth: { token: jwt } });

socket.on('connected', ({ user, rooms }) => console.log('joined', rooms));
socket.on('task:assigned', (payload) => console.log(payload));
```

An invalid or missing token is rejected during the handshake (`connect_error`) — the socket
never joins a room it isn't entitled to.

**Rooms** — a socket is joined automatically at handshake from database state, and kept in
sync when memberships change:

| Room | Who is in it |
| --- | --- |
| `user:<userId>` | That user's own sockets, on every device |
| `project:<projectId>` | Owner + members |
| `team:<teamId>` | Team lead + members |

**Client → server**

| Event | Payload | Description |
| --- | --- | --- |
| `join:project` | `projectId` | Join a project room you belong to (acked) |
| `leave:project` | `projectId` | Leave it |
| `join:team` | `teamId` | Join a team room you belong to |
| `leave:team` | `teamId` | Leave it |
| `typing:start` / `typing:stop` | `{ projectId, taskId }` | Ephemeral typing indicator |
| `whoami` | — | Acked with the authenticated socket user |

**Server → client**

| Event | Payload | Emitted when |
| --- | --- | --- |
| `connected` | `{ user, rooms }` | Handshake accepted |
| `task:created` | `{ task, actorId }` | A task is created in your project |
| `task:updated` | `{ task, changes, previousStatus, actorId }` | Any task field changes — including a status change |
| `task:deleted` | `{ taskId, projectId, actorId }` | A task is deleted |
| `task:assigned` | `{ task, to, from, actorId }` | A task is assigned or reassigned to you |
| `comment:added` | `{ comment, taskId, actorId }` | A comment lands on a task you can see |
| `comment:updated` / `comment:deleted` | `{ comment }` / `{ commentId, taskId }` | A comment is edited or removed |
| `project:updated` / `project:deleted` | `{ project }` / `{ projectId }` | A project you belong to changes |
| `team:updated` / `team:deleted` | `{ team }` / `{ teamId }` | Your team changes |
| `notification` | `{ type, title, body, taskId, … }` | The same event that was pushed via FCM |

Emits always happen **after** the database write has succeeded, from the service layer —
so a client that reacts to `task:updated` by re-reading the task always sees the new state.
When a user is in both the project room and their own user room, they receive the event
once: the registry emits with a chained `io.to(roomA).to(roomB)`, whose union semantics
de-duplicate delivery.

---

## Push notifications

Firebase Cloud Messaging, wired through `notification.service.js`. Each notification goes
out on both channels — the socket room and FCM — and returns
`{ socket, sent, failed, pruned, skipped }`.

| Trigger | Recipient |
| --- | --- |
| Task assigned or reassigned | The new assignee |
| Task deadline changed | The assignee |
| New comment on a task | The assignee and the task creator (minus the author) |
| `@email` mention in a comment | The mentioned project member |
| Added to a project or team | The added user |

**Graceful degradation is the point.** With no `FIREBASE_*` credentials, `config/firebase.js`
logs a single warning at boot, `isFirebaseEnabled()` stays `false` and every push is skipped
— the API keeps working and no request fails. A device token FCM reports as permanently
invalid (`messaging/registration-token-not-registered`, `messaging/invalid-registration-token`,
…) is pulled from the user's `fcmTokens`, so dead tokens don't accumulate.

To enable it, download a service-account key from the Firebase console and either point
`FIREBASE_SERVICE_ACCOUNT_PATH` at the JSON file or fill in the `FIREBASE_PROJECT_ID` /
`FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` triple. `GET /health` shows the current
state in its `firebase` field.

---

## Example user flow

The acceptance script from `PLAN.md` §11, automated in `tests/flow.test.js`. The same thing
by hand, with `curl`:

```bash
# 1. A lead signs in and registers a device for push
TOKEN=$(curl -s localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"lead@taskflow.dev","password":"Passw0rd!","fcmToken":"demo-device"}' \
  | jq -r .data.token)

# 2. Create a project
PID=$(curl -s localhost:5000/api/projects -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"TaskFlow Launch","key":"TFL","status":"active"}' | jq -r .data.id)

# 3. Add a member  (get their id from /api/admin/users as an admin, or from the seed output)
curl -s localhost:5000/api/projects/$PID/members -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"members":["<memberId>"]}'

# 4. Create a task assigned to them — the assignee gets task:created + task:assigned + a push
TID=$(curl -s localhost:5000/api/tasks -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Wire the deploy pipeline\",\"project\":\"$PID\",\"assignedTo\":\"<memberId>\",\"priority\":\"high\",\"deadline\":\"2026-12-01T00:00:00.000Z\"}" \
  | jq -r .data.id)

# 5. Move it along — everyone in the project room receives task:updated
curl -s -X PUT localhost:5000/api/tasks/$TID -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"in-progress","progress":35}'

# 6. Comment on it — the assignee and creator get comment:added + a push
curl -s localhost:5000/api/comments -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"task\":\"$TID\",\"body\":\"Deploy target is Render — @member@taskflow.dev please confirm env vars.\"}"

# 7. Read the project progress report
curl -s localhost:5000/api/projects/$PID/progress -H "Authorization: Bearer $TOKEN" | jq .data
```

Step 7 returns the report the spec asks for:

```json
{
  "totalTasks": 1,
  "completed": 0,
  "inProgress": 1,
  "review": 0,
  "todo": 0,
  "overdue": 0,
  "completionPercentage": 0,
  "averageProgress": 35,
  "byPriority": { "low": 0, "medium": 0, "high": 1, "critical": 0 }
}
```

Mark the task `done` (`PUT /api/tasks/$TID -d '{"status":"done"}'`) and the same report
reports `completed: 1`, `completionPercentage: 100` — progress is derived from status.

---

## Deployment

### Render (recommended — `render.yaml` is included)

1. Push this repository to GitHub.
2. Create a MongoDB database — [MongoDB Atlas](https://www.mongodb.com/atlas) has a free
   tier. Create a database user and copy the connection string; append the database name
   (`…/taskflow?retryWrites=true&w=majority`).
3. In Render: **New → Blueprint**, pick the repository. Render reads `render.yaml` and
   shows the `taskflow-api` web service.
4. Fill in the environment variables it prompts for:
   - `MONGODB_URI` — the Atlas connection string
   - `JWT_SECRET` — `openssl rand -hex 32`
   - `CORS_ORIGIN` — your front-end origin, e.g. `https://app.example.com`
   - `FIREBASE_*` — only if you want push. Leave blank otherwise.
5. Click **Apply**. The first deploy installs dependencies and starts the service.
6. Confirm it: `curl https://<your-service>.onrender.com/health` should return
   `{"success":true,"data":{"status":"ok","database":"connected",…}}`.
7. Seed the production database once from your machine — **this wipes that database**:
   ```bash
   MONGODB_URI="<atlas-uri>" npm run seed
   ```
   Skip it if you're not using the demo dataset; registration and login still work.
8. Swagger UI is live at `https://<your-service>.onrender.com/api/docs`. `Try it out` posts
   to the host serving the page, so it works on Render with no extra configuration.
9. Under **Settings → Deploy**, confirm auto-deploy is on `main` if you want pushes to ship.

#### Making the deployed docs page fully clickable

The docs page has two halves: the endpoint reference (always on) and the guided demo, which
lets a visitor sign in with one click and then use every route. The demo half appears only
when the server says the demo accounts exist — `/health` reports this as `docsDemo`.

- **Showing the demo on a real deployment.** `DOCS_DEMO_MODE` defaults to on outside
  production and off inside it, so a production host shows the reference only. To turn the
  demo on there, seed the database (step 7) and then set `DOCS_DEMO_MODE=true` on the
  service — Render's **Environment** tab, or a `value: 'true'` in `render.yaml`. The seeded
  password is then public, which is fine for a demo you're presenting and not for anything
  real.
- **A service created by hand** (Render → New → Web Service, rather than the blueprint) does
  not read `render.yaml`, so set its variables yourself: `NODE_ENV=production` (otherwise
  error responses include stack traces), plus the required `MONGODB_URI` and `JWT_SECRET`.
- **A `501`/`404` from a cold start.** The free plan sleeps after 15 minutes idle; the first
  request takes 30-60 seconds. `/health` is the warm-up call.

Render injects `PORT` itself; `src/server.js` reads it, so don't set it manually.

### Heroku (a `Procfile` is included as the alternative)

```bash
heroku create taskflow-api
heroku config:set MONGODB_URI="<atlas-uri>" \
                  JWT_SECRET="$(openssl rand -hex 32)" \
                  NODE_ENV=production \
                  CORS_ORIGIN="https://app.example.com"
git push heroku main
heroku logs --tail
heroku open
```

`Procfile` — `web: node src/server.js`. Heroku also injects `PORT`.

### Anywhere else (Docker, Railway, Fly.io, a VPS)

```bash
npm ci --omit=dev
NODE_ENV=production npm start
```

Set `MONGODB_URI`, `JWT_SECRET` and `CORS_ORIGIN` at minimum, terminate TLS in front of the
process, and let the platform provide `PORT`. The server handles `SIGTERM`/`SIGINT` with a
graceful shutdown (it stops accepting connections, closes the socket server and the Mongo
connection, and force-exits after 10s).

### Production checklist

- [ ] `JWT_SECRET` is long, random and not the example value
- [ ] `NODE_ENV=production` (turns off debug stack traces in error responses)
- [ ] `CORS_ORIGIN` lists real origins instead of `*`
- [ ] `BCRYPT_SALT_ROUNDS=12`
- [ ] MongoDB Atlas network access restricted; the connection string is the SRV form
- [ ] Firebase credentials set if you want push — otherwise confirm `/health` says `firebase: false`
- [ ] `/api/docs` shows the reference only (`docsDemo: false`) unless you deliberately want the demo accounts public
- [ ] The admin account's password changed away from the seed default

---

## Project layout

```
.
├── PLAN.md                  architecture, schema, endpoint table, RBAC matrix, socket plan
├── progress.md              phase checklist and changelog
├── README.md
├── render.yaml              Render blueprint
├── Procfile                 Heroku process definition
├── .env.example             every supported variable, documented
├── docs/
│   └── TaskFlow.postman_collection.json
├── scripts/seed.js
├── tests/
└── src/
    ├── docs/                Swagger theme + the guide rendered under the UI
    └── config/              env, db, logger, firebase, swagger, request examples
```

## License

MIT — see [LICENSE](LICENSE).
