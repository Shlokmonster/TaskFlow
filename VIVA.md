# TaskFlow — Viva / Walkthrough Sheet

> Everything you need to explain this project out loud, demo it live, and survive the
> questions afterwards. Read **Parts 1–3** to prepare, run **Part 8** as your script,
> keep **Part 9** open for the Q&A.

**How to use this sheet**

- `[ ]` marks a blank you should fill in yourself — your name, your reasons, your numbers.
- Parts 1, 5, 9 and 10 are written to be read almost word-for-word.
- Anything in **bold** is worth saying out loud; it is usually the thing the listener is
  quietly checking for.

---

## Part 1 — The 60-second opening

Say this first, before touching a screen. It sets the frame so the demo makes sense.

> "TaskFlow is the backend for a team task manager — the kind of thing that sits behind
> Asana or Jira. It handles users and roles, projects, teams, tasks with dependencies,
> threaded comments, time tracking and a Gantt view.
>
> The part I'd point at is not the CRUD. It's that **every single write goes through four
> gates before it reaches the database**: request sanitisation, authentication, an
> authorisation check that combines *role* with *ownership*, and schema validation —
> and **every write that another person cares about is broadcast live to exactly the
> people entitled to see it**, over Socket.io rooms, plus a push notification.
>
> It's built with Node, Express and MongoDB, it's documented with OpenAPI, there are
> 123 integration tests against a real in-memory MongoDB, and it's deployed on Render —
> I'll show you the live docs page where you can click through the API yourself."

Then go to **Part 8** (the demo). Come back to Parts 3–7 as questions arise.

---

## Part 2 — The problem, and what I chose to build

**The problem it solves:** `[ ]` — one or two sentences in your own words. Suggested shape:
a small team needs to know who is doing what, by when, and what is blocked by what —
and needs their permissions to actually mean something.

**Who it's for:** `[ ]` (a class project? a portfolio piece? a client?)

**Why I chose this instead of a simpler CRUD app:** `[ ]` — suggested: because the
interesting engineering is in the rules, not the routes. Anybody can write `POST /tasks`.
The hard parts are ownership checks, cascade deletes, dependency cycles, and making
real-time delivery respect permissions.

**Scope I deliberately excluded:** file attachments, a front-end UI, multi-tenancy.
Say why: `[ ]`

---

## Part 3 — What was used here (the stack, and *why* each one)

Never list a library without a reason — the reason is the answer they're looking for.

| Layer | What I used | Why this one |
| --- | --- | --- |
| Runtime | **Node.js** (v20+) | Non-blocking I/O suits an API that is mostly waiting on the database; one language across the stack |
| Framework | **Express 4** | Minimal and explicit — middleware order *is* the architecture, which is easy to explain and to test |
| Database | **MongoDB** with **Mongoose 8** | Documents fit tasks-with-embedded-tags-and-dependencies; Mongoose gives schema validation, indexes and population |
| Auth | **jsonwebtoken** (HS256) + **bcryptjs** | Stateless JWT so any instance can verify a request; bcrypt with a cost factor of 12 for passwords |
| Firebase | **firebase-admin** (optional) | Lets a client exchange a Firebase ID token for our JWT — and it's *optional*, the app runs without it |
| Real-time | **Socket.io 4** | Rooms map exactly onto the permission model: `user:`, `project:`, `team:` |
| Push | **Firebase Cloud Messaging** | Reaches a device when the socket is closed |
| Validation | **Joi** | Declarative schemas, one generic `validate()` middleware, and error `details` the client can render per field |
| Docs | **swagger-jsdoc** + **swagger-ui-express** (OpenAPI 3.0.3) | The docs are generated from the route files, so they can't silently drift |
| Security | **helmet**, **cors**, **express-rate-limit**, custom sanitiser | Security headers, an origin allowlist, brute-force throttling, and NoSQL-injection stripping |
| Logging | **morgan** + a levelled logger | HTTP access logs in dev, combined format in production |
| Tests | **Jest** + **Supertest** + **mongodb-memory-server** | Real HTTP calls against a real (in-memory) MongoDB — no mocks of the database |
| Config | **dotenv** + Joi | The app **refuses to boot** on a bad env var instead of failing later |

**The one-sentence summary:** Node + Express + MongoDB, JWT auth, Socket.io for live
updates, FCM for push, Joi for validation, Swagger for docs, Jest for tests.

---

## Part 4 — Architecture: what happens to one request

This is the answer to "walk me through a request". Learn the chain, it comes up every time.

```
Request
  │
  ├─ helmet            security headers
  ├─ cors              origin allowlist
  ├─ express.json      parse body (1mb cap)
  ├─ sanitize          strip $-prefixed and dotted keys  ← NoSQL injection
  ├─ morgan            access log
  ├─ rate limiter      100 req / 15 min per IP (10 on /api/auth)
  │
  ├─ route             routes/*.js
  ├─ authenticate      verify JWT → req.user
  ├─ authorize         role check           ┐
  ├─ access.service    ownership/membership ┘ ← the two together, never role alone
  ├─ validate(Joi)     schema for this endpoint → 422 with per-field details
  │
  ├─ controller        HTTP in, HTTP out only — no business logic
  ├─ service           the actual rules; emits socket events + push *after* the DB write
  ├─ model             Mongoose schema, indexes, hooks
  │
  └─ response envelope { success, message, data, meta? }
        or  ─────────► notFound → error middleware → { success:false, error:{ code, message, details? } }
```

**Why this layering matters (say this):** the controller never touches a model, and the
service never touches `req`/`res`. That's what makes the socket emitters reusable from
both an HTTP request and a background path, and it's why the tests can hit real endpoints
without stubbing the database.

**One design decision worth volunteering:** the socket emit happens **after** the database
write has succeeded. If we emitted first, a client that reacts by re-reading the task
would sometimes read the *old* state — a race that is invisible until it isn't.

---

## Part 5 — RBAC, explained (the thing written as "RBAC")

If they only remember one section, make it this one. **RBAC = Role-Based Access Control.**

**The plain-English version:**

> "There are three roles. A **member** works on tasks assigned to them. A **lead** runs
> projects and teams. An **admin** can do anything. But the role is only half the check —
> a lead still can't edit a project they don't own, and a member can't edit a task that
> isn't theirs, even with a perfectly valid token. The second half is **ownership and
> membership**, and it's checked against the actual document in the database."

**The matrix:**

| Capability | Member | Lead | Admin |
| --- | :---: | :---: | :---: |
| View projects they belong to | ✅ | ✅ | ✅ (all) |
| Update tasks assigned to them | ✅ (`status`, `progress` only) | ✅ | ✅ |
| Comment / track time on visible tasks | ✅ | ✅ | ✅ |
| Create / update projects | ❌ | ✅ (own) | ✅ |
| Create / update / assign tasks | ❌ | ✅ (in their projects) | ✅ |
| Manage project members | ❌ | ✅ (own) | ✅ |
| Create teams, manage own team | ❌ | ✅ | ✅ |
| Delete projects / teams | ❌ | owner only | ✅ |
| `/api/admin/*`, role management | ❌ | ❌ | ✅ |

**Where it lives:** `src/utils/rbac.js` holds the pure predicates (`isAdmin`, `isLead`,
`isProjectOwner`, `isTeamMember`, `sameId`) — no database access, so they're trivial to
reason about. `src/services/access.service.js` does the database-backed assertions
(`assertProjectAccess`, `assertTaskAccess`, `assertTeamManage`, …) and throws `403`.

**Two details that show it's real, not decoration:**

1. A member who sends a forbidden field gets **403 with a message naming the field** —
   not a silent partial update. A silent drop is the classic bug: the client thinks the
   write succeeded.
2. **A demotion takes effect immediately.** Roles are read from the current user document
   on every request, not baked into the JWT's claims for its 7-day life. There's a test
   for exactly this.

**How to demo it:** see step 7 of Part 8. Two tokens, two windows, one 403.

---

## Part 6 — The data model

Six collections. Know the relationships — "how do these fit together" is a guaranteed question.

```
User ──owns──────────► Project ──has───► Task ──has───► Comment
 │                       │                 │              │
 │                       │                 └──dependencies► Task (same project)
 └──leads/member of──► Team ──┘            └──has───► TimeEntry
```

| Model | Holds | Notes |
| --- | --- | --- |
| **User** | name, email, passwordHash, role, avatar, device tokens | `passwordHash` is never returned — stripped at the schema level |
| **Project** | name, unique `key` (e.g. `APO`), status, owner, members, team, dates, tags | Owner + members is what visibility is computed from |
| **Task** | title, project, assignee, status, priority, dates, progress, dependencies, tags | Status `todo → in-progress → review → done`; dependencies must be in the *same* project |
| **Comment** | task, author, body, `parent` (threading), mentions | `@email` mentions resolve to real user documents |
| **Team** | name, lead, members `[{user, role, joinedAt}]` | Membership here is the single source of truth for team sockets |
| **TimeEntry** | task, user, startedAt, endedAt, duration | One running timer per user; stopping computes the duration |

**Indexes:** unique index on `User.email` and `Project.key`; compound indexes on the
fields actually filtered by (`Task`: project+status, assignee+status, deadline).
Ask me why — "because the filters in the API map 1:1 to the index, so the queries that
matter are covered."

**Cascade behaviour:** deleting a project deletes its tasks; deleting a task deletes its
comments and time entries. Implemented deliberately rather than left to orphan.

---

## Part 7 — Feature tour (the one-line inventory)

- **Auth** — register, password login, Firebase token exchange, `PATCH /me`, logout. JWT
  carries `iss`/`aud`/`exp` and both are verified on every request.
- **Projects** — CRUD, membership management, a **progress report** (counts by status,
  overdue, completion %, averages, by-priority) and a **Gantt endpoint** (bars +
  dependency edges).
- **Tasks** — CRUD, assignment, dependencies with **cycle detection**, tags, deadline
  validation, and filters: `status`, `priority`, `assignee`, `project`, `dueBefore`,
  `tags`, `mine`, `overdue`, `search`, plus sorting and pagination.
- **Comments** — threaded replies, mentions, edit/delete with author checks.
- **Teams** — CRUD and membership.
- **Time tracking** — start/stop timers per task, per-task and per-user totals.
- **Admin** — `/api/admin/*`, role changes, user list, require the `admin` role.
- **Real-time** — 13 server→client events (11 domain events plus `connected` and
  `notification`) over `user:` / `project:` / `team:` rooms, joined from database state at
  handshake. An invalid token is rejected **during the handshake**, so a socket never
  joins a room it isn't entitled to.
- **Push** — FCM with dead-token pruning, and it degrades gracefully: no credentials
  means one warning at boot, never a crash.
- **Docs** — every one of the 42 operations has a prefilled body, a role label and a deep
  link; plus a guide underneath the UI, a Postman collection, and a seed script.
- **Tests** — 123 integration tests across 7 suites, no database mocks.

---

## Part 8 — The live demo script

**Target: 8–10 minutes.** Open with Part 1, then follow this.

### Before you start (do this 5 minutes early)

- [ ] Open `https://taskflow-pqe9.onrender.com/health` once to **wake the free-tier dyno**
      — a cold start takes 30–60 seconds and looks like a crash if it happens mid-demo.
- [ ] Confirm the sign-in works: the docs page should say *"Sign in as lead"*. If it
      errors, the demo data isn't seeded on that host (see *If something breaks*, below).
- [ ] Have **two browser windows** ready (lead + member) and one terminal.
- [ ] Know your numbers: **29 paths, 42 operations, 123 tests, 7 suites**.
- [ ] Don't demo the rate limiter unless everything else is done — 10 bad logins locks
      you out of `/api/auth` for 15 minutes.

### The script

| # | Do this | Say this |
| --- | --- | --- |
| 1 | Open `/health` | "First, the server tells you what it is: database connected, Firebase off, whether the demo accounts are published, uptime, environment." |
| 2 | Open `/api/docs` | "This is generated from the route files with swagger-jsdoc, so it can't drift from the code. 29 paths, 42 operations, grouped by tag." |
| 3 | Point at the **role labels** next to each endpoint, then scroll to the guide | "Every endpoint is labelled with who can call it. Underneath is a testing guide written for whoever is holding the API — including the exact order to test it in." |
| 4 | Click **Sign in as lead** | "The page fetches a real JWT and hands it to Swagger UI's Authorize for me. Nothing is mocked." |
| 5 | `GET /api/projects` → **Try it out** → Execute | "Real data from the seeded database — and notice every write body on this page is prefilled, so the first click succeeds instead of failing validation." |
| 6 | `POST /api/tasks` → Execute (body is prefilled) | "Created. Watch the terminal." → the socket watcher prints `task:created`. "That event only went to the project room — the people entitled to see it." |
| 7 | `PUT /api/tasks/{id}` and change `status` | "A status change is the case people get wrong; it broadcasts `task:updated` with the previous status so clients can animate the move." |
| 8 | **Second window:** click **Sign in as member**, then `POST /api/projects` → Execute | **403 FORBIDDEN.** "A valid token, a real user, and still refused — because authorization is role *plus* ownership, not role alone." |
| 9 | As the member, `PUT` a task that isn't theirs with `status` | "403 again — and the message names the field I'm not allowed to change. Not a silent partial update." |
| 10 | `POST /api/tasks` with a deliberately broken body | **422 VALIDATION_ERROR** with a `details` array naming each field. "Validation is Joi, on every write, before it reaches the database." |
| 11 | `GET /api/projects/{id}/progress`, then `/gantt` | "The reporting side: completion percentages, overdue counts, and Gantt bars with dependency edges." |
| 12 | `POST /api/comments` with an `@member@taskflow.dev` mention | "Mentions resolve to real users and trigger their notification." |

### The three moments worth lingering on

1. **The 403 in step 8.** It's the difference between "I wrote routes" and "I built an
   authorization model".
2. **The socket event in step 6.** It proves the write and the broadcast are wired
   together *after* the database write.
3. **The prefilled bodies.** Small thing, big impression: the page is built to be used by
   someone else, not just by me.

### If something breaks

| Symptom | Cause | What to do |
| --- | --- | --- |
| First load hangs ~40s | Render free tier was asleep | Wait, then reload. It's not a bug — say so |
| Sign-in says *"Invalid email or password"* | Demo data missing on that host | The guide says it too: seed with `MONGODB_URI="<uri>" npm run seed -- --keep` |
| Everything 401s | Not signed in | Click **Authorize** and paste a token from `POST /api/auth/login` |
| `429 RATE_LIMITED` | 100 req/15min, 10 on auth | Wait it out, or demo against your local server instead |
| Total failure | — | Fall back to the **Postman collection** (`docs/TaskFlow.postman_collection.json`) and the README — same API, no browser |

**Cleanup:** the demo writes to a real database. Delete the project/task you created, or
say that you're leaving it — either is fine, just don't leave it unexplained.

---

## Part 9 — Question bank

### General / design

**Q: What is this project, in one line?**
A production-style task-management API — the backend for a team task manager — with RBAC,
real-time updates and push notifications.

**Q: Why Node and not Java/Python?**
`[ ]` — suggested: non-blocking I/O fits an API that spends its time waiting on the
database, and one language keeps the whole stack consistent. Also, the ecosystem has
first-class libraries for every piece I needed (Mongoose, Socket.io, swagger-jsdoc).

**Q: Why MongoDB and not SQL?**
Tasks are documents with embedded tags and dependency id arrays, and they're read as a
whole. A relational model would need join tables for things the app never queries
independently. Trade-off I accepted: no multi-document transactions by default — the
cascades are written as ordered deletions instead.

**Q: Walk me through a request.**
Part 4. Middleware chain → auth → authorization → validation → controller → service →
model → event emit → response envelope.

**Q: Why a response envelope instead of raw JSON?**
One shape everywhere: clients parse `success`, `data`, `meta` once. Errors carry a
machine-readable `code` and a per-field `details` array, so the client can render
validation errors without string-matching messages.

**Q: Where does business logic live?**
In `src/services/*`. Controllers are HTTP-only and services never see `req`/`res` — that
separation is what lets socket emitters be reused and keeps the tests honest.

### Authentication & security

**Q: How does auth work?**
`POST /api/auth/login` verifies the bcrypt hash and issues a JWT (HS256) with an
`iss`/`aud`/`exp`. Every protected route runs an `authenticate` middleware that verifies
the signature, the issuer, the audience and the expiry, then loads the current user.

**Q: Where do you store the token?**
Server-side: nowhere — it's stateless. The client holds it.

**Q: How do you store passwords?**
bcrypt, cost factor 12 (4 in tests to keep them fast). **The hash is never returned by any
endpoint** — there's a test that asserts the string `passwordHash` never appears in a
response body.

**Q: What if someone sends `{"email": {"$gt": ""}}`?**
The sanitiser middleware strips `$`-prefixed and dotted keys from bodies, params and
query before anything can hand them to Mongo. I wrote it in-house after
`express-mongo-sanitize` broke on this Express version — that's documented in the README.

**Q: What about brute force?**
100 requests / 15 minutes per IP globally, 10 on `/api/auth`. Behind a proxy like Render
`trust proxy` is on so the limiter sees the real client IP.

**Q: What are the security headers?**
helmet, with a CSP that allows Swagger UI's inline bundle and WebSocket connections.

**Q: Is there anything you know is missing?**
Yes — and say it before they find it: no refresh-token rotation, no email verification, no
account lockout. Part 11 lists them.

### RBAC (expect this one at length)

**Q: What is RBAC?**
Role-Based Access Control. Permissions attach to roles — `member`, `lead`, `admin` — rather
than to individual users.

**Q: Is role enough?**
No, and that's the point. Role is checked **together with** ownership/membership against
the actual document: a lead can't edit another lead's project, a member can't edit a task
that isn't theirs. `src/utils/rbac.js` has the pure predicates; `access.service.js` does
the database-backed assertions.

**Q: Why 403 and not 404 when I'm not allowed?**
Authentication has already succeeded, so we know who they are — the honest answer is "you
may not", not "this doesn't exist". The API is consistent about this: 404 means the
*resource* isn't there, 403 means *you* can't have it. (If they push back that 403 leaks
existence: true, and the fix is to scope the lookup to the projects the user can see, so a
foreign id simply isn't found — say that's a deliberate, documented trade-off.)

**Q: What exactly can a member change on a task?**
Only `status` and `progress`, only on a task assigned to them. Anything else is a 403 that
names the field.

**Q: What happens when an admin demotes a lead?**
It takes effect on the next request — roles are read from the user document, not trusted
from the token's claims. There's a test for it.

**Q: How is this tested?**
`tests/rbac.test.js`: member/lead/admin boundaries, ownership checks, cross-project
isolation, and the demotion case.

### Data & correctness

**Q: What's an index you added, and why?**
`User.email` is unique — it's the login key. `Project.key` is unique. On `Task` the
compound indexes mirror the list filters exactly: `{project, status}`, `{assignedTo,
status}`, `{project, assignedTo}`, plus `{deadline}` for the overdue query — so the
filters the API advertises are covered instead of scanning the collection. `Project` and
`Task` also carry **text indexes** for `?search=`.

**Q: Your favourite index in the whole project?**
`TimeEntry` has a **partial unique index** on `{user, endedAt}` with
`partialFilterExpression: { endedAt: null }` — it makes "one running timer per user" a
database guarantee for the open entry only, so a user can still have unlimited *closed*
entries. Enforcing that in application code alone would be a race.

**Q: How do dependencies work?**
A task lists other task ids in the same project. Creating or updating validates that every
dependency exists, belongs to the same project, and doesn't create a **cycle** — A → B → A
would make progress reporting meaningless.

**Q: What happens when I delete a project?**
Its tasks go too, and their comments and time entries. Cascades are explicit, not left to
orphan rows.

**Q: How is progress calculated?**
`completed / totalTasks × 100` rounded to one decimal, plus counts per status, an overdue
count (deadline in the past and not done), and a per-priority breakdown. The progress
report is attached to every project in `GET /api/projects`.

### Real-time

**Q: How does Socket.io authenticate?**
A JWT in the handshake `auth` payload, verified before the connection is accepted.
Invalid or missing means `connect_error` — the socket never joins a room.

**Q: How are rooms decided?**
From database state at handshake: `user:<id>` always, plus `project:<id>` for every
project they own or belong to, and `team:<id>` likewise.

**Q: When is an event emitted?**
After the database write succeeds, from the service layer. A client that re-reads the
document on `task:updated` always sees the new state.

**Q: A user is in both the project room and their own user room — do they get two events?**
No. The registry emits with a chained `io.to(roomA).to(roomB)`, whose union semantics
de-duplicate delivery.

**Q: How would you scale this to two servers?**
The honest answer: it wouldn't work as-is — Socket.io rooms are per-process. Add the Redis
adapter so rooms span instances. Say this before they ask.

### Testing

**Q: How many tests, and what do they cover?**
123 tests in 7 suites — auth, RBAC, tasks, projects, sockets, docs, and a 13-step
acceptance flow. Real HTTP calls via Supertest against a real MongoDB started in memory.

**Q: Why `mongodb-memory-server` instead of mocks?**
Mocking Mongoose hides exactly the bugs worth catching — bad indexes, wrong population,
broken cascade deletes. The tests exercise the same queries production does, and nothing
touches your dev database.

**Q: Do you test the docs?**
Yes — `tests/docs.test.js` asserts the OpenAPI document is complete (every operation has a
unique id, a role label and an example body) and that the demo password never renders in
production. It caught a real leak: the guide was embedding the demo password in its curl
snippets.

**Q: What did the tests catch that you'd have missed?**
Two real ones: a prefilled example body that returned **409** because it collided with the
seeded project key, and the production guide leaking the demo password. Both were found by
running the thing, not by reading it.

### Deployment

**Q: Where is it deployed?**
Render — `https://taskflow-pqe9.onrender.com` — auto-deploying from `main`, with MongoDB
Atlas as the database.

**Q: How does Swagger UI know which host to call?**
The OpenAPI document's `servers` entry is rewritten **per request** from the request's own
host (`env.publicUrlFor`), so "Try it out" on the deployed page targets the deployed
server. Before that fix, the document carried the build machine's `localhost` — the
classic "works on my machine" deployment bug. `PUBLIC_URL` overrides it if a proxy
rewrites the origin.

**Q: How does the app behave with a bad env var?**
Joi validates everything at boot and the process exits with a readable message. Fail fast,
not with a 500 three hours later.

**Q: Does it need Firebase to run?**
No. Without credentials it logs one warning and keeps working — sockets still run, only
push is disabled. `/health` reports `firebase: false`.

### Trade-offs (the questions that separate a demo from an engineer)

**Q: What would you do differently?**
`[ ]` — pick two from Part 11 and be specific.

**Q: What was the hardest part?**
`[ ]` — suggested: the authorization layer, because "role is not enough" only becomes
obvious when you write the test where a lead tries to edit someone else's project. Or the
Socket.io room lifecycle when membership changes mid-connection.

**Q: What are you least happy with?**
`[ ]` — pick one from Part 11. Having a real answer here reads as confidence, not weakness.

**Q: If you had another week?**
Part 11, next steps.

---

## Part 10 — Numbers cheat sheet

Memorise these; they're quotable.

| Thing | Number |
| --- | --- |
| API paths / operations | **29 / 42** |
| Postman requests | **47** |
| Mongoose models | **6** |
| Roles | **3** — member, lead, admin |
| Error codes | **9** |
| Server → client socket events | **13** (11 domain + `connected` + `notification`) |
| Client → server socket events | **7** |
| Tests / suites | **123 / 7** |
| bcrypt cost | **12** (4 in tests) |
| JWT lifetime | **7 days**, HS256 |
| Rate limits | **100/15min** global, **10/15min** on `/api/auth` |
| Seed data | 6 users, 1 team, 2 projects, 6 tasks, 3 comments, 1 time entry |
| Demo password (seeded) | `Passw0rd!` |

---

## Part 11 — Known limitations, and what's next

Say these before you're asked. Volunteering a limitation is the strongest signal that you
understand your own system.

**Limitations**

- [ ] No refresh tokens or revocation list — a JWT is valid until it expires. (Real fix:
      short-lived access tokens + a rotating refresh token, or a denylist in Redis.)
- [ ] No email verification or password reset flow.
- [ ] Socket.io rooms are per-process — a second instance would need the **Redis adapter**.
- [ ] Sockets are not horizontally scalable, and there's no message replay for a client
      that was offline.
- [ ] No file attachments on tasks.
- [ ] Cascades run as a `Promise.all` of deletions, not a multi-document transaction — a
      crash mid-cascade can leave partial data. (MongoDB supports transactions only on a
      replica set, which is a deliberate simplicity trade-off here.)
- [ ] No CI pipeline yet; `npm test` is run locally.
- [ ] The deployed free tier sleeps, and its database is Mongo's default `test` database
      (the connection string has no database name).

**Next steps** — pick the two you'd actually do first: `[ ]`

1. Redis adapter for Socket.io so rooms span instances.
2. Refresh tokens with rotation and reuse detection.
3. GitHub Actions running the suite on every push.
4. Cursor-based pagination for large task lists.
5. A front-end that consumes the socket events (the part a reviewer always asks for).
6. Dockerfile + docker-compose for one-command startup.

---

## Part 12 — Commands and URLs

**Local**

```bash
npm install && cp .env.example .env    # set MONGODB_URI + JWT_SECRET
npm run seed                           # demo users, projects, tasks
npm run dev                            # http://localhost:5000/api/docs
npm test                               # 123 tests, in-memory MongoDB
```

**Live**

| What | Where |
| --- | --- |
| Docs page (clickable) | `https://taskflow-pqe9.onrender.com/api/docs` |
| OpenAPI document | `https://taskflow-pqe9.onrender.com/api/docs.json` |
| Health | `https://taskflow-pqe9.onrender.com/health` |
| Postman collection | `docs/TaskFlow.postman_collection.json` |

**Seeded logins** (password `Passw0rd!`): `admin@`, `lead@`, `lead2@`, `member@`,
`member2@`, `member3@` `taskflow.dev`.

---

## Appendix — where each thing lives in the repo

| If they ask about… | Open this |
| --- | --- |
| Middleware chain, docs route | `src/app.js` |
| Env validation, defaults | `src/config/env.js` |
| Roles & permissions | `src/utils/rbac.js`, `src/services/access.service.js` |
| The 6 schemas & indexes | `src/models/*.js` |
| Business rules, socket emits | `src/services/*.js` |
| Routes & JSDoc annotations | `src/routes/*.js` |
| The docs page guide | `src/docs/swagger-guide.js`, `swagger-theme.css` |
| Validation schemas | `src/validators/` |
| Tests | `tests/*.test.js` |
| Design decisions & phases | `PLAN.md`, `progress.md` |
| Deploy config | `render.yaml`, `Procfile` |

---

*Fill in every `[ ]` before the day itself — an answer in your own words beats a better
answer borrowed from a file.*
