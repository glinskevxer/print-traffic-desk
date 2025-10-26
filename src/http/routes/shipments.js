'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { publicId, listQuery, isoDate } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { SERVICES } = require('../../domain/traffic/carriers');
const { SHIPMENT_STATUSES } = require('../../models/shipment');
const service = require('../../services/shipmentService');

const planBody = z.object({
  elementId: publicId('elem'),
  toVenueId: publicId('ven'),
  leg: z.enum(['outbound', 'return', 'transfer']).default('outbound'),
  screeningLocalDate: isoDate,
  today: isoDate.optional(),
  service: z.enum(SERVICES).optional(),
  holdDays: z.number().int().min(0).max(30).default(1),
});

const dispatchBody = z.object({
  dispatchedOn: isoDate,
  carrier: z.string().min(2).max(80).optional(),
  trackingReference: z.string().min(2).max(80).optional(),
});

const arrivalBody = z.object({
  arrivedOn: isoDate,
  arrivalCheck: z
    .object({
      checkedBy: z.string().min(2).max(120),
      cansReceived: z.number().int().min(0).max(40),
      sealsIntact: z.boolean().default(true),
      notes: z.string().max(1000).optional(),
    })
    .optional(),
});

const listShipmentsQuery = listQuery.extend({
  elementId: publicId('elem').optional(),
  venueId: publicId('ven').optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  leg: z.enum(['outbound', 'return', 'transfer']).optional(),
  openOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sortBy: z.enum(['plannedDispatchOn', 'plannedArrivalOn', 'createdAt']).default('plannedDispatchOn'),
});

const shipmentParams = z.object({ shipmentId: publicId('shp') });

function today() {
  return new Date().toISOString().slice(0, 10);
}

function shipmentRoutes() {
  const router = Router();

  router.post(
    '/',
    requireRole('traffic'),
    validate({ body: planBody }),
    asyncHandler(async (req, res) => {
      const { shipment, plan } = await service.planLeg({
        ...req.valid.body,
        today: req.valid.body.today || today(),
      });
      res.status(201).json({ ...shipment.toJSON(), plan: plan.dates, quote: plan.quote });
    }),
  );

  router.get(
    '/',
    validate({ query: listShipmentsQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await service.listShipments(req.valid.query)));
    }),
  );

  router.get(
    '/overdue',
    validate({ query: z.object({ asOf: isoDate.optional() }) }),
    asyncHandler(async (req, res) => {
      const legs = await service.overdueArrivals(req.valid.query.asOf || today());
      res.json({
        items: legs.map((leg) => ({
          id: leg.publicId,
          status: leg.status,
          plannedArrivalOn: leg.plannedArrivalOn,
          trackingReference: leg.trackingReference,
        })),
      });
    }),
  );

  router.get(
    '/:shipmentId',
    validate({ params: shipmentParams }),
    asyncHandler(async (req, res) => {
      res.json((await service.loadShipment(req.valid.params.shipmentId)).toJSON());
    }),
  );

  router.put(
    '/:shipmentId/dispatch',
    requireRole('traffic'),
    validate({ params: shipmentParams, body: dispatchBody }),
    asyncHandler(async (req, res) => {
      const { shipment, element } = await service.dispatch(
        req.valid.params.shipmentId,
        req.valid.body,
      );
      res.json({ ...shipment.toJSON(), element: { id: element.publicId, status: element.status } });
    }),
  );

  router.put(
    '/:shipmentId/arrival',
    requireRole('traffic'),
    validate({ params: shipmentParams, body: arrivalBody }),
    asyncHandler(async (req, res) => {
      const { shipment, element } = await service.markArrived(
        req.valid.params.shipmentId,
        req.valid.body,
      );
      res.json({
        ...shipment.toJSON(),
        element: { id: element.publicId, status: element.status, location: element.currentLocation },
      });
    }),
  );

  router.put(
    '/:shipmentId/delay',
    requireRole('traffic'),
    validate({ params: shipmentParams, body: z.object({ reason: z.string().min(3).max(2000) }) }),
    asyncHandler(async (req, res) => {
      const shipment = await service.markDelayed(
        req.valid.params.shipmentId,
        req.valid.body.reason,
      );
      res.json(shipment.toJSON());
    }),
  );

  router.put(
    '/:shipmentId/lost',
    requireRole('traffic'),
    validate({
      params: shipmentParams,
      body: z.object({ reportedOn: isoDate, reason: z.string().min(3).max(2000) }),
    }),
    asyncHandler(async (req, res) => {
      const { shipment, element } = await service.markLost(
        req.valid.params.shipmentId,
        req.valid.body,
      );
      res.json({ ...shipment.toJSON(), element: { id: element.publicId, status: element.status } });
    }),
  );

  return router;
}

module.exports = { shipmentRoutes };
