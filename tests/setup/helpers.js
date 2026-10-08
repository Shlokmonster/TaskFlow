'use strict';

const request = require('supertest');

const app = require('../../src/app');
const { User, Team, Project, Task, Comment } = require('../../src/models');
const { signToken } = require('../../src/utils/jwt');

const PASSWORD = 'Passw0rd!';
let sequence = 0;

const nextId = () => {
  sequence += 1;
  return sequence;
};

/** Create a user directly (bypassing the API) for read speed. */
async function createUser(overrides = {}) {
  const n = nextId();
  return User.create({
    name: overrides.name || `Test User ${n}`,
    email: overrides.email || `user${n}@test.dev`,
    password: PASSWORD,
    role: overrides.role || 'member',
    ...overrides,
  });
}

/** Create one user per role: `{ admin, lead, member }`. */
async function createRoleSet() {
  const admin = await createUser({ role: 'admin', name: 'Admin User' });
  const lead = await createUser({ role: 'lead', name: 'Lead User' });
  const member = await createUser({ role: 'member', name: 'Member User' });
  const outsider = await createUser({ role: 'member', name: 'Outsider User' });
  return { admin, lead, member, outsider };
}

const tokenFor = (user) => signToken(user);

/** `Authorization` header for a user (accepts a doc or a raw token). */
const auth = (userOrToken) => ({
  Authorization: `Bearer ${typeof userOrToken === 'string' ? userOrToken : tokenFor(userOrToken)}`,
});

/** A project owned by `owner` with `members` attached. */
async function createProject(owner, members = [], overrides = {}) {
  const n = nextId();
  return Project.create({
    name: overrides.name || `Project ${n}`,
    key: overrides.key || `P${n}${Date.now().toString().slice(-4)}`,
    owner: owner._id,
    members: [owner._id, ...members.map((m) => m._id)],
    status: 'active',
    ...overrides,
  });
}

async function createTask(project, creator, overrides = {}) {
  const n = nextId();
  return Task.create({
    title: overrides.title || `Task ${n}`,
    project: project._id,
    createdBy: creator._id,
    assignedTo: overrides.assignedTo || null,
    ...overrides,
  });
}

/** A team led by `lead` with `members` on it. */
async function createTeam(lead, members = [], overrides = {}) {
  const n = nextId();
  return Team.create({
    name: overrides.name || `Team ${n}`,
    description: overrides.description || 'Test team',
    lead: lead._id,
    members: [lead._id, ...members.map((m) => m._id)].map((user) => ({ user, role: 'member' })),
    ...overrides,
  });
}

const api = () => request(app);

module.exports = {
  app,
  api,
  request,
  PASSWORD,
  createUser,
  createRoleSet,
  tokenFor,
  auth,
  createProject,
  createTask,
  createTeam,
  User,
  Team,
  Project,
  Task,
  Comment,
};
