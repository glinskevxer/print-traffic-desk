'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { publicId, listQuery, isoDate } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { toCsv, minorToDecimal } = require('../../lib/csv');
const { exponentFor } = require('../../lib/money');
const { STATEMENT_STATUSES } = require('../../models/royaltyStatement');
const service = require('../../services/royaltyService');

const buildBody = z
  .object({
    rightsHolderId: publicId('rh'),
    periodStartsOn: isoDate,
    periodEndsOn: isoDate,
  })
  .refine((body) => body.periodStartsOn <= body.periodEndsOn, {
    message: 'the period ends before it starts',
    path: ['periodEndsOn'],
  });

const listStatementsQuery = listQuery.extend({
  rightsHolderId: publicId('rh').optional(),
  status: z.enum(STATEMENT_STATUSES).optional(),
  overdueAsOf: isoDate.optional(),
  sortBy: z.enum(['periodStartsOn', 'dueOn', 'createdAt']).default('periodStartsOn'),
});

const statementParams = z.object({ statementId: publicId('stmt') });

/** The columns a distributor's accounts package expects, in that order. */
function statementColumns(exponent) {
  return [
    { header: 'booking', pick: (line) => line.reference },
    { header: 'title', pick: (line) => line.titleSlug },
    { header: 'venue', pick: (line) => line.venueCode },
    { header: 'date', pick: (line) => line.localDate },
    { header: 'admissions', pick: (line) => line.admissions },
    { header: 'gross', pick: (line) => minorToDecimal(line.grossMinor, exponent) },
    { header: 'royalty', pick: (line) => minorToDecimal(line.royaltyMinor, exponent) },
    { header: 'basis', pick: (line) => line.basis },
  ];
}

function royaltyRoutes() {
  const router = Router();

  router.post(
    '/',
    requireRole('admin'),
    validate({ body: buildBody }),
    asyncHandler(async (req, res) => {
      const statement = await service.buildStatement(req.valid.body);
      res.status(201).json(statement.toJSON());
    }),
  );

  router.get(
    '/',
    validate({ query: listStatementsQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await service.listStatements(req.valid.query)));
    }),
  );

  router.get(
    '/:statementId/export.csv',
    validate({ params: statementParams }),
    asyncHandler(async (req, res) => {
      const statement = await service.getStatement(req.valid.params.statementId);
      const csv = toCsv(statement.lines, statementColumns(exponentFor(statement.currency)));

      res.set('content-type', 'text/csv; charset=utf-8');
      res.set(
        'content-disposition',
        `attachment; filename="${statement.publicId}-${statement.periodStartsOn}.csv"`,
      );
      res.send(csv);
    }),
  );

  router.get(
    '/:statementId',
    validate({ params: statementParams }),
    asyncHandler(async (req, res) => {
      res.json((await service.getStatement(req.valid.params.statementId)).toJSON());
    }),
  );

  router.put(
    '/:statementId/issue',
    requireRole('admin'),
    validate({ params: statementParams, body: z.object({ issuedOn: isoDate }) }),
    asyncHandler(async (req, res) => {
      const statement = await service.issueStatement(
        req.valid.params.statementId,
        req.valid.body.issuedOn,
      );
      res.json(statement.toJSON());
    }),
  );

  router.put(
    '/:statementId/payment',
    requireRole('admin'),
    validate({
      params: statementParams,
      body: z.object({ paidOn: isoDate, paymentReference: z.string().min(2).max(80).optional() }),
    }),
    asyncHandler(async (req, res) => {
      const statement = await service.recordPayment(
        req.valid.params.statementId,
        req.valid.body,
      );
      res.json(statement.toJSON());
    }),
  );

  router.delete(
    '/:statementId',
    requireRole('admin'),
    validate({
      params: statementParams,
      body: z.object({ reason: z.string().min(3).max(400) }),
    }),
    asyncHandler(async (req, res) => {
      const statement = await service.voidStatement(
        req.valid.params.statementId,
        req.valid.body.reason,
      );
      res.json(statement.toJSON());
    }),
  );

  return router;
}

module.exports = { royaltyRoutes, statementColumns };
