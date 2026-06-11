'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { publicId, listQuery, barcode, isoDate, currency } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const {
  GAUGES,
  BASE_STOCKS,
  ASPECT_RATIOS,
  SOUND_FORMATS,
  ELEMENT_KINDS,
  PROJECTION_SPEEDS,
} = require('../../domain/formats');
const { STATUSES } = require('../../domain/elements/status');
const { ALL_REASONS, DISPOSAL_METHODS } = require('../../domain/elements/retirement');
const elementService = require('../../services/elementService');
const venueService = require('../../services/venueService');

const createBody = z.object({
  barcode,
  titleId: publicId('ttl'),
  ownerId: publicId('rh'),
  custodianId: publicId('ven'),
  kind: z.enum(ELEMENT_KINDS),
  gauge: z.enum(GAUGES),
  baseStock: z.enum(BASE_STOCKS),
  aspectRatio: z.enum(ASPECT_RATIOS),
  soundFormat: z.enum(SOUND_FORMATS),
  projectionSpeed: z.union(PROJECTION_SPEEDS.map((s) => z.literal(s))).default(24),
  footage: z.number().int().min(1).max(60000),
  reelCount: z.number().int().min(1).max(30),
  printLanguage: z
    .string()
    .regex(/^[a-z]{2,3}$/)
    .optional(),
  subtitles: z
    .array(
      z.object({
        language: z.string().regex(/^[a-z]{2,3}$/),
        kind: z.enum(['burned-in', 'electronic', 'inserted-titles']),
      }),
    )
    .max(6)
    .default([]),
  inspectionIntervalScreenings: z.number().int().min(1).max(60).default(6),
  acquiredOn: isoDate.optional(),
  provenance: z.string().max(2000).optional(),
  shelfMark: z.string().max(40).optional(),
  insuredValueMinor: z.number().int().min(0).optional(),
  insuredValueCurrency: currency.optional(),
});

const listElementsQuery = listQuery.extend({
  titleId: publicId('ttl').optional(),
  locationId: publicId('ven').optional(),
  status: z.enum(STATUSES).optional(),
  gauge: z.enum(GAUGES).optional(),
  baseStock: z.enum(BASE_STOCKS).optional(),
  grade: z.enum(['A', 'B', 'C', 'D']).optional(),
  needsInspection: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sortBy: z.enum(['barcode', 'conditionGrade', 'createdAt']).default('barcode'),
});

const elementParams = z.object({ elementId: publicId('elem') });

function elementRoutes() {
  const router = Router();

  router.post(
    '/',
    requireRole('archivist'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const element = await elementService.catalogueElement(req.valid.body);
      res.status(201).json(element.toJSON());
    }),
  );

  router.get(
    '/',
    validate({ query: listElementsQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await elementService.listElements(req.valid.query)));
    }),
  );

  router.get(
    '/:elementId',
    validate({ params: elementParams }),
    asyncHandler(async (req, res) => {
      res.json((await elementService.getElement(req.valid.params.elementId)).toJSON());
    }),
  );

  router.get(
    '/:elementId/provenance',
    validate({
      params: elementParams,
      query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
    }),
    asyncHandler(async (req, res) => {
      const record = await elementService.provenanceOf(req.valid.params.elementId, req.valid.query);
      res.json({
        element: {
          id: record.element.publicId,
          barcode: record.element.barcode,
          grade: record.element.conditionGrade,
          status: record.element.status,
          home: record.home,
          at: record.at,
        },
        totals: {
          screenings: record.screenings,
          inspections: record.inspections,
          legs: record.legs,
        },
        events: record.events,
      });
    }),
  );

  router.put(
    '/:elementId/location',
    requireRole('archivist'),
    validate({
      params: elementParams,
      body: z.object({ venueId: publicId('ven'), reason: z.string().max(400).optional() }),
    }),
    asyncHandler(async (req, res) => {
      const element = await elementService.relocate(
        req.valid.params.elementId,
        req.valid.body.venueId,
        req.valid.body.reason,
      );
      res.json(element.toJSON());
    }),
  );

  router.put(
    '/:elementId/custody',
    requireRole('archivist'),
    validate({
      params: elementParams,
      body: z
        .object({
          custodianId: publicId('ven').optional(),
          ownerId: publicId('rh').optional(),
          reason: z.string().min(3).max(400),
          effectiveOn: isoDate.optional(),
        })
        .refine((body) => body.custodianId || body.ownerId, {
          message: 'name the new custodian, the new owner, or both',
        }),
    }),
    asyncHandler(async (req, res) => {
      const { element, changes } = await elementService.transferCustody(
        req.valid.params.elementId,
        req.valid.body,
      );
      res.json({ ...element.toJSON(), changed: changes.map((change) => change.field) });
    }),
  );

  router.put(
    '/:elementId/status',
    requireRole('archivist'),
    validate({
      params: elementParams,
      body: z.object({ status: z.enum(STATUSES), reason: z.string().max(400).optional() }),
    }),
    asyncHandler(async (req, res) => {
      const element = await elementService.setStatus(
        req.valid.params.elementId,
        req.valid.body.status,
        req.valid.body.reason,
      );
      res.json(element.toJSON());
    }),
  );

  router.post(
    '/:elementId/retirement',
    requireRole('archivist'),
    validate({
      params: elementParams,
      body: z.object({
        reason: z.enum(ALL_REASONS),
        retiredOn: isoDate,
        retiredBy: z.string().min(2).max(120).optional(),
        disposal: z
          .object({
            method: z.enum(DISPOSAL_METHODS),
            to: z.string().min(2).max(160).optional(),
            witness: z.string().min(2).max(120),
            notes: z.string().max(400).optional(),
          })
          .optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { element, line } = await elementService.retireElement(
        req.valid.params.elementId,
        req.valid.body,
      );
      res.json({ ...element.toJSON(), retirement: line });
    }),
  );

  router.get(
    '/:elementId/compatibility/:venueId',
    validate({ params: elementParams.extend({ venueId: publicId('ven') }) }),
    asyncHandler(async (req, res) => {
      const element = await elementService.getElement(req.valid.params.elementId);
      const venue = await venueService.getVenue(req.valid.params.venueId);
      res.json(elementService.boothCompatibility(element, venue));
    }),
  );

  return router;
}

module.exports = { elementRoutes };
