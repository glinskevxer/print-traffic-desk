'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { publicId, listQuery } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { ALL_CODES, SEVERITIES } = require('../../domain/condition/damageCodes');
const { ALL_RESTRICTIONS } = require('../../domain/handling');
const { INSPECTION_KINDS } = require('../../models/inspectionReport');
const service = require('../../services/inspectionService');

const findingSchema = z.object({
  reel: z.number().int().min(1).max(30),
  footageMark: z.number().int().min(0).max(60000).optional(),
  code: z.enum(ALL_CODES),
  severity: z.enum(SEVERITIES),
  note: z.string().max(400).optional(),
});

const measurementSchema = z.object({
  shrinkagePercent: z.number().min(0).max(10).default(0),
  adStripLevel: z.number().int().min(0).max(3).default(0),
  warpMillimetres: z.number().min(0).max(50).default(0),
});

const recordBody = z.object({
  inspector: z.string().min(2).max(120),
  kind: z.enum(INSPECTION_KINDS),
  atVenueId: publicId('ven').optional(),
  inspectedAt: z.coerce.date().optional(),
  findings: z.array(findingSchema).max(400).default([]),
  measurements: measurementSchema.default({}),
  footageInspected: z.number().int().min(1).max(60000).optional(),
  restrictionsCleared: z.array(z.enum(ALL_RESTRICTIONS)).max(10).default([]),
  notes: z.string().max(4000).optional(),
});

const previewBody = recordBody.partial({ inspector: true, kind: true });

// An inspection history reads newest first: the current condition is the
// question, and the 1974 intake report is not.
const historyQuery = listQuery.extend({ order: z.enum(['asc', 'desc']).default('desc') });

const listInspectionsQuery = historyQuery.extend({
  elementId: publicId('elem').optional(),
  verdict: z.enum(['projectable', 'projectable-with-restrictions', 'quarantine']).optional(),
  kind: z.enum(INSPECTION_KINDS).optional(),
  inspector: z.string().min(2).max(120).optional(),
});

function inspectionRoutes() {
  const router = Router();

  router.post(
    '/elements/:elementId/inspections',
    requireRole('archivist'),
    validate({ params: z.object({ elementId: publicId('elem') }), body: recordBody }),
    asyncHandler(async (req, res) => {
      const { report, element, assessment } = await service.recordInspection(
        req.valid.params.elementId,
        req.valid.body,
      );
      res.status(201).json({
        ...report.toJSON(),
        element: { id: element.publicId, status: element.status, grade: element.conditionGrade },
        reasons: assessment.reasons,
      });
    }),
  );

  router.post(
    '/elements/:elementId/inspections/preview',
    validate({ params: z.object({ elementId: publicId('elem') }), body: previewBody }),
    asyncHandler(async (req, res) => {
      res.json(await service.previewInspection(req.valid.params.elementId, req.valid.body));
    }),
  );

  router.get(
    '/elements/:elementId/inspections',
    validate({ params: z.object({ elementId: publicId('elem') }), query: historyQuery }),
    asyncHandler(async (req, res) => {
      const page = await service.listInspections({
        ...req.valid.query,
        elementId: req.valid.params.elementId,
      });
      res.json(pageEnvelope(page));
    }),
  );

  router.get(
    '/inspections',
    validate({ query: listInspectionsQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await service.listInspections(req.valid.query)));
    }),
  );

  router.get(
    '/inspections/due',
    validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) }),
    asyncHandler(async (req, res) => {
      const due = await service.dueForInspection(req.valid.query);
      res.json({
        items: due.map((element) => ({
          id: element.publicId,
          barcode: element.barcode,
          screeningsSinceInspection: element.screeningsSinceInspection,
          interval: element.inspectionIntervalScreenings,
          lastInspectedOn: element.lastInspectedOn,
        })),
      });
    }),
  );

  router.get(
    '/inspections/:inspectionId',
    validate({ params: z.object({ inspectionId: publicId('insp') }) }),
    asyncHandler(async (req, res) => {
      res.json((await service.getInspection(req.valid.params.inspectionId)).toJSON());
    }),
  );

  return router;
}

module.exports = { inspectionRoutes };
