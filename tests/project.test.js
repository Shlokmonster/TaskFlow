'use strict';

const db = require('./setup/db');
const { api, createRoleSet, createProject, createTask, createTeam, auth } = require('./setup/helpers');

let admin;
let lead;
let member;
let outsider;

const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

beforeAll(async () => {
  await db.connect();
});

beforeEach(async () => {
  ({ admin, lead, member, outsider } = await createRoleSet());
});

afterEach(async () => {
  await db.clear();
});

afterAll(async () => {
  await db.disconnect();
});

describe('GET /api/projects', () => {
  it('lists the projects the caller belongs to, with a progress report', async () => {
    const project = await createProject(lead, [member]);
    await createTask(project, lead, { assignedTo: member._id, status: 'done' });
    await createTask(project, lead, { assignedTo: member._id, status: 'todo' });
    await createProject(lead); // a second project the member is not on

    const res = await api().get('/api/projects').set(auth(member));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(String(project._id));
    expect(res.body.data[0].progress).toMatchObject({ totalTasks: 2, completed: 1, todo: 1, completionPercentage: 50 });
  });

  /**
   * Regression: project.service populates the team with `select: 'name isActive'`,
   * which omits `members` — the Team.memberCount virtual then read
   * `undefined.length` and every request to list projects returned a 500. It went
   * unnoticed because test projects had no team; only a project linked to a team
   * triggers it.
   */
  it('serialises a project that belongs to a team without blowing up', async () => {
    const team = await createTeam(lead, [member]);
    const project = await createProject(lead, [member], { team: team._id });

    const res = await api().get('/api/projects').set(auth(lead));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].team).toMatchObject({ id: String(team._id), name: team.name });
  });

  it('serialises a team listing with its members intact', async () => {
    const team = await createTeam(lead, [member]);

    const res = await api().get('/api/teams').set(auth(lead));

    expect(res.status).toBe(200);
    const found = res.body.data.find((t) => t.id === String(team._id));
    expect(found.memberCount).toBe(2);
    expect(found.members).toHaveLength(2);
  });

  it('hides projects the caller is not a member of', async () => {
    await createProject(lead);

    const list = await api().get('/api/projects').set(auth(outsider));
    expect(list.body.data).toHaveLength(0);
  });

  it('shows every project to an admin', async () => {
    await createProject(lead);
    await createProject(outsider);

    const res = await api().get('/api/projects').set(auth(admin));
    expect(res.body.data).toHaveLength(2);
  });
});

describe('GET /api/projects/:id/progress', () => {
  it('counts overdue tasks but not completed ones, and ignores null deadlines', async () => {
    const project = await createProject(lead, [member]);
    await createTask(project, lead, { status: 'todo', startDate: plusDays(-5), deadline: plusDays(-2) }); // overdue
    await createTask(project, lead, { status: 'done', startDate: plusDays(-5), deadline: plusDays(-2) }); // done, not overdue
    await createTask(project, lead, { status: 'todo', deadline: plusDays(3) }); // future
    await createTask(project, lead, { status: 'todo', deadline: null }); // no deadline

    const res = await api().get(`/api/projects/${project._id}/progress`).set(auth(lead));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ totalTasks: 4, completed: 1, overdue: 1, todo: 3, completionPercentage: 25 });
  });

  it('gives an admin access and refuses a non-member', async () => {
    const project = await createProject(lead, [member]);

    const asAdmin = await api().get(`/api/projects/${project._id}/progress`).set(auth(admin));
    expect(asAdmin.status).toBe(200);

    const asOutsider = await api().get(`/api/projects/${project._id}/progress`).set(auth(outsider));
    expect(asOutsider.status).toBe(403);
  });
});

describe('GET /api/projects/:id/gantt', () => {
  it('returns a bar per task with its dependency edges', async () => {
    const project = await createProject(lead, [member]);
    const first = await createTask(project, lead, { title: 'Design', startDate: plusDays(0), deadline: plusDays(2) });
    await createTask(project, lead, {
      title: 'Build',
      startDate: plusDays(2),
      deadline: plusDays(9),
      dependencies: [first._id],
      progress: 40,
    });

    const res = await api().get(`/api/projects/${project._id}/gantt`).set(auth(lead));

    expect(res.status).toBe(200);
    expect(res.body.data.taskCount).toBe(2);
    expect(res.body.data.window.start).toBeTruthy();
    const build = res.body.data.tasks.find((t) => t.title === 'Build');
    expect(build.dependencies).toEqual([String(first._id)]);
    expect(build.progress).toBe(40);
  });
});
