'use strict';

/**
 * Seed script — `npm run seed`
 *
 * Wipes the collections it owns and creates a small but realistic dataset:
 * one admin, two leads, three members, a team, two projects, tasks across every
 * status (including an overdue one), comments and a finished time entry.
 *
 * Pass `--keep` to seed without dropping existing data.
 */

const logger = require('../src/config/logger');
const { connectDB, disconnectDB } = require('../src/config/db');
const { User, Team, Project, Task, Comment, TimeEntry } = require('../src/models');

const PASSWORD = 'Passw0rd!';
const keep = process.argv.includes('--keep');

const daysFromNow = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

async function reset() {
  if (keep) {
    logger.info('--keep passed: leaving existing data in place');
    return;
  }
  await Promise.all([
    User.deleteMany({}),
    Team.deleteMany({}),
    Project.deleteMany({}),
    Task.deleteMany({}),
    Comment.deleteMany({}),
    TimeEntry.deleteMany({}),
  ]);
  logger.info('Cleared existing collections');
}

async function seed() {
  await connectDB();
  await reset();

  // --- Users ---------------------------------------------------------------
  const [admin, lead, lead2, member, member2, member3] = await User.create([
    { name: 'Amara Admin', email: 'admin@taskflow.dev', password: PASSWORD, role: 'admin', fcmTokens: ['demo-admin-token'] },
    { name: 'Liam Lead', email: 'lead@taskflow.dev', password: PASSWORD, role: 'lead' },
    { name: 'Nadia Lead', email: 'lead2@taskflow.dev', password: PASSWORD, role: 'lead' },
    { name: 'Mia Member', email: 'member@taskflow.dev', password: PASSWORD, role: 'member' },
    { name: 'Omar Member', email: 'member2@taskflow.dev', password: PASSWORD, role: 'member' },
    { name: 'Priya Member', email: 'member3@taskflow.dev', password: PASSWORD, role: 'member' },
  ]);
  logger.info('Created 6 users');

  // --- Team ----------------------------------------------------------------
  const team = await Team.create({
    name: 'Platform',
    description: 'Owns the core API and the web client.',
    lead: lead._id,
    members: [
      { user: lead._id, role: 'lead' },
      { user: member._id, role: 'member' },
      { user: member2._id, role: 'member' },
    ],
  });

  // --- Projects ------------------------------------------------------------
  const [apollo, atlas] = await Project.create([
    {
      name: 'Apollo Redesign',
      key: 'APO',
      description: 'Rebuild the customer-facing dashboard.',
      status: 'active',
      owner: lead._id,
      team: team._id,
      members: [lead._id, member._id, member2._id],
      startDate: daysFromNow(-20),
      endDate: daysFromNow(40),
      tags: ['frontend', 'design'],
    },
    {
      name: 'Atlas Migration',
      key: 'ATL',
      description: 'Move the legacy monolith onto the new platform.',
      status: 'planning',
      owner: lead2._id,
      members: [lead2._id, member3._id],
      startDate: daysFromNow(-5),
      endDate: daysFromNow(90),
      tags: ['backend', 'infra'],
    },
  ]);

  await Team.updateOne({ _id: team._id }, { $set: { projects: [apollo._id, atlas._id] } });

  // --- Tasks ---------------------------------------------------------------
  const tasks = await Task.create([
    {
      title: 'Design the new navigation shell',
      description: 'Sidebar + topbar, responsive down to 360px.',
      project: apollo._id,
      assignedTo: member._id,
      createdBy: lead._id,
      status: 'done',
      priority: 'high',
      startDate: daysFromNow(-18),
      deadline: daysFromNow(-10),
      progress: 100,
      tags: ['design'],
      estimatedHours: 12,
    },
    {
      title: 'Build the projects list screen',
      description: 'Table with filters, sorting and the progress column.',
      project: apollo._id,
      assignedTo: member._id,
      createdBy: lead._id,
      status: 'in-progress',
      priority: 'high',
      startDate: daysFromNow(-8),
      deadline: daysFromNow(6),
      progress: 45,
      tags: ['frontend'],
      estimatedHours: 20,
    },
    {
      title: 'Wire up the payment webhook',
      description: 'Idempotent handler for provider callbacks.',
      project: apollo._id,
      assignedTo: member2._id,
      createdBy: lead._id,
      status: 'review',
      priority: 'critical',
      startDate: daysFromNow(-6),
      deadline: daysFromNow(-1), // overdue on purpose
      progress: 80,
      tags: ['backend', 'payments'],
      estimatedHours: 16,
    },
    {
      title: 'Write the onboarding empty states',
      description: 'Copy + illustration for first-run screens.',
      project: apollo._id,
      assignedTo: member2._id,
      createdBy: lead._id,
      status: 'todo',
      priority: 'low',
      startDate: daysFromNow(-2),
      deadline: daysFromNow(20),
      tags: ['design', 'copy'],
    },
    {
      title: 'Inventory the legacy endpoints',
      description: 'Catalogue every route the monolith exposes.',
      project: atlas._id,
      assignedTo: member3._id,
      createdBy: lead2._id,
      status: 'done',
      priority: 'medium',
      startDate: daysFromNow(-4),
      deadline: daysFromNow(-2),
      progress: 100,
      tags: ['research'],
      estimatedHours: 8,
    },
    {
      title: 'Draft the migration runbook',
      description: 'Cutover steps, rollback plan and owners.',
      project: atlas._id,
      assignedTo: member3._id,
      createdBy: lead2._id,
      status: 'in-progress',
      priority: 'medium',
      startDate: daysFromNow(-1),
      deadline: daysFromNow(14),
      progress: 30,
      tags: ['docs'],
    },
  ]);

  // Dependency: the list screen waits for the navigation shell.
  await Task.updateOne({ _id: tasks[1]._id }, { $set: { dependencies: [tasks[0]._id] } });

  // --- Comments ------------------------------------------------------------
  await Comment.create([
    { task: tasks[1]._id, author: lead._id, body: 'Please reuse the table component from the settings page.' },
    { task: tasks[1]._id, author: member._id, body: 'Will do — the progress column needs a tooltip though.' },
    { task: tasks[2]._id, author: lead._id, body: 'This is overdue, what is blocking it?' },
  ]);

  // --- Time entries --------------------------------------------------------
  const startedAt = daysFromNow(-2);
  const endedAt = new Date(startedAt.getTime() + 95 * 60 * 1000);
  await TimeEntry.create({
    task: tasks[1]._id,
    user: member._id,
    startedAt,
    endedAt,
    durationSeconds: Math.round((endedAt - startedAt) / 1000),
    note: 'Initial layout pass',
  });

  // --- Report --------------------------------------------------------------
  const credentials = [
    ['admin', admin.email],
    ['lead', lead.email],
    ['lead', lead2.email],
    ['member', member.email],
    ['member', member2.email],
    ['member', member3.email],
  ];

  /* eslint-disable no-console */
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  TaskFlow seed complete');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  Projects : ${apollo.key} (${apollo.name}), ${atlas.key} (${atlas.name})`);
  console.log(`  Team     : ${team.name}`);
  console.log(`  Tasks    : ${tasks.length} (1 done, 2 in-progress, 1 review, 1 todo, 1 overdue)`);
  console.log('──────────────────────────────────────────────────────────');
  console.log('  Sign in with any of these — password: ' + PASSWORD);
  credentials.forEach(([role, email]) => console.log(`    ${role.padEnd(7)} ${email}`));
  console.log('──────────────────────────────────────────────────────────\n');
  /* eslint-enable no-console */

  await disconnectDB();
}

seed()
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error('Seed failed:', err);
    await disconnectDB().catch(() => {});
    process.exit(1);
  });
