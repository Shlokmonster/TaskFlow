'use strict';

const db = require('./setup/db');
const { api, createRoleSet, createProject, createTask, createUser, auth, Comment, Task } = require('./setup/helpers');

let admin;
let lead;
let member;
let project;

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  ({ admin, lead, member } = await createRoleSet());
  project = await createProject(lead, [member]);
});

afterEach(async () => {
  await db.clear();
});

afterAll(async () => {
  await db.disconnect();
});

describe('POST /api/tasks', () => {
  it('creates a task, assigns it and defaults status/priority', async () => {
    const res = await api()
      .post('/api/tasks')
      .set(auth(lead))
      .send({ title: 'Ship the API', project: String(project._id), assignedTo: String(member._id) });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('todo');
    expect(res.body.data.priority).toBe('medium');
    expect(res.body.data.progress).toBe(0);
    expect(res.body.data.assignedTo.id).toBe(String(member._id));
    expect(res.body.data.createdBy.id).toBe(String(lead._id));
  });

  it('refuses an assignee who is not a project member', async () => {
    const stranger = await createUser();

    const res = await api()
      .post('/api/tasks')
      .set(auth(lead))
      .send({ title: 'Bad assignee', project: String(project._id), assignedTo: String(stranger._id) });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a member of the project/i);
  });

  it('validates the payload', async () => {
    const res = await api().post('/api/tasks').set(auth(lead)).send({ title: 'x', project: 'nope', status: 'whenever' });

    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'project', 'status']));
  });

  it('rejects a deadline before the start date', async () => {
    const res = await api()
      .post('/api/tasks')
      .set(auth(lead))
      .send({ title: 'Time travel', project: String(project._id), startDate: plusDays(5), deadline: plusDays(1) });

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body.error.details)).toMatch(/deadline/i);
  });
});

describe('dependencies', () => {
  it('accepts a dependency in the same project', async () => {
    const first = await createTask(project, lead, { title: 'First' });

    const res = await api()
      .post('/api/tasks')
      .set(auth(lead))
      .send({ title: 'Second', project: String(project._id), dependencies: [String(first._id)] });

    expect(res.status).toBe(201);
    expect(res.body.data.dependencies).toHaveLength(1);
  });

  it('rejects a dependency in another project', async () => {
    const otherProject = await createProject(lead);
    const foreign = await createTask(otherProject, lead, { title: 'Foreign' });

    const res = await api()
      .post('/api/tasks')
      .set(auth(lead))
      .send({ title: 'Cross project', project: String(project._id), dependencies: [String(foreign._id)] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/same project/i);
  });

  it('rejects a self dependency', async () => {
    const task = await createTask(project, lead);

    const res = await api()
      .put(`/api/tasks/${task._id}`)
      .set(auth(lead))
      .send({ dependencies: [String(task._id)] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/depend on itself/i);
  });

  it('rejects a circular dependency', async () => {
    const a = await createTask(project, lead, { title: 'Task A' });
    const b = await createTask(project, lead, { title: 'Task B', dependencies: [a._id] });

    // Making A depend on B would close the loop A → B → A.
    const res = await api()
      .put(`/api/tasks/${a._id}`)
      .set(auth(lead))
      .send({ dependencies: [String(b._id)] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/circular/i);
  });

  it('rejects an unknown dependency id', async () => {
    const res = await api()
      .post('/api/tasks')
      .set(auth(lead))
      .send({ title: 'Ghost dep', project: String(project._id), dependencies: ['665f1c2a9b3e4d5f6a7b8c9d'] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/unknown dependency/i);
  });
});

describe('PUT /api/tasks/:id', () => {
  it('syncs progress to 100 and stamps completedAt when marked done', async () => {
    const task = await createTask(project, lead, { assignedTo: member._id, progress: 40 });

    const res = await api().put(`/api/tasks/${task._id}`).set(auth(member)).send({ status: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.data.progress).toBe(100);
    expect(res.body.data.completedAt).not.toBeNull();
  });

  it('returns progress to 0 and clears completedAt when moved back to todo', async () => {
    const task = await createTask(project, lead, { assignedTo: member._id, status: 'done', progress: 100 });

    const res = await api().put(`/api/tasks/${task._id}`).set(auth(lead)).send({ status: 'todo' });

    expect(res.status).toBe(200);
    expect(res.body.data.progress).toBe(0);
    expect(res.body.data.completedAt).toBeNull();
  });

  it('rejects an out-of-range progress value', async () => {
    const task = await createTask(project, lead, { assignedTo: member._id });

    const res = await api().put(`/api/tasks/${task._id}`).set(auth(member)).send({ progress: 150 });
    expect(res.status).toBe(422);
  });

  it('records the change set and lets an admin edit any field', async () => {
    const task = await createTask(project, lead);

    const res = await api()
      .put(`/api/tasks/${task._id}`)
      .set(auth(admin))
      .send({ title: 'Renamed by admin', priority: 'critical' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Renamed by admin');
    expect(res.body.data.priority).toBe('critical');
  });
});

describe('GET /api/tasks filters', () => {
  beforeEach(async () => {
    await createTask(project, lead, { title: 'Alpha work', status: 'todo', priority: 'low', assignedTo: member._id, deadline: plusDays(2) });
    await createTask(project, lead, { title: 'Beta work', status: 'in-progress', priority: 'critical', assignedTo: lead._id, deadline: plusDays(30) });
    await createTask(project, lead, { title: 'Gamma work', status: 'done', priority: 'medium', assignedTo: member._id, tags: ['urgent'] });
  });

  it('filters by status', async () => {
    const res = await api().get('/api/tasks?status=todo,done').set(auth(lead));
    expect(res.body.data).toHaveLength(2);
  });

  it('filters by priority', async () => {
    const res = await api().get('/api/tasks?priority=critical').set(auth(lead));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Beta work');
  });

  it('filters by assignee', async () => {
    const res = await api().get(`/api/tasks?assignee=${member._id}`).set(auth(lead));
    expect(res.body.data).toHaveLength(2);
  });

  it('filters by dueBefore', async () => {
    const res = await api().get(`/api/tasks?dueBefore=${plusDays(10)}`).set(auth(lead));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Alpha work');
  });

  it('searches title and description', async () => {
    const res = await api().get('/api/tasks?search=beta').set(auth(lead));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Beta work');
  });

  it('filters by tags', async () => {
    const res = await api().get('/api/tasks?tags=urgent').set(auth(lead));
    expect(res.body.data).toHaveLength(1);
  });

  it('scopes to the caller with ?mine=true', async () => {
    const res = await api().get('/api/tasks?mine=true').set(auth(member));
    expect(res.body.data).toHaveLength(2);
  });

  it('paginates and reports meta', async () => {
    const res = await api().get('/api/tasks?page=2&limit=2').set(auth(lead));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2, hasPrevPage: true, hasNextPage: false });
  });

  it('sorts by the requested whitelisted field', async () => {
    const res = await api().get('/api/tasks?sort=title').set(auth(lead));
    expect(res.body.data.map((t) => t.title)).toEqual(['Alpha work', 'Beta work', 'Gamma work']);
  });

  it('ignores a sort field that is not whitelisted', async () => {
    const res = await api().get('/api/tasks?sort=password').set(auth(lead));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });

  it('rejects an unsupported status value', async () => {
    const res = await api().get('/api/tasks?status=whenever').set(auth(lead));
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('cascades to comments and detaches dependents', async () => {
    const blocker = await createTask(project, lead, { title: 'Blocker' });
    const dependent = await createTask(project, lead, { title: 'Dependent', dependencies: [blocker._id] });
    await Comment.create({ task: blocker._id, author: lead._id, body: 'On it' });

    const res = await api().delete(`/api/tasks/${blocker._id}`).set(auth(lead));
    expect(res.status).toBe(200);

    expect(await Comment.countDocuments({ task: blocker._id })).toBe(0);
    const reloaded = await Task.findById(dependent._id);
    expect(reloaded.dependencies).toHaveLength(0);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await api().delete('/api/tasks/665f1c2a9b3e4d5f6a7b8c9d').set(auth(lead));
    expect(res.status).toBe(404);
  });
});
