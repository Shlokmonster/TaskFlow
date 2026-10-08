'use strict';

/**
 * Pure role / membership predicates.
 *
 * Nothing here touches the database — given a user and an already-loaded
 * document it answers a yes/no question. The DB-backed assertions that load
 * those documents live in `services/access.service.js`.
 */

const ROLES = Object.freeze({ MEMBER: 'member', LEAD: 'lead', ADMIN: 'admin' });

/** Fields a plain member may change on a task that is assigned to them. */
const MEMBER_TASK_EDITABLE_FIELDS = Object.freeze(['status', 'progress']);

const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

/** Compare two ids that may be ObjectIds, populated docs or strings. */
const sameId = (a, b) => {
  const left = idOf(a);
  const right = idOf(b);
  return Boolean(left && right && left === right);
};

const isAdmin = (user) => user?.role === ROLES.ADMIN;
const isLead = (user) => user?.role === ROLES.LEAD;
const hasRole = (user, ...roles) => Boolean(user) && roles.flat().includes(user.role);

const isProjectOwner = (project, user) => sameId(project?.owner, user);
const isProjectMember = (project, user) =>
  isProjectOwner(project, user) || (project?.members || []).some((m) => sameId(m, user));
const isTeamLead = (team, user) => sameId(team?.lead, user);
const isTeamMember = (team, user) =>
  isTeamLead(team, user) || (team?.members || []).some((m) => sameId(m.user, user));

/** Order-independent list of field names that differ between two snapshots. */
function changedFields(before = {}, after = {}) {
  return Object.keys(after).filter((key) => {
    const a = before[key];
    const b = after[key];
    if (a instanceof Date || b instanceof Date) return new Date(a).getTime() !== new Date(b).getTime();
    return JSON.stringify(a) !== JSON.stringify(b);
  });
}

module.exports = {
  ROLES,
  MEMBER_TASK_EDITABLE_FIELDS,
  idOf,
  sameId,
  isAdmin,
  isLead,
  hasRole,
  isProjectOwner,
  isProjectMember,
  isTeamLead,
  isTeamMember,
  changedFields,
};
