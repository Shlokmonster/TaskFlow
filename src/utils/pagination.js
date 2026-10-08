'use strict';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Normalise `?page=&limit=&sort=` into mongoose-ready values.
 *
 * Sorting is whitelisted: a client can never pass an arbitrary (or expensive)
 * field straight into `.sort()`. Only fields listed in `allowedSort` survive;
 * everything else is silently dropped in favour of the default.
 *
 * @param {object} query express req.query
 * @param {{allowedSort?: string[], defaultSort?: string, defaultLimit?: number, maxLimit?: number}} [options]
 */
function getPagination(query = {}, options = {}) {
  const {
    allowedSort = ['createdAt', 'updatedAt'],
    defaultSort = '-createdAt',
    defaultLimit = DEFAULT_LIMIT,
    maxLimit = MAX_LIMIT,
  } = options;

  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);

  const sort = {};
  const requested = String(query.sort || defaultSort)
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);

  requested.forEach((field) => {
    const direction = field.startsWith('-') ? -1 : 1;
    const key = field.replace(/^[-+]/, '');
    if (allowedSort.includes(key)) sort[key] = direction;
  });

  if (!Object.keys(sort).length) {
    const fallback = defaultSort.replace(/^[-+]/, '');
    sort[fallback] = defaultSort.startsWith('-') ? -1 : 1;
  }

  return { page, limit, skip: (page - 1) * limit, sort };
}

/** Build the `meta` block that accompanies every paginated response. */
function buildMeta(page, limit, total) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  };
}

module.exports = { getPagination, buildMeta, DEFAULT_LIMIT, MAX_LIMIT };
