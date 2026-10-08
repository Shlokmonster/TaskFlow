# TaskFlow — Task Management Backend · PLAN

**Status:** PLAN COMPLETE — awaiting "go" before any code is written.
**Stack:** Node.js (LTS) · Express · MongoDB/Mongoose · JWT + Firebase Auth · Socket.io · FCM · Joi · Swagger · Jest/Supertest.

---

## 1. Architecture

Layered, modular monolith. Strict one-way dependency flow:

```
routes → controllers → services → models
                ↘  utils / sockets (registry) / config
middleware sits between routes and controllers
```

- **Controllers** only parse `req`, call a service, and shape the HTTP response. No business logic, no direct model access where a service exists.
- **Services** own all business rules, ownership/membership checks, DB writes, and **all Socket.io / FCM emission** (post-successful-write only).
- **Models** own schema, indexes, virtuals, and document-level hooks.
- **Sockets** module exposes a registry singleton (`getIO()`, `emitToUser`, `emitToProject`, `emitToTeam`) so services never import `server.js` and there are no circular imports. Registry is a no-op when `io` is unset (tests, CLI).
- **Config** is validated once at boot (`config/env.js`); missing required vars fail fast, optional integrations (Firebase) degrade gracefully.

### Folder structure

```
Aashu_Node/
├── src/
│   ├── app.js                  # express app only (no listen) — Swagger, security, routes, errors
│   ├── server.js               # http server + socket.io + db connect + graceful shutdown
│   ├── config/
│   │   ├── env.js              # dotenv load + schema validation + typed export
│   │   ├── db.js               # mongoose connect/disconnect, connection events
│   │   ├── firebase.js         # lazy firebase-admin init, isFirebaseEnabled(), verifyIdToken()
│   │   ├── swagger.js          # swagger-jsdoc definition + /api/docs mount
│   │   └── logger.js           # leveled logger + morgan stream
│   ├── models/
│   │   ├── user.model.js
│   │   ├── project.model.js
│   │   ├── task.model.js
│   │   ├── comment.model.js
│   │   ├── team.model.js
│   │   ├── timeEntry.model.js
│   │   └── index.js
│   ├── validators/
│   │   ├── common.validator.js # objectId, pagination, dateRange primitives
│   │   ├── auth.validator.js
│   │   ├── project.validator.js
│   │   ├── task.validator.js
│   │   ├── comment.validator.js
│   │   ├── team.validator.js
│   │   └── timeEntry.validator.js
│   ├── middleware/
│   │   ├── authenticate.js     # JWT Bearer → req.user
│   │   ├── authorize.js        # authorize(...roles)
│   │   ├── validate.js         # validate({ body, query, params }) via Joi
│   │   ├── sanitize.js         # NoSQL-injection scrub of body/query/params
│   │   ├── rateLimit.js        # global + auth-specific limiters
│   │   ├── notFound.js
│   │   └── error.js            # centralized error handler + 404
│   ├── services/
│   │   ├── auth.service.js
│   │   ├── project.service.js
│   │   ├── task.service.js
│   │   ├── comment.service.js
│   │   ├── team.service.js
│   │   ├── admin.service.js
│   │   ├── timeEntry.service.js
│   │   └── notification.service.js   # FCM send + token hygiene, swallows failures
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── project.controller.js
│   │   ├── task.controller.js
│   │   ├── comment.controller.js
│   │   ├── team.controller.js
│   │   ├── admin.controller.js
│   │   └── timeEntry.controller.js
│   ├── routes/
│   │   ├── index.js            # mounts all routers under /api
│   │   ├── auth.routes.js
│   │   ├── project.routes.js
│   │   ├── task.routes.js
│   │   ├── comment.routes.js
│   │   ├── team.routes.js
│   │   ├── admin.routes.js
│   │   └── timeEntry.routes.js
│   ├── sockets/
│   │   ├── index.js            # initSockets(server) → registry
│   │   ├── auth.js             # JWT handshake middleware
│   │   ├── rooms.js            # room naming + join/leave + membership re-validation
│   │   └── handlers.js         # client→server events (join/leave/typing)
│   └── utils/
│       ├── ApiError.js         # AppError with statusCode + code + details
│       ├── ApiResponse.js      # ok() / created() / paginated() envelope
│       ├── asyncHandler.js     # promise wrapper, forwards to next(err)
│       ├── jwt.js              # sign/verify access token, expiry config
│       ├── pagination.js       # page/limit/sort/parse → skip/limit/sortObj
│       ├── rbac.js             # can.* policy helpers + membership checks
│       ├── socketRegistry.js   # io singleton + typed emit helpers
│       └── projectProgress.js  # aggregation builder for progress reports
├── scripts/seed.js
├── tests/
│   ├── setup/ (globalSetup, db.js, helpers.js)
│   ├── auth.test.js  rbac.test.js  task.test.js  project.test.js
│   ├── socket.test.js  flow.test.js
├── docs/TaskFlow.postman_collection.json
├── .env.example  .gitignore  LICENSE  README.md  render.yaml  Procfile
├── jest.config.js
├── PLAN.md  progress.md
```

---

## 2. Mongoose schemas

Conventions: `timestamps: true` everywhere, `toJSON` strips `__v` and never leaks `password`, all refs are `ObjectId` with explicit `ref`, all enum values lowercase-kebab.

### User
| Field | Type | Notes |
|---|---|---|
| name | String, required, trim, 2–80 | |
| email | String, required, unique, lowercase, trim | |
| password | String, `select: false`, bcrypt(cost 12) | absent for pure-Firebase accounts |
| firebaseUid | String, unique sparse | set when linked via Firebase |
| role | String enum `member\|lead\|admin`, default `member` | |
| avatarUrl | String | |
| fcmTokens | [String] | de-duped, max 10, capped by `$slice` on save |
| isActive | Boolean, default true | inactive users cannot authenticate |
| lastLoginAt | Date | |

Indexes: `email` (unique), `firebaseUid` (unique sparse), `role`.
Hooks: `pre('save')` hash password when modified; `pre('save')` trim `fcmTokens`; method `comparePassword()`.
> **Decision:** team membership lives only on `Team.members` (single source of truth) — no `User.teams` array to avoid dual-write drift. Project membership lives on `Project.members`.

### Team
| Field | Type | Notes |
|---|---|---|
| name | String, required, unique | |
| description | String | |
| lead | ObjectId → User, required | |
| members | [{ user: ObjectId → User, role: `member\|lead`, joinedAt: Date }] | |
| projects | [ObjectId → Project] | |
| isActive | Boolean, default true | |

Indexes: `name` (unique), `lead`, `members.user`.

### Project
| Field | Type | Notes |
|---|---|---|
| name | String, required, trim, 3–120 | |
| key | String, required, unique, uppercase, 2–10 | short code, e.g. `TF` |
| description | String | |
| status | String enum `planning\|active\|on-hold\|completed\|archived`, default `planning` | |
| owner | ObjectId → User, required | |
| team | ObjectId → Team | optional |
| members | [ObjectId → User] | owner is always implicitly a member |
| startDate / endDate | Date | `endDate >= startDate` validated |
| tags | [String] | |

Indexes: `key` (unique), `owner`, `members`, `team`, `status`, compound `{ status, endDate }`, text index on `name + description + tags`.

### Task
| Field | Type | Notes |
|---|---|---|
| title | String, required, trim, 3–160 | |
| description | String | |
| project | ObjectId → Project, required | |
| assignedTo | ObjectId → User \| null | |
| createdBy | ObjectId → User, required | |
| status | String enum `todo\|in-progress\|review\|done`, default `todo` | |
| priority | String enum `low\|medium\|high\|critical`, default `medium` | |
| startDate | Date | defaults to `createdAt` for Gantt |
| deadline | Date | must be `>= startDate` |
| progress | Number 0–100, default 0 | auto-forced to 100 when status → `done`, 0 when back to `todo` |
| dependencies | [ObjectId → Task] | same project, no self-ref, no direct cycle |
| tags | [String] | |
| estimatedHours | Number ≥ 0 | |
| completedAt | Date | set/cleared on status transitions |

Indexes: `{ project: 1, status: 1 }`, `{ assignedTo: 1, status: 1 }`, `{ project: 1, assignedTo: 1 }`, `deadline`, `status`, `dependencies`, text index on `title + description + tags`.
Hooks: `pre('save')` status↔progress/completedAt sync.

### Comment
| Field | Type | Notes |
|---|---|---|
| task | ObjectId → Task, required | |
| author | ObjectId → User, required | |
| body | String, required, 1–2000 | |
| parent | ObjectId → Comment \| null | one level of threading |
| mentions | [ObjectId → User] | parsed from `@name` |
| editedAt | Date | set on update |

Indexes: `{ task: 1, createdAt: -1 }`, `author`, `parent`.

### TimeEntry (optional feature)
| Field | Type | Notes |
|---|---|---|
| task | ObjectId → Task, required | |
| user | ObjectId → User, required | |
| startedAt | Date, required | |
| endedAt | Date | null while running |
| durationSeconds | Number | computed on stop |
| note | String | |

Indexes: `{ task: 1, user: 1 }`, `{ user: 1, startedAt: -1 }`, partial unique `{ user: 1, endedAt: 1 }` where `endedAt: null` → **one running timer per user**.

### Relationships
```
User 1─* Project(owner)      User *─* Project(members)
User 1─* Team(lead)          User *─* Team(members)
Project 1─* Task             Task *─* Task(dependencies, self-ref)
User 1─* Task(assignedTo)    User 1─* Task(createdBy)
Task 1─* Comment             User 1─* Comment(author)
Task 1─* TimeEntry           User 1─* TimeEntry
Team 1─* Project
```

---

## 3. Endpoint table

Base: `/api`. Auth = `Bearer <jwt>`. **Visibility** column shows the resource-level check applied *in addition to* the role check.

### Auth
| Method | Path | Role | Visibility | Description |
|---|---|---|---|---|
| POST | `/api/auth/register` | public | — | Register (name, email, password, optional role ignored→`member`, optional `fcmToken`) |
| POST | `/api/auth/login` | public | — | Email/password login; optional `fcmToken` saved; optional `firebaseToken` (Firebase ID token) accepted as an alternative credential |
| POST | `/api/auth/firebase` | public | — | Exchange a Firebase ID token for an app JWT (upserts user by `firebaseUid`/email) |
| GET | `/api/auth/me` | any authed | self | Current user profile |
| PATCH | `/api/auth/me` | any authed | self | Update name/avatar/fcmToken |
| POST | `/api/auth/logout` | any authed | self | Remove the supplied `fcmToken` from the account |

### Projects
| Method | Path | Role | Visibility | Description |
|---|---|---|---|---|
| GET | `/api/projects` | member+ | member/lead: own projects · admin: all | List + **progress report per project** (total, completed, in-progress, overdue, completion %). Pagination, `status`/`search` filters |
| GET | `/api/projects/:id` | member+ | must be member (admin: any) | Project detail with members, team, counts |
| GET | `/api/projects/:id/progress` | member+ | member | Standalone progress report |
| GET | `/api/projects/:id/gantt` | member+ | member | **Optional** — tasks with `start`, `end`, `dependencies`, `progress`, project window |
| POST | `/api/projects` | lead, admin | — | Create project (creator becomes owner + member) |
| PUT | `/api/projects/:id` | lead, admin | lead: owner or project member | Update project |
| DELETE | `/api/projects/:id` | lead, admin | lead: owner only | Delete project + cascade tasks/comments/time entries |
| POST | `/api/projects/:id/members` | lead, admin | owner/team lead | Add members |
| DELETE | `/api/projects/:id/members/:userId` | lead, admin | owner/team lead | Remove member |

### Tasks
| Method | Path | Role | Visibility | Description |
|---|---|---|---|---|
| GET | `/api/tasks` | member+ | member: assigned or in own projects · lead/admin: scoped/all | Filters `project, assignee, status, priority, dueBefore, dueAfter, tags, search`; pagination + sorting |
| GET | `/api/tasks/:id` | member+ | member of project / assignee | Task detail (populated) |
| POST | `/api/tasks` | lead, admin | lead: project member | Create task; emits `task:created`, FCM if assigned |
| PUT | `/api/tasks/:id` | member (own task, limited fields), lead, admin | project/ownership | Update; status change ⇒ `task:updated` broadcast; reassignment ⇒ `task:assigned` + FCM; deadline change ⇒ FCM |
| DELETE | `/api/tasks/:id` | lead, admin | lead: project member | Delete + cascade comments/time entries; emits `task:deleted` |
| POST | `/api/tasks/:id/time/start` | member+ | assignee or project member | **Optional** — start timer |
| POST | `/api/tasks/:id/time/stop` | member+ | timer owner | **Optional** — stop timer |
| GET | `/api/tasks/:id/time` | member+ | project member · member: own entries | **Optional** — entries + total for task |
| GET | `/api/time/summary` | member+ | own · admin: all | **Optional** — totals per user/task |

### Comments
| Method | Path | Role | Visibility | Description |
|---|---|---|---|---|
| POST | `/api/comments` | member+ | project member | Add comment; emits `comment:added`; FCM to assignee + task creator |
| GET | `/api/comments` | member+ | scoped to visible tasks | List with `task`, `author`, pagination |
| GET | `/api/comments/task/:id` | member+ | project member | All comments for a task (threaded) |
| PUT | `/api/comments/:id` | author, admin | author | Edit own comment |
| DELETE | `/api/comments/:id` | author, lead, admin | author / project lead | Delete comment |

### Teams
| Method | Path | Role | Visibility | Description |
|---|---|---|---|---|
| GET | `/api/teams` | member+ | member: own teams · admin: all | List teams |
| GET | `/api/teams/:id` | member+ | team member | Team detail |
| POST | `/api/teams` | lead, admin | — | Create team (creator = lead) |
| PUT | `/api/teams/:id` | lead, admin | team lead only | Update team / members |
| DELETE | `/api/teams/:id` | admin | — | Delete team (unlinks projects) |

### Admin
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/admin/users` | admin | Paginated users, `role`/`search` filters, no password |
| GET | `/api/admin/projects` | admin | All projects with owner + progress summary |
| PATCH | `/api/admin/users/:id/role` | admin | Change a user's role |
| PATCH | `/api/admin/users/:id/status` | admin | Activate/deactivate |
| GET | `/api/admin/stats` | admin | Counts: users, projects, tasks by status, overdue |

### Infra
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness (no auth) |
| GET | `/api/health` | Liveness + db state |
| GET | `/api/docs` | Swagger UI |
| GET | `/api/docs.json` | Raw OpenAPI spec |

---

## 4. RBAC matrix

Legend: **A** = allowed, **S** = allowed only for self/own resource, **M** = allowed only with project/team membership, **—** = denied.

| Capability | member | lead | admin |
|---|---|---|---|
| Register / login | A | A | A |
| View own profile / update self | S | S | S |
| View projects | M (member of) | M | A (all) |
| Create project | — | A | A |
| Update project | — | M + owner/member | A |
| Delete project | — | S (owner only) | A |
| Manage project members | — | M + owner/team lead | A |
| View tasks | M + S (assigned / own projects) | M (own projects) | A |
| Create task | — | M | A |
| Update task (full) | — | M | A |
| Update task (status/progress only) | S (assigned to me) | A | A |
| Delete task | — | M | A |
| Assign / reassign task | — | M | A |
| Comment on a task | M | M | A |
| Edit comment | S (author) | S (author) | A |
| Delete comment | S (author) | M (project lead) | A |
| View teams | M (own teams) | M | A |
| Create team | — | A | A |
| Update team | — | S (team lead) | A |
| Delete team | — | — | A |
| Time tracking (own) | S | S | S |
| View others' time entries | — | M | A |
| Admin routes / role management | — | — | A |

Implementation: `authorize('lead','admin')` for the coarse role gate, then **always** a service-level resource check (`assertProjectAccess`, `assertTaskAccess`, `assertTeamAccess`) that is membership/ownership based. Admin bypasses resource checks by design. Never rely on the role alone.

---

## 5. Socket.io

**Handshake auth:** `auth: { token }` or `Authorization: Bearer …`. Missing/invalid ⇒ `next(new Error('unauthorized'))`; no unauthenticated sockets.

**Rooms (joined automatically at connect, from DB state):**
| Room | Joined when |
|---|---|
| `user:<userId>` | always |
| `project:<projectId>` | user is owner or in `members` |
| `team:<teamId>` | user is `lead` or in `members` |

Plus explicit `join:project` / `leave:project` / `join:team` / `leave:team` client events, **re-validated against the DB on every join** (a client can never self-join a room it has no access to). Membership-changing endpoints call `syncUserRooms(userId)` so live sockets are updated.

**Server → client events** (emitted only after a successful DB write, from the service layer):

| Event | Payload | Emitted to |
|---|---|---|
| `task:created` | `{ task, actorId }` | `project:<id>` |
| `task:updated` | `{ task, changes[], actorId }` | `project:<id>` + `user:<assigneeId>` |
| `task:deleted` | `{ taskId, projectId, actorId }` | `project:<id>` |
| `task:assigned` | `{ task, from, to, actorId }` | `user:<newAssignee>` + `project:<id>` |
| `comment:added` | `{ comment, taskId, actorId }` | `project:<id>` + `user:<assignee>` |
| `project:updated` | `{ project, changes[], actorId }` | `project:<id>` + `team:<id>` |
| `notification` | `{ type, title, body, meta }` | `user:<id>` (mirrors FCM when the socket is live) |

**Client → server:** `join:project`, `leave:project`, `join:team`, `leave:team`, `typing:start` / `typing:stop` (→ `user:<other>` in the same project).
**Ack:** every client event returns `{ ok, error? }`; disconnected users are handled by `disconnecting` → leave all + `presence` broadcast (optional, low cost).

> Emission goes through `utils/socketRegistry.js` (no-op if `io` is null), which is why services stay testable without a live socket server.

---

## 6. FCM notification flow

```
mutation (task assign / reassign / deadline change / new comment)
  → service completes DB write
  → notification.service.notifyUsers({ userIds, type, title, body, data, excludeUserId })
      1. isFirebaseEnabled()?  no → log warn once, return { sent: 0, skipped: true }  (never throws)
      2. load users' fcmTokens (dedupe, drop empty)
      3. messaging().sendEachForMulticast({ tokens, notification, data })
      4. read response: for every index whose error.code is
         messaging/registration-token-not-registered  →  $pull that token from the user
      5. return { sent, failed, pruned }
  → socket `notification` event emitted in parallel for live clients
```

Trigger matrix:
| Trigger | Recipients | Excluded |
|---|---|---|
| Task assigned / reassigned | new assignee | actor |
| Task deadline changed | assignee | actor |
| New comment on a task | task assignee + task creator | comment author |
| Comment mention (`@user`) | mentioned users | comment author |

FCM data payload is string-only (`taskId`, `projectId`, `type`) per the FCM contract. All FCM calls are wrapped so a Firebase outage, bad credentials, or a missing service-account file can never surface as a 500 — the write has already succeeded.

---

## 7. Cross-cutting contracts

**Success envelope**
```json
{ "success": true, "message": "Task created", "data": { … }, "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }
```
**Error envelope**
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "details": [{ "field": "title", "message": "…" }] } }
```
Error codes → status: `VALIDATION_ERROR` 422 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `RATE_LIMITED` 429 · `INTERNAL_ERROR` 500. Mongoose `CastError`→400/`NOT_FOUND`, duplicate key `11000`→409 `CONFLICT`, JWT errors→401.

Pagination defaults: `page=1`, `limit=20`, max `100`. Sorting whitelist per resource (`?sort=-createdAt,title`) — unknown fields rejected by Joi, never passed raw to `.sort()`.

---

## 8. Decisions & deviations (sensible defaults taken instead of asking)

1. **Express 4.21.x** (not 5.x) — the whole ecosystem here (swagger-ui-express, express-rate-limit, supertest patterns) is battle-tested on 4; noted so the version is intentional.
2. **Joi** chosen over express-validator (spec allowed either) — one `validate()` middleware, declarative, reusable primitives.
3. **`express-mongo-sanitize` replaced by a small in-house `sanitize.js`** — the published package mutates `req.query`, which is a getter-only property on Express 4.20+/5 and throws. Our middleware deep-scrubs `$`-prefixed and dotted keys from body/params and rebuilds the query object safely. Same protection, no runtime break.
4. **`Team.members` is the single source of truth** for team membership (no `User.teams` mirror).
5. **Firebase is fully optional at runtime** — no credentials ⇒ warning logged at boot, login-by-Firebase returns a clean 503, push notifications are skipped. Everything else works.
6. **`POST /api/auth/firebase` is added** alongside Firebase-token support inside `/login`, so both flows exist explicitly.
7. **Cascade delete** of tasks/comments/time entries when a project is deleted, and comments/time entries when a task is deleted (small `pre('findOneAndDelete')`-style service-level cleanup in a transaction where the driver supports it; sequential deletes otherwise).
8. **Deletes are hard deletes** (no soft-delete field) — simpler, matches the spec's CRUD wording; `isActive` flags cover users and teams.
9. **Rate limits:** 100 req/15 min per IP globally, 10 req/15 min on `/api/auth/*`.
10. **`progress` is auto-derived from `status`** on transitions (done→100, todo→0) but remains directly settable by leads, so the Gantt view stays honest.
11. **Repo:** a fresh `git init` inside `Aashu_Node` (the folder is empty) so TaskFlow has its own clean conventional-commit history, one commit per phase.
12. **`mongodb-memory-server`** for tests — no external DB needed for `npm test`.

---

## 9. Phase breakdown

**Phase 0 — Plan** 
- [x] PLAN.md written
- [x] progress.md created
- [ ] User "go" received

**Phase 1 — Setup & skeleton**
- [ ] `package.json` (scripts: `dev, start, test, test:watch, seed, lint`), deps installed
- [ ] `.env.example`, `.gitignore`, `LICENSE` (MIT)
- [ ] `config/env.js` (validated), `config/db.js`, `config/logger.js`
- [ ] `utils/`: ApiError, ApiResponse, asyncHandler, pagination
- [ ] `middleware/error.js`, `notFound.js`, `sanitize.js`, `rateLimit.js`
- [ ] `app.js` / `server.js` split, helmet + cors + morgan + json, `/health`
- [ ] Commit: `chore: project setup and base server`

**Phase 2 — Models, auth, RBAC, validation**
- [ ] All 6 models + indexes
- [ ] `utils/jwt.js`, `config/firebase.js`
- [ ] auth service/controller/routes: register, login (+fcmToken), firebase login, me, logout
- [ ] `authenticate`, `authorize`, `validate` middleware
- [ ] Commit: `feat(auth): jwt + firebase authentication with rbac middleware`

**Phase 3 — Projects, Teams, Tasks**
- [ ] CRUD for all three + membership/ownership checks
- [ ] Project progress report aggregation
- [ ] Task filters, pagination, sorting, search, dependency validation
- [ ] Commit: `feat(core): projects, teams and tasks crud with progress reporting`

**Phase 4 — Comments**
- [ ] CRUD, threading, mentions parsing, task-scoped listing
- [ ] Commit: `feat(comments): task comments with threading and mentions`

**Phase 5 — Admin routes**
- [ ] user/project listing, role + status management, stats
- [ ] Commit: `feat(admin): user and project administration endpoints`

**Phase 6 — Socket.io + FCM**
- [ ] socket auth, rooms, handlers, registry
- [ ] service-layer emissions wired to every mutation
- [ ] notification.service + token pruning + graceful degradation
- [ ] Commit: `feat(realtime): socket.io broadcasts and fcm push notifications`

**Phase 7 — Optional features**
- [ ] Gantt API
- [ ] Time tracking start/stop/report/summary
- [ ] Commit: `feat(optional): gantt data and time tracking apis`

**Phase 8 — Docs**
- [ ] swagger-jsdoc annotations on every route + Swagger UI at `/api/docs`
- [ ] Postman collection export
- [ ] README.md (all required sections)
- [ ] Commit: `docs: swagger, postman collection and readme`

**Phase 9 — Tests, deploy, audit**
- [ ] Jest + Supertest + mongodb-memory-server setup
- [ ] auth, RBAC, task CRUD, socket, end-to-end flow tests
- [ ] `render.yaml`, `Procfile`, deploy section in README
- [ ] Example flow verified end to end
- [ ] Commit: `test: integration suite and deployment configuration`

---

## 10. Deliverables checklist

- [ ] REST API with full CRUD for projects, tasks, comments, teams
- [ ] Auth (JWT + Firebase) and RBAC middleware
- [ ] Validation middleware
- [ ] Socket.io real-time server
- [ ] Firebase push notifications
- [ ] Swagger UI at `/api/docs` + `docs/TaskFlow.postman_collection.json`
- [ ] README.md (overview, features, stack, architecture, setup, env table, running, testing, API summary, socket events, deployment, example flow)
- [ ] `.gitignore`, `LICENSE`, conventional-commit history (one commit per phase)
- [ ] `render.yaml` + `Procfile` + step-by-step deploy docs
- [ ] Optional features: Gantt + time tracking
- [ ] Tests: auth, RBAC, task CRUD, example flow
- [ ] Example flow verified end to end

---

## 11. Example flow (acceptance script)

1. `POST /api/auth/register` ×3 → admin, lead, member (or seed).
2. `POST /api/auth/login` (lead) with `fcmToken` → JWT.
3. `POST /api/projects` (lead) → project.
4. `POST /api/projects/:id/members` (lead) → add member.
5. `POST /api/tasks` (lead, `assignedTo: member`) → `task:created` on `project:<id>`, FCM to member, `task:assigned` on `user:<memberId>`.
6. `PUT /api/tasks/:id` (lead, `{ status: 'in-progress' }`) → **`task:updated` broadcast on `project:<id>`**.
7. `POST /api/comments` (member) → `comment:added` + FCM to lead.
8. `GET /api/projects/:id` (lead) → progress report shows `total:1, inProgress:1, completion:0%`.
9. `POST /api/tasks/:id/time/start` → `POST /api/tasks/:id/time/stop` → `GET /api/tasks/:id/time` → totals.
10. `GET /api/projects/:id/gantt` → task with `start`, `end`, `progress`, `dependencies`.
11. Negative checks: member `POST /api/projects` → 403; member `GET /api/admin/users` → 403; member `PUT /api/tasks/:id` on another's task → 403; no token → 401.

