'use strict';

const http = require('http');
const ioClient = require('socket.io-client');

const db = require('./setup/db');
const { app, api, createRoleSet, createProject, createTask, tokenFor, auth } = require('./setup/helpers');
const { initSockets } = require('../src/sockets');
const { setIO } = require('../src/utils/socketRegistry');

let server;
let io;
let baseUrl;
let admin;
let lead;
let member;
let outsider;
let project;

/** Resolve with the first payload for `event`, or reject after `timeout`. */
function waitFor(socket, event, timeout = 4000) {
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

/** Connect a client and wait until it is authenticated and in its rooms. */
function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

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

beforeEach(async () => {
  ({ admin, lead, member, outsider } = await createRoleSet());
  project = await createProject(lead, [member]);
});

afterEach(async () => {
  await db.clear();
});

describe('handshake authentication', () => {
  it('rejects a socket with no token', async () => {
    await expect(connect(null)).rejects.toThrow(/unauthorized/i);
  });

  it('rejects a socket with an invalid token', async () => {
    await expect(connect('not.a.real.jwt')).rejects.toThrow(/unauthorized/i);
  });

  it('admits a valid token and identifies the user', async () => {
    const socket = await connect(tokenFor(member));
    try {
      // `connected` is only emitted after the room join completes, so reaching
      // this point means the handshake auth and the DB lookup both succeeded.
      const who = await new Promise((resolve) => socket.emit('whoami', resolve));
      expect(who.ok).toBe(true);
      expect(who.user.id).toBe(String(member._id));
      expect(who.user.role).toBe('member');
    } finally {
      socket.close();
    }
  });
});

describe('room access control', () => {
  it('refuses a join:project for a project the user is not in', async () => {
    const socket = await connect(tokenFor(outsider));
    try {
      const ack = await new Promise((resolve) => socket.emit('join:project', String(project._id), resolve));
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatch(/do not have access/i);
    } finally {
      socket.close();
    }
  });

  it('allows a member to join a project they belong to', async () => {
    const socket = await connect(tokenFor(member));
    try {
      const ack = await new Promise((resolve) => socket.emit('join:project', String(project._id), resolve));
      expect(ack.ok).toBe(true);
      expect(ack.room).toBe(`project:${project._id}`);
    } finally {
      socket.close();
    }
  });
});

describe('mutation broadcasts', () => {
  it('broadcasts task:created to the project room', async () => {
    const watcher = await connect(tokenFor(member));
    try {
      const received = waitFor(watcher, 'task:created');

      const res = await api()
        .post('/api/tasks')
        .set(auth(lead))
        .send({ title: 'Realtime task', project: String(project._id) });
      expect(res.status).toBe(201);

      const payload = await received;
      expect(payload.task.title).toBe('Realtime task');
      expect(payload.actorId).toBe(String(lead._id));
    } finally {
      watcher.close();
    }
  });

  it('broadcasts task:updated when the status changes', async () => {
    const task = await createTask(project, lead, { assignedTo: member._id });
    const watcher = await connect(tokenFor(member));

    try {
      const received = waitFor(watcher, 'task:updated');

      const res = await api().put(`/api/tasks/${task._id}`).set(auth(lead)).send({ status: 'in-progress' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('in-progress');

      const payload = await received;
      expect(payload.task.id).toBe(String(task._id));
      expect(payload.task.status).toBe('in-progress');
      expect(payload.previousStatus).toBe('todo');
      expect(payload.changes).toContain('status');
    } finally {
      watcher.close();
    }
  });

  it('sends task:assigned to the new assignee', async () => {
    const task = await createTask(project, lead); // unassigned
    const watcher = await connect(tokenFor(member));

    try {
      const received = waitFor(watcher, 'task:assigned');
      await api().put(`/api/tasks/${task._id}`).set(auth(lead)).send({ assignedTo: String(member._id) });

      const payload = await received;
      expect(payload.to.id).toBe(String(member._id));
    } finally {
      watcher.close();
    }
  });

  it('broadcasts comment:added and task:deleted', async () => {
    const task = await createTask(project, lead, { assignedTo: member._id });
    const watcher = await connect(tokenFor(member));

    try {
      const commentEvent = waitFor(watcher, 'comment:added');
      await api().post('/api/comments').set(auth(lead)).send({ task: String(task._id), body: 'Ping' });
      const comment = await commentEvent;
      expect(comment.comment.body).toBe('Ping');

      const deletedEvent = waitFor(watcher, 'task:deleted');
      await api().delete(`/api/tasks/${task._id}`).set(auth(lead));
      const deleted = await deletedEvent;
      expect(deleted.taskId).toBe(String(task._id));
    } finally {
      watcher.close();
    }
  });

  it('mirrors the push as a `notification` event for connected clients', async () => {
    const watcher = await connect(tokenFor(member));

    try {
      const received = waitFor(watcher, 'notification');
      await api()
        .post('/api/tasks')
        .set(auth(lead))
        .send({ title: 'Notify me', project: String(project._id), assignedTo: String(member._id) });

      const payload = await received;
      expect(payload.type).toBe('task_assigned');
      expect(payload.body).toMatch(/Notify me/);
    } finally {
      watcher.close();
    }
  });
});

describe('unauthenticated HTTP surface', () => {
  it('exposes a health endpoint without auth', async () => {
    const res = await api().get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const res = await api().get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
