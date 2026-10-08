'use strict';

/**
 * The acceptance script from PLAN.md §11, exercised end to end against the real
 * HTTP surface, a real (in-memory) database and a live Socket.io server:
 *
 *   register → login (with fcmToken) → create project → add member →
 *   create task with assignment → update status (socket broadcast) →
 *   comment → progress report → time tracking → Gantt → negative checks
 */

const http = require('http');
const ioClient = require('socket.io-client');

const db = require('./setup/db');
const { app, api, auth, tokenFor, PASSWORD, User } = require('./setup/helpers');
const { initSockets } = require('../src/sockets');
const { setIO } = require('../src/utils/socketRegistry');

let server;
let io;
let baseUrl;

function waitFor(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeout);
    function handler(payload) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    const timer = setTimeout(() => reject(new Error('Socket connect timed out')), 5000);
    socket.on('connected', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

beforeAll(async () => {
  await db.connect();
  server = http.createServer(app);
  io = initSockets(server);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  setIO(null);
  if (io) await new Promise((resolve) => io.close(resolve));
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.disconnect();
});

// Shared across the ordered steps below.
const ctx = {};

describe('TaskFlow example flow', () => {
  it('1. registers an admin, a lead and a member', async () => {
    const people = [
      { name: 'Amara Admin', email: 'admin@flow.dev', role: 'admin' },
      { name: 'Liam Lead', email: 'lead@flow.dev', role: 'lead' },
      { name: 'Mia Member', email: 'member@flow.dev', role: 'member' },
    ];

    for (const person of people) {
      const res = await api().post('/api/auth/register').send({ name: person.name, email: person.email, password: PASSWORD });
      expect(res.status).toBe(201);
      ctx[person.role] = res.body.data;
    }

    // Self-registration always yields a member; the seeder/admin promotes.
    ctx.admin = await User.findOneAndUpdate(
      { email: 'admin@flow.dev' },
      { $set: { role: 'admin' } },
      { new: true }
    );
    ctx.lead = await User.findOneAndUpdate({ email: 'lead@flow.dev' }, { $set: { role: 'lead' } }, { new: true });
    ctx.member = await User.findOne({ email: 'member@flow.dev' });

    expect(ctx.admin.role).toBe('admin');
    expect(ctx.lead.role).toBe('lead');
    expect(ctx.member.role).toBe('member');
  });

  it('2. logs the lead in with an fcmToken', async () => {
    const res = await api()
      .post('/api/auth/login')
      .send({ email: 'lead@flow.dev', password: PASSWORD, fcmToken: 'lead-device-token' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('lead');
    ctx.leadToken = res.body.data.token;

    const stored = await User.findOne({ email: 'lead@flow.dev' });
    expect(stored.fcmTokens).toContain('lead-device-token');
  });

  it('3. creates a project as the lead', async () => {
    const res = await api()
      .post('/api/projects')
      .set(auth(ctx.leadToken))
      .send({ name: 'TaskFlow Launch', key: 'TFL', description: 'Ship it', status: 'active' });

    expect(res.status).toBe(201);
    expect(res.body.data.owner.id).toBe(String(ctx.lead._id));
    expect(res.body.data.members.map((m) => m.id)).toContain(String(ctx.lead._id));
    ctx.project = res.body.data;
  });

  it('4. adds the member to the project', async () => {
    const res = await api()
      .post(`/api/projects/${ctx.project.id}/members`)
      .set(auth(ctx.leadToken))
      .send({ members: [String(ctx.member._id)] });

    expect(res.status).toBe(200);
    expect(res.body.data.added).toEqual([String(ctx.member._id)]);
    expect(res.body.data.project.members.map((m) => m.id)).toContain(String(ctx.member._id));
  });

  it('5. creates a task assigned to the member (broadcast + push)', async () => {
    const watcher = await connect(tokenFor(ctx.member));

    try {
      const created = waitFor(watcher, 'task:created');
      const assigned = waitFor(watcher, 'task:assigned');
      const pushed = waitFor(watcher, 'notification');

      const res = await api()
        .post('/api/tasks')
        .set(auth(ctx.leadToken))
        .send({
          title: 'Wire the deploy pipeline',
          description: 'GitHub Actions → Render',
          project: ctx.project.id,
          assignedTo: String(ctx.member._id),
          priority: 'high',
          deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assignedTo.id).toBe(String(ctx.member._id));
      ctx.task = res.body.data;

      const createdPayload = await created;
      expect(createdPayload.task.id).toBe(ctx.task.id);
      expect(createdPayload.actorId).toBe(String(ctx.lead._id));

      expect((await assigned).to.id).toBe(String(ctx.member._id));
      expect((await pushed).type).toBe('task_assigned');
    } finally {
      watcher.close();
    }
  });

  it('6. updates the status and broadcasts task:updated', async () => {
    const watcher = await connect(tokenFor(ctx.member));

    try {
      const broadcast = waitFor(watcher, 'task:updated');

      const res = await api()
        .put(`/api/tasks/${ctx.task.id}`)
        .set(auth(ctx.leadToken))
        .send({ status: 'in-progress', progress: 30 });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('in-progress');
      expect(res.body.data.progress).toBe(30);

      const payload = await broadcast;
      expect(payload.task.status).toBe('in-progress');
      expect(payload.changes).toEqual(expect.arrayContaining(['status', 'progress']));
    } finally {
      watcher.close();
    }
  });

  it('7. adds a comment as the member', async () => {
    const watcher = await connect(ctx.leadToken);

    try {
      const broadcast = waitFor(watcher, 'comment:added');

      const res = await api()
        .post('/api/comments')
        .set(auth(ctx.member))
        .send({ task: ctx.task.id, body: 'Pipeline is green — @lead@flow.dev take a look' });

      expect(res.status).toBe(201);
      expect(res.body.data.author.id).toBe(String(ctx.member._id));
      // The @email mention resolved to the project's lead.
      expect(res.body.data.mentions.map((m) => m.id)).toContain(String(ctx.lead._id));
      ctx.comment = res.body.data;

      const payload = await broadcast;
      expect(payload.comment.id).toBe(ctx.comment.id);
      expect(payload.taskId).toBe(ctx.task.id);
    } finally {
      watcher.close();
    }
  });

  it('8. reads the comments back for the task, threaded', async () => {
    const res = await api().get(`/api/comments/task/${ctx.task.id}`).set(auth(ctx.leadToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].replies).toEqual([]);
  });

  it('9. shows the project progress report', async () => {
    const list = await api().get('/api/projects').set(auth(ctx.leadToken));
    expect(list.status).toBe(200);

    const summary = list.body.data.find((p) => p.id === ctx.project.id);
    expect(summary.progress).toMatchObject({
      totalTasks: 1,
      completed: 0,
      inProgress: 1,
      overdue: 0,
      completionPercentage: 0,
    });

    const report = await api().get(`/api/projects/${ctx.project.id}/progress`).set(auth(ctx.leadToken));
    expect(report.status).toBe(200);
    expect(report.body.data.totalTasks).toBe(1);
    expect(report.body.data.inProgress).toBe(1);
    expect(report.body.data.byPriority.high).toBe(1);
  });

  it('10. tracks time on the task and reports totals', async () => {
    const started = await api().post(`/api/tasks/${ctx.task.id}/time/start`).set(auth(ctx.member)).send({ note: 'Pairing' });
    expect(started.status).toBe(201);
    expect(started.body.data.running).toBe(true);

    // A member cannot run two timers at once.
    const second = await api().post(`/api/tasks/${ctx.task.id}/time/start`).set(auth(ctx.member)).send({});
    expect(second.status).toBe(409);

    const stopped = await api().post(`/api/tasks/${ctx.task.id}/time/stop`).set(auth(ctx.member)).send({});
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.durationSeconds).toBeGreaterThanOrEqual(0);

    const report = await api().get(`/api/tasks/${ctx.task.id}/time`).set(auth(ctx.leadToken));
    expect(report.status).toBe(200);
    expect(report.body.data).toHaveLength(1);
    expect(report.body.meta.totals.totalSeconds).toBeGreaterThanOrEqual(0);

    const summary = await api().get('/api/time/summary?groupBy=task').set(auth(ctx.leadToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.items[0].label).toBe('Wire the deploy pipeline');
  });

  it('11. returns Gantt data for the project', async () => {
    const res = await api().get(`/api/projects/${ctx.project.id}/gantt`).set(auth(ctx.leadToken));

    expect(res.status).toBe(200);
    expect(res.body.data.taskCount).toBe(1);
    expect(res.body.data.window.start).toBeTruthy();
    expect(res.body.data.tasks[0]).toMatchObject({ id: ctx.task.id, progress: 30, status: 'in-progress' });
  });

  it('12. enforces RBAC on the way out', async () => {
    const memberCreatesProject = await api().post('/api/projects').set(auth(ctx.member)).send({ name: 'Nope', key: 'NPE' });
    const memberHitsAdmin = await api().get('/api/admin/users').set(auth(ctx.member));
    const noToken = await api().get('/api/projects');

    expect(memberCreatesProject.status).toBe(403);
    expect(memberHitsAdmin.status).toBe(403);
    expect(noToken.status).toBe(401);

    // The admin can see the platform stats.
    const stats = await api().get('/api/admin/stats').set(auth(ctx.admin));
    expect(stats.status).toBe(200);
    expect(stats.body.data.projects.total).toBe(1);
    expect(stats.body.data.tasks.total).toBe(1);
  });

  it('13. completes the task and the progress report reflects it', async () => {
    const done = await api().put(`/api/tasks/${ctx.task.id}`).set(auth(ctx.leadToken)).send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.data.progress).toBe(100);

    const report = await api().get(`/api/projects/${ctx.project.id}/progress`).set(auth(ctx.leadToken));
    expect(report.body.data.completed).toBe(1);
    expect(report.body.data.inProgress).toBe(0);
    expect(report.body.data.completionPercentage).toBe(100);
  });
});
