# TaskFlow — Progress

**Status:** Complete — all 9 phases done, 86/86 tests passing, working tree clean.
**Branch:** `main` (fresh repo inside `Aashu_Node`) · **Last updated:** 2026-10-08

## Phase checklist
- [x] Phase 0 — Plan (`PLAN.md`)
- [x] Phase 1 — Setup & skeleton
- [x] Phase 2 — Models, auth, RBAC, validation
- [x] Phase 3 — Projects, Teams, Tasks
- [x] Phase 4 — Comments
- [x] Phase 5 — Admin routes
- [x] Phase 6 — Socket.io + FCM
- [x] Phase 7 — Optional: Gantt + time tracking
- [x] Phase 8 — Swagger + Postman + README
- [x] Phase 9 — Tests, deploy config, final audit

## Deliverables checklist
- [x] CRUD: projects, tasks, comments, teams
- [x] Auth (JWT + Firebase) + RBAC middleware
- [x] Validation middleware on every write
- [x] Socket.io real-time server
- [x] Firebase push notifications (graceful without creds)
- [x] Swagger UI `/api/docs` + Postman collection in `/docs`
- [x] README.md (all required sections)
- [x] `.gitignore`, LICENSE, conventional commits (one per phase)
- [x] `render.yaml` + `Procfile` + deploy guide
- [x] Optional: Gantt API + time tracking API
- [x] Tests: auth, RBAC, task CRUD, example flow
- [x] Example flow verified end to end

## Key decisions (see PLAN.md §8 for full detail)
- Express 4.21, Joi validation, in-house NoSQL sanitizer (replaces broken `express-mongo-sanitize`).
- `Team.members` is the single source of truth for team membership.
- Firebase optional at runtime; sockets+services emit via a registry singleton (no circular imports).
- Deviation: the socket/notification registry was committed *before* the feature commits that import it, so every commit in the history is dependency-correct. History is 13 commits, not exactly 10.

## Changelog
- **2026-10-08** — Phase 0 done: PLAN.md with architecture, 6 schemas, full endpoint table, RBAC matrix, socket rooms/events, FCM flow, 10 phases. progress.md created.
- **2026-10-08** — Phases 1–2 done: scaffold (config/logger/db/errors/rate-limit/sanitizer), 6 models with indexes, JWT+Firebase auth, RBAC + ownership layer, Joi validation.
- **2026-10-08** — Phases 3–5 done: projects CRUD + progress report, tasks CRUD with dependency cycles/filters/cascade, teams, threaded comments with mentions, admin routes.
- **2026-10-08** — Phases 6–7 done: authenticated socket handshake, user/project/team rooms, 11 events, FCM with dead-token pruning and graceful degradation; Gantt endpoint + time tracking.
- **2026-10-08** — Phases 8–9 done: Swagger UI (29 paths), Postman collection (47 requests), README, render.yaml + Procfile, seed script verified, 86/86 tests green, 13 conventional commits. Project complete.
- **2026-10-08** — Swagger testing guide shipped: every one of the 42 operations carries a prefilled body, a role label and a deep link; under the UI the page documents the ten-step scripted demo, a one-click sign-in that hands the JWT to Swagger UI, the real-time event contract and the error/limit reference. 118 tests.
- **2026-10-08** — Deployed docs repaired (Render): the OpenAPI `servers` entry is now derived from the request, so "Try it out" on a deployed page targets that deployment instead of the build machine's localhost; the demo dataset is gated by a new `DOCS_DEMO_MODE` opt-in (reported by `/health` as `docsDemo`) rather than by `NODE_ENV`, with `PUBLIC_URL` as an explicit override. Verified against the live service. 123 tests.
