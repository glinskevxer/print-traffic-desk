'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { idempotency } = require('../middleware/idempotency');
const {
  publicId,
  listQuery,
  isoDate,
  localTime,
  currency,
  minorAmount,
} = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { EXHIBITION_TYPES } = require('../../models/rightsWindow');
const { BOOKING_STATUSES } = require('../../models/booking');
const service = require('../../services/bookingService');

const requestBody = z.object({
  titleId: publicId('ttl'),
  venueId: publicId('ven'),
  elementId: publicId('elem').optional(),
  localDate: isoDate,
  localTime,
  exhibitionType: z.enum(EXHIBITION_TYPES).default('repertory'),
  holdMinutes: z.number().int().min(15).max(20160).optional(),
  holdDaysAfterScreening: z.number().int().min(0).max(30).optional(),
  today: isoDate.optional(),
  bookedBy: z.string().min(3).max(160).optional(),
  notes: z.string().max(2000).optional(),
});

const boxOfficeBody = z.object({
  grossMinor: minorAmount,
  currency,
  admissions: z.number().int().min(0).max(20000),
  houseNutMinor: minorAmount.optional(),
  reportedBy: z.string().min(3).max(120).optional(),
});

const listBookingsQuery = listQuery.extend({
  titleId: publicId('ttl').optional(),
  venueId: publicId('ven').optional(),
  elementId: publicId('elem').optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sortBy: z.enum(['screeningAt', 'localDate', 'createdAt']).default('screeningAt'),
});

const bookingParams = z.object({ bookingId: publicId('bkg') });

function bookingView(booking) {
  return booking.toJSON();
}

function bookingRoutes() {
  const router = Router();

  router.post(
    '/',
    requireRole('programmer'),
    idempotency(),
    validate({ body: requestBody }),
    asyncHandler(async (req, res) => {
      const { booking, element, plan, decision } = await service.requestBooking({
        ...req.valid.body,
        idempotencyKey: req.get('idempotency-key') || null,
      });

      res.status(201).json({
        ...bookingView(booking),
        element: { id: element.publicId, barcode: element.barcode, grade: element.conditionGrade },
        clearedUnder: decision.windowId,
        traffic: {
          ...booking.traffic.toJSON(),
          outbound: plan.outbound.dates,
          back: plan.inbound.dates,
        },
      });
    }),
  );

  router.get(
    '/',
    validate({ query: listBookingsQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await service.listBookings(req.valid.query)));
    }),
  );

  router.get(
    '/awaiting-box-office',
    validate({ query: z.object({ asOf: isoDate }) }),
    asyncHandler(async (req, res) => {
      const waiting = await service.awaitingBoxOffice(req.valid.query.asOf);
      res.json({
        items: waiting.map((booking) => ({
          id: booking.publicId,
          reference: booking.reference,
          localDate: booking.localDate,
        })),
      });
    }),
  );

  router.get(
    '/:bookingId',
    validate({ params: bookingParams }),
    asyncHandler(async (req, res) => {
      res.json(bookingView(await service.getBooking(req.valid.params.bookingId)));
    }),
  );

  router.put(
    '/:bookingId/confirm',
    requireRole('programmer'),
    validate({
      params: bookingParams,
      body: z.object({ confirmedBy: z.string().min(3).max(160).optional() }).default({}),
    }),
    asyncHandler(async (req, res) => {
      const { booking, shipments } = await service.confirmBooking(
        req.valid.params.bookingId,
        req.valid.body,
      );
      res.json({
        ...bookingView(booking),
        shipments: shipments.map((leg) => ({ id: leg.publicId, leg: leg.leg })),
      });
    }),
  );

  router.put(
    '/:bookingId/box-office',
    requireRole('programmer'),
    validate({ params: bookingParams, body: boxOfficeBody }),
    asyncHandler(async (req, res) => {
      const { booking, royalty } = await service.reportBoxOffice(
        req.valid.params.bookingId,
        req.valid.body,
      );
      res.json({ ...bookingView(booking), royalty });
    }),
  );

  router.put(
    '/:bookingId/settle',
    requireRole('admin'),
    validate({ params: bookingParams, body: z.object({ settledOn: isoDate }) }),
    asyncHandler(async (req, res) => {
      const booking = await service.settleBooking(
        req.valid.params.bookingId,
        req.valid.body.settledOn,
      );
      res.json(bookingView(booking));
    }),
  );

  router.delete(
    '/:bookingId',
    requireRole('programmer'),
    validate({
      params: bookingParams,
      body: z.object({ reason: z.string().min(3).max(400), feeMinor: minorAmount.optional() }),
    }),
    asyncHandler(async (req, res) => {
      const { booking, legsCancelled } = await service.cancelBooking(
        req.valid.params.bookingId,
        req.valid.body,
      );
      res.json({ ...bookingView(booking), legsCancelled });
    }),
  );

  return router;
}

module.exports = { bookingRoutes };
