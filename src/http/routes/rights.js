'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const {
  publicId,
  listQuery,
  isoDate,
  localTime,
  currency,
  licenceTerritory,
  minorAmount,
  basisPoints,
} = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { EXHIBITION_TYPES, TERM_KINDS, WINDOW_STATUSES } = require('../../models/rightsWindow');
const rightsService = require('../../services/rightsService');
const venueService = require('../../services/venueService');
const { instantOf } = require('../../lib/dates');

const termsSchema = z.object({
  kind: z.enum(TERM_KINDS),
  currency,
  flatFeeMinor: minorAmount.optional(),
  percentageBps: basisPoints.optional(),
  minimumGuaranteeMinor: minorAmount.optional(),
  houseNutDeductible: z.boolean().default(false),
  capMinor: minorAmount.optional(),
});

const blackoutSchema = z.object({
  startsOn: isoDate,
  endsOn: isoDate,
  reason: z.string().max(200).optional(),
});

const createBody = z
  .object({
    titleId: publicId('ttl'),
    rightsHolderId: publicId('rh'),
    reference: z.string().max(80).optional(),
    territory: licenceTerritory,
    exhibitionTypes: z.array(z.enum(EXHIBITION_TYPES)).min(1).max(5),
    startsOn: isoDate,
    endsOn: isoDate,
    holdbackUntil: isoDate.optional(),
    maxScreenings: z.number().int().min(1).max(10000).optional(),
    maxScreeningsPerVenue: z.number().int().min(1).max(1000).optional(),
    exclusivity: z
      .object({
        scope: z.enum(['none', 'city', 'territory']),
        heldByVenueId: publicId('ven').optional(),
      })
      .optional(),
    blackouts: z.array(blackoutSchema).max(40).default([]),
    terms: termsSchema,
    notes: z.string().max(4000).optional(),
  })
  .refine((body) => body.startsOn <= body.endsOn, {
    message: 'the window ends before it starts',
    path: ['endsOn'],
  })
  .refine(
    (body) =>
      !body.exclusivity || body.exclusivity.scope === 'none' || body.exclusivity.heldByVenueId,
    { message: 'an exclusive licence has to name the house holding it', path: ['exclusivity'] },
  );

const listWindowsQuery = listQuery.extend({
  titleId: publicId('ttl').optional(),
  rightsHolderId: publicId('rh').optional(),
  status: z.enum(WINDOW_STATUSES).optional(),
  territory: licenceTerritory.optional(),
  onDate: isoDate.optional(),
  exclusiveOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sortBy: z.enum(['startsOn', 'endsOn', 'createdAt']).default('startsOn'),
});

const clearanceQuery = z
  .object({
    titleId: publicId('ttl'),
    venueId: publicId('ven'),
    localDate: isoDate.optional(),
    localTime: localTime.optional(),
    exhibitionType: z.enum(EXHIBITION_TYPES).default('repertory'),
    screenings: z.coerce.number().int().min(1).max(50).default(1),
  })
  .refine((query) => query.localDate, {
    message: 'a screening date is needed',
    path: ['localDate'],
  });

const windowParams = z.object({ windowId: publicId('rw') });

function rightsRoutes() {
  const router = Router();

  router.post(
    '/rights-windows',
    requireRole('programmer'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const window = await rightsService.createWindow(req.valid.body);
      res.status(201).json(window.toJSON());
    }),
  );

  router.get(
    '/rights-windows',
    validate({ query: listWindowsQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await rightsService.listWindows(req.valid.query)));
    }),
  );

  router.get(
    '/rights-windows/:windowId',
    validate({ params: windowParams }),
    asyncHandler(async (req, res) => {
      res.json((await rightsService.getWindow(req.valid.params.windowId)).toJSON());
    }),
  );

  router.put(
    '/rights-windows/:windowId/activate',
    requireRole('admin'),
    validate({ params: windowParams }),
    asyncHandler(async (req, res) => {
      res.json((await rightsService.activateWindow(req.valid.params.windowId)).toJSON());
    }),
  );

  router.put(
    '/rights-windows/:windowId/suspend',
    requireRole('admin'),
    validate({ params: windowParams, body: z.object({ reason: z.string().min(3).max(400) }) }),
    asyncHandler(async (req, res) => {
      const window = await rightsService.suspendWindow(
        req.valid.params.windowId,
        req.valid.body.reason,
      );
      res.json(window.toJSON());
    }),
  );

  /**
   * The question a programmer asks before they advertise: could this house show
   * this title on this date, and under whose licence. Nothing is held.
   */
  router.get(
    '/clearance',
    validate({ query: clearanceQuery }),
    asyncHandler(async (req, res) => {
      const query = req.valid.query;
      const venue = await venueService.getVenue(query.venueId);
      const decision = await rightsService.clearScreeningRequest({
        titleId: query.titleId,
        venue,
        localDate: query.localDate,
        exhibitionType: query.exhibitionType,
        screenings: query.screenings,
      });

      res.json({
        cleared: decision.cleared,
        windowId: decision.windowId,
        alternatives: decision.alternatives,
        refusalCodes: decision.refusalCodes,
        refusals: decision.details,
        request: {
          ...decision.request,
          screeningAt: query.localTime
            ? instantOf(query.localDate, query.localTime, venue.timezone)
            : undefined,
        },
        evaluated: decision.evaluations.map((evaluation) => ({
          windowId: evaluation.windowId,
          ok: evaluation.ok,
          outcomes: evaluation.outcomes,
        })),
      });
    }),
  );

  return router;
}

module.exports = { rightsRoutes };
