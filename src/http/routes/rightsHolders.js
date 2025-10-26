'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { publicId, listQuery, territory, currency, licenceTerritory } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const service = require('../../services/rightsHolderService');

const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(160),
  role: z.enum(['bookings', 'accounts', 'archive', 'legal']).default('bookings'),
  phone: z.string().max(40).optional(),
});

const createBody = z.object({
  name: z.string().min(1).max(160),
  legalName: z.string().max(200).optional(),
  kind: z.enum(['distributor', 'archive', 'estate', 'filmmaker', 'sales-agent']),
  territoriesRepresented: z.array(licenceTerritory).max(60).default([]),
  contacts: z.array(contactSchema).min(1).max(20),
  remittanceCurrency: currency,
  settlementDays: z.number().int().min(0).max(365).default(45),
  notes: z.string().max(2000).optional(),
});

const updateBody = z
  .object({
    legalName: z.string().max(200),
    territoriesRepresented: z.array(licenceTerritory).max(60),
    contacts: z.array(contactSchema).max(20),
    settlementDays: z.number().int().min(0).max(365),
    notes: z.string().max(2000),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'nothing to change' });

const listHoldersQuery = listQuery.extend({
  kind: z.enum(['distributor', 'archive', 'estate', 'filmmaker', 'sales-agent']).optional(),
  territory: territory.optional(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sortBy: z.enum(['name', 'kind', 'createdAt']).default('name'),
});

const holderParams = z.object({ holderId: publicId('rh') });

function rightsHolderRoutes() {
  const router = Router();

  router.post(
    '/',
    requireRole('admin'),
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const holder = await service.createRightsHolder(req.valid.body);
      res.status(201).json(holder.toJSON());
    }),
  );

  router.get(
    '/',
    validate({ query: listHoldersQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await service.listRightsHolders(req.valid.query)));
    }),
  );

  router.get(
    '/:holderId',
    validate({ params: holderParams }),
    asyncHandler(async (req, res) => {
      res.json((await service.getRightsHolder(req.valid.params.holderId)).toJSON());
    }),
  );

  router.patch(
    '/:holderId',
    requireRole('admin'),
    validate({ params: holderParams, body: updateBody }),
    asyncHandler(async (req, res) => {
      const holder = await service.updateRightsHolder(req.valid.params.holderId, req.valid.body);
      res.json(holder.toJSON());
    }),
  );

  router.put(
    '/:holderId/remittance-currency',
    requireRole('admin'),
    validate({ params: holderParams, body: z.object({ currency }) }),
    asyncHandler(async (req, res) => {
      const holder = await service.setRemittanceCurrency(
        req.valid.params.holderId,
        req.valid.body.currency,
      );
      res.json(holder.toJSON());
    }),
  );

  router.delete(
    '/:holderId',
    requireRole('admin'),
    validate({ params: holderParams }),
    asyncHandler(async (req, res) => {
      const holder = await service.deactivate(req.valid.params.holderId);
      res.json(holder.toJSON());
    }),
  );

  return router;
}

module.exports = { rightsHolderRoutes };
