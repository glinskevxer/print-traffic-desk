'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { publicId, isoDate } = require('../schemas/common');
const service = require('../../services/reportService');

function reportRoutes() {
  const router = Router();

  router.get(
    '/licence-utilisation',
    requireRole('programmer'),
    validate({
      query: z.object({
        asOf: isoDate,
        rightsHolderId: publicId('rh').optional(),
        minRemaining: z.coerce.number().int().min(0).default(0),
      }),
    }),
    asyncHandler(async (req, res) => {
      res.json(await service.licenceUtilisation(req.valid.query));
    }),
  );

  router.get(
    '/licensor-summary',
    requireRole('programmer'),
    validate({
      query: z
        .object({ rightsHolderId: publicId('rh'), from: isoDate, to: isoDate })
        .refine((query) => query.from <= query.to, {
          message: 'the period ends before it starts',
          path: ['to'],
        }),
    }),
    asyncHandler(async (req, res) => {
      res.json(await service.licensorSummary(req.valid.query));
    }),
  );

  router.get(
    '/lapsing-licences',
    requireRole('programmer'),
    validate({
      query: z.object({
        asOf: isoDate,
        withinDays: z.coerce.number().int().min(1).max(365).default(60),
      }),
    }),
    asyncHandler(async (req, res) => {
      res.json({ asOf: req.valid.query.asOf, windows: await service.lapsingSoon(req.valid.query) });
    }),
  );

  router.get(
    '/shelf',
    requireRole('viewer'),
    validate({ query: z.object({ titleId: publicId('ttl').optional() }) }),
    asyncHandler(async (req, res) => {
      res.json(await service.shelfSummary(req.valid.query));
    }),
  );

  router.get(
    '/condition-trend',
    requireRole('archivist'),
    validate({
      query: z
        .object({
          from: isoDate,
          to: isoDate,
          minInspections: z.coerce.number().int().min(2).max(20).default(2),
        })
        .refine((query) => query.from <= query.to, {
          message: 'the period ends before it starts',
          path: ['to'],
        }),
    }),
    asyncHandler(async (req, res) => {
      res.json(await service.conditionTrend(req.valid.query));
    }),
  );

  return router;
}

module.exports = { reportRoutes };
