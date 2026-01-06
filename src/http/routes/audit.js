'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { listQuery } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { SUBJECT_TYPES } = require('../../models/auditEvent');
const audit = require('../../lib/audit');

const searchQuery = listQuery.extend({
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectId: z.string().min(3).max(40).optional(),
  actor: z.string().min(3).max(160).optional(),
  action: z.string().min(3).max(80).optional(),
  source: z.enum(['http', 'cli', 'worker', 'system']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const subjectParams = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().min(3).max(40),
});

/** The audit trail is answered flat, not as a document with the change buried. */
function eventView(event) {
  return {
    id: event.publicId,
    at: event.at,
    action: event.action,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    actor: event.actor,
    source: event.source,
    requestId: event.requestId,
    changes: event.changes.map((change) => ({
      field: change.field,
      before: change.before,
      after: change.after,
    })),
    metadata: event.metadata,
  };
}

function auditRoutes() {
  const router = Router();

  router.get(
    '/',
    requireRole('admin'),
    validate({ query: searchQuery }),
    asyncHandler(async (req, res) => {
      const page = await audit.searchTrail(req.valid.query);
      res.json(pageEnvelope(page, eventView));
    }),
  );

  router.get(
    '/:subjectType/:subjectId',
    requireRole('archivist'),
    validate({ params: subjectParams, query: listQuery }),
    asyncHandler(async (req, res) => {
      const { subjectType, subjectId } = req.valid.params;
      const page = await audit.searchTrail({
        ...req.valid.query,
        subjectType,
        subjectId,
        order: 'desc',
      });
      res.json(pageEnvelope(page, eventView));
    }),
  );

  router.get(
    '/:subjectType/:subjectId/actors',
    requireRole('archivist'),
    validate({ params: subjectParams }),
    asyncHandler(async (req, res) => {
      const { subjectType, subjectId } = req.valid.params;
      res.json({ items: await audit.actorsFor(subjectType, subjectId) });
    }),
  );

  return router;
}

module.exports = { auditRoutes, eventView };
