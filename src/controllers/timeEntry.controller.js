'use strict';

const timeService = require('../services/timeEntry.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/ApiResponse');

/** GET /api/time/summary — totals per user or per task, scoped by role. */
const summary = asyncHandler(async (req, res) => {
  const report = await timeService.getSummary(req.user, req.query);
  return ok(
    res,
    { groupBy: report.groupBy, items: report.items, totals: report.totals },
    'Time summary retrieved'
  );
});

module.exports = { summary };
