'use strict';

/**
 * One response shape for the whole API.
 *
 *   success → { success: true,  message, data, meta? }
 *   failure → { success: false, error: { code, message, details? } }
 *
 * Controllers use these helpers so the envelope is never hand-rolled.
 */

const ok = (res, data = null, message = 'Success', statusCode = 200) =>
  res.status(statusCode).json({ success: true, message, data });

const created = (res, data = null, message = 'Created') => ok(res, data, message, 201);

const noContent = (res, message = 'Deleted successfully') => res.status(200).json({ success: true, message, data: null });

const paginated = (res, items, meta, message = 'Success') =>
  res.status(200).json({ success: true, message, data: items, meta });

module.exports = { ok, created, noContent, paginated };
