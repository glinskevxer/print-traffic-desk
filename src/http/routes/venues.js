'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { publicId, listQuery, territory, currency, venueCode } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { GAUGES, SOUND_FORMATS, PROJECTION_SPEEDS } = require('../../domain/formats');
const venueService = require('../../services/venueService');

const addressSchema = z.object({
  line1: z.string().min(1).max(160),
  line2: z.string().max(160).optional(),
  city: z.string().min(1).max(80),
  postcode: z.string().min(1).max(20),
  territory,
  attention: z.string().max(120).optional(),
});

const boothSchema = z.object({
  gauges: z.array(z.enum(GAUGES)).min(1).max(6),
  soundFormats: z.array(z.enum(SOUND_FORMATS)).max(10).default(['optical-mono']),
  speeds: z.array(z.union(PROJECTION_SPEEDS.map((s) => z.literal(s)))).max(5).default([24]),
  platterEquipped: z.boolean().default(false),
  changeoverCapable: z.boolean().default(true),
  nitrateCertified: z.boolean().default(false),
  reelCapacity: z.number().int().min(1).max(30).default(6),
  projectionistOnStaff: z.boolean().default(true),
});

const createBody = z.object({
  code: venueCode,
  name: z.string().min(1).max(160),
  territory,
  city: z.string().min(1).max(80),
  timezone: z.string().min(3).max(60),
  address: addressSchema,
  booth: boothSchema,
  seats: z.number().int().min(1).max(6000),
  boxOfficeCurrency: currency,
  houseNutMinor: z.number().int().min(0).default(0),
  inboundLeadDays: z.number().int().min(0).max(21).default(2),
  outboundLeadDays: z.number().int().min(0).max(21).default(1),
  carrierAccount: z.string().max(60).optional(),
});

const updateBody = z
  .object({
    name: z.string().min(1).max(160),
    address: addressSchema,
    seats: z.number().int().min(1).max(6000),
    houseNutMinor: z.number().int().min(0),
    inboundLeadDays: z.number().int().min(0).max(21),
    outboundLeadDays: z.number().int().min(0).max(21),
    carrierAccount: z.string().max(60),
    timezone: z.string().min(3).max(60),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'nothing to change' });

const listVenuesQuery = listQuery.extend({
  territory: territory.optional(),
  city: z.string().min(1).max(80).optional(),
  gauge: z.enum(GAUGES).optional(),
  nitrateCertified: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sortBy: z.enum(['code', 'name', 'createdAt']).default('code'),
});

const venueParams = z.object({ venueId: publicId('ven') });

function venueRoutes() {
  const router = Router();

  router.post(
    '/',
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const venue = await venueService.createVenue(req.valid.body);
      res.status(201).json(venue.toJSON());
    }),
  );

  router.get(
    '/',
    validate({ query: listVenuesQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await venueService.listVenues(req.valid.query)));
    }),
  );

  router.get(
    '/:venueId',
    validate({ params: venueParams }),
    asyncHandler(async (req, res) => {
      res.json((await venueService.getVenue(req.valid.params.venueId)).toJSON());
    }),
  );

  router.patch(
    '/:venueId',
    validate({ params: venueParams, body: updateBody }),
    asyncHandler(async (req, res) => {
      const venue = await venueService.updateVenue(req.valid.params.venueId, req.valid.body);
      res.json(venue.toJSON());
    }),
  );

  router.put(
    '/:venueId/booth',
    validate({ params: venueParams, body: boothSchema.partial() }),
    asyncHandler(async (req, res) => {
      const { venue, strandedElements } = await venueService.updateBooth(
        req.valid.params.venueId,
        req.valid.body,
      );
      res.json({ ...venue.toJSON(), strandedElements });
    }),
  );

  router.put(
    '/:venueId/active',
    validate({ params: venueParams, body: z.object({ active: z.boolean() }) }),
    asyncHandler(async (req, res) => {
      const venue = await venueService.setVenueActive(req.valid.params.venueId, req.valid.body.active);
      res.json(venue.toJSON());
    }),
  );

  return router;
}

module.exports = { venueRoutes };
