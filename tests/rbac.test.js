'use strict';

const db = require('./setup/db');
const { api, createUser, createRoleSet, createProject, createTask, auth, PASSWORD } = require('./setup/helpers');

let admin;
let lead;
let member;
let outsider;
let project;
let task;

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  const roles = await createRoleSet();
  ({ admin, lead, member, outsider } = roles);

  project = await createProject(lead, [member]);
  task = await createTask(project, lead, { assignedTo: member._id });
});

afterEach(async () => {
  await db.clear();
});

afterAll(async () => {
  await db.disconnect();
});

describe('role gates', () => {
  it('lets a lead create a project but refuses a member', async () => {
    const asLead = await api().post('/api/projects').set(auth(lead)).send({ name: 'Lead Project', key: 'LPRJ' });
    const asMember = await api().post('/api/projects').set(auth(member)).send({ name: 'Member Project', key: 'MPRJ' });

    expect(asLead.status).toBe(201);
    expect(asMember.status).toBe(403);
    expect(asMember.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses a member and a lead on /api/admin routes', async () => {
    const asMember = await api().get('/api/admin/users').set(auth(member));
    const asLead = await api().get('/api/admin/users').set(auth(lead));
    const asAdmin = await api().get('/api/admin/users').set(auth(admin));

    expect(asMember.status).toBe(403);
    expect(asLead.status).toBe(403);
    expect(asAdmin.status).toBe(200);
  });

  it('requires authentication on every protected route', async () => {
    const res = await api().get('/api/projects');
    expect(res.status).toBe(401);
  });
});

describe('resource-level checks (beyond the role)', () => {
  it('hides a project from a user who is not a member', async () => {
    const res = await api().get(`/api/projects/${project._id}`).set(auth(outsider));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('keeps non-member tasks out of an outsider\'s task list', async () => {
    const res = await api().get('/api/tasks').set(auth(outsider));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 403 (not an empty list) when filtering by a project you cannot access', async () => {
    const res = await api().get(`/api/tasks?project=${project._id}`).set(auth(outsider));
    expect(res.status).toBe(403);
  });

  it('stops a lead from updating a project they do not belong to', async () => {
    const otherLead = await createUser({ role: 'lead' });
    const otherProject = await createProject(otherLead);

    const res = await api().put(`/api/projects/${otherProject._id}`).set(auth(lead)).send({ name: 'Hijacked' });

    expect(res.status).toBe(403);
  });

  it('stops a lead who is only a member from deleting the project', async () => {
    const coLead = await createUser({ role: 'lead' });
    await api().post(`/api/projects/${project._id}/members`).set(auth(lead)).send({ members: [String(coLead._id)] });

    // Deleting requires ownership; being a lead on the project is not enough.
    const res = await api().delete(`/api/projects/${project._id}`).set(auth(coLead));
    expect(res.status).toBe(403);
  });
});

describe('member task scope', () => {
  it('lets a member update the status of their own task', async () => {
    const res = await api().put(`/api/tasks/${task._id}`).set(auth(member)).send({ status: 'in-progress' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in-progress');
  });

  it('refuses a member editing a field outside status/progress', async () => {
    const res = await api().put(`/api/tasks/${task._id}`).set(auth(member)).send({ title: 'Renamed by member' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/status, progress/i);
  });

  it('refuses a member updating a task assigned to someone else', async () => {
    const foreign = await createTask(project, lead, { assignedTo: outsider._id, title: 'Not yours' });
    const res = await api().put(`/api/tasks/${foreign._id}`).set(auth(member)).send({ status: 'done' });

    expect(res.status).toBe(403);
  });

  it('refuses a member creating or deleting tasks', async () => {
    const create = await api().post('/api/tasks').set(auth(member)).send({ title: 'Member task', project: String(project._id) });
    const remove = await api().delete(`/api/tasks/${task._id}`).set(auth(member));

    expect(create.status).toBe(403);
    expect(remove.status).toBe(403);
  });
});

describe('admin capabilities', () => {
  it('reaches every project and every task', async () => {
    const projects = await api().get('/api/projects').set(auth(admin));
    const tasks = await api().get('/api/tasks').set(auth(admin));

    expect(projects.status).toBe(200);
    expect(projects.body.data).toHaveLength(1);
    expect(tasks.body.data).toHaveLength(1);
  });

  it('changes another user\'s role', async () => {
    const res = await api().patch(`/api/admin/users/${member._id}/role`).set(auth(admin)).send({ role: 'lead' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('lead');
  });

  it('refuses a member trying to change a role', async () => {
    const res = await api().patch(`/api/admin/users/${outsider._id}/role`).set(auth(member)).send({ role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('refuses changing your own role', async () => {
    const res = await api().patch(`/api/admin/users/${admin._id}/role`).set(auth(admin)).send({ role: 'member' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/your own role/i);
  });

  it('revokes admin access immediately after a demotion', async () => {
    const second = await createUser({ role: 'admin', email: 'second-admin@test.dev' });

    const demote = await api().patch(`/api/admin/users/${second._id}/role`).set(auth(admin)).send({ role: 'member' });
    expect(demote.status).toBe(200);
    expect(demote.body.data.user.role).toBe('member');

    // authenticate re-reads the user, so the demotion applies to the very next
    // request — no waiting for the token to expire.
    const afterDemotion = await api().get('/api/admin/users').set(auth(second));
    expect(afterDemotion.status).toBe(403);
  });

  it('refuses deactivating your own account', async () => {
    const res = await api().patch(`/api/admin/users/${admin._id}/status`).set(auth(admin)).send({ isActive: false });
    expect(res.status).toBe(400);
  });
});

describe('cross-cutting security', () => {
  it('strips NoSQL operator keys from the body', async () => {
    const res = await api()
      .post('/api/auth/login')
      .send({ email: { $gt: '' }, password: { $gt: '' } });

    // The $gt keys are removed, so validation rejects the payload instead of
    // matching the first user in the collection.
    expect(res.status).toBe(422);
  });

  it('never returns a password hash anywhere in a response', async () => {
    const res = await api().post('/api/auth/login').set(auth(admin)).send({ email: admin.email, password: PASSWORD });
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });
});
