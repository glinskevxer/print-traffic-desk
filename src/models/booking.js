'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');
const { BOOKING_REFERENCE_PATTERN } = require('../lib/ids');
const { EXHIBITION_TYPES } = require('./rightsWindow');

const BOOKING_STATUSES = Object.freeze([
  'held',
  'cleared',
  'confirmed',
  'cancelled',
  'lapsed',
  'settled',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const clearanceSchema = new Schema(
  {
    windowId: { type: String, default: null, maxlength: 40 },
    clearedAt: { type: Date, default: null },
    outcomes: {
      type: [
        new Schema(
          {
            code: { type: String, required: true, maxlength: 40 },
            ok: { type: Boolean, required: true },
            detail: { type: String, maxlength: 400 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const trafficSchema = new Schema(
  {
    outboundShipment: { type: Schema.Types.ObjectId, ref: 'Shipment', default: null },
    returnShipment: { type: Schema.Types.ObjectId, ref: 'Shipment', default: null },
    committedFrom: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },
    committedUntil: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },
    service: { type: String, default: null, maxlength: 30 },
  },
  { _id: false },
);

const boxOfficeSchema = new Schema(
  {
    grossMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, match: [/^[A-Z]{3}$/, 'ISO 4217 code'] },
    admissions: { type: Number, required: true, min: 0, max: 20000 },
    houseNutMinor: { type: Number, min: 0, default: 0 },
    reportedAt: { type: Date, default: Date.now },
    reportedBy: { type: String, maxlength: 120 },
  },
  { _id: false },
);

/**
 * One screening of one element at one house on one date. A run of three nights
 * is three bookings sharing a traffic plan, because the box office, the
 * royalty and the licence count are all per screening.
 */
const bookingSchema = new Schema({
  reference: {
    type: String,
    required: true,
    uppercase: true,
    match: [BOOKING_REFERENCE_PATTERN, 'reference is BK-YYYY-DDD-XXXX'],
  },
  title: { type: Schema.Types.ObjectId, ref: 'Title', required: true },
  venue: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },
  element: { type: Schema.Types.ObjectId, ref: 'PrintElement', default: null },
  rightsWindow: { type: Schema.Types.ObjectId, ref: 'RightsWindow', default: null },

  screeningAt: { type: Date, required: true },
  localDate: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
  localTime: { type: String, required: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm'] },
  exhibitionType: { type: String, required: true, enum: EXHIBITION_TYPES },

  status: { type: String, required: true, enum: BOOKING_STATUSES, default: 'held' },
  holdExpiresAt: { type: Date, default: null },
  clearance: { type: clearanceSchema, default: () => ({}) },
  traffic: { type: trafficSchema, default: () => ({}) },

  boxOffice: { type: boxOfficeSchema, default: null },
  royaltyMinor: { type: Number, default: null, min: 0 },
  royaltyCurrency: { type: String, default: null, match: [/^[A-Z]{3}$/, 'ISO 4217 code'] },
  royaltyBasis: { type: String, default: null, maxlength: 200 },
  settledOn: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },

  cancellation: {
    reason: { type: String, default: null, maxlength: 400 },
    at: { type: Date, default: null },
    feeMinor: { type: Number, default: null, min: 0 },
  },

  idempotencyKey: { type: String, default: null, maxlength: 120 },
  bookedBy: { type: String, maxlength: 160 },
  notes: { type: String, maxlength: 2000 },
});

bookingSchema.plugin(basePlugin, { prefix: 'bkg' });
bookingSchema.index({ reference: 1 }, { unique: true });
// A sparse unique index still collides on two explicit nulls, and most
// bookings are taken over the phone with no key at all.
bookingSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
bookingSchema.index({ title: 1, localDate: 1 });
bookingSchema.index({ venue: 1, screeningAt: 1 });
bookingSchema.index({ element: 1, status: 1 });
bookingSchema.index({ rightsWindow: 1, status: 1 });
bookingSchema.index({ status: 1, holdExpiresAt: 1 });

bookingSchema.methods.isLive = function isLive() {
  return ['held', 'cleared', 'confirmed'].includes(this.status);
};

// A hold counts against the licence allowance from the moment it is taken.
// It used to count only once cleared, and two houses holding the last
// screening of a capped licence both got told yes.
bookingSchema.methods.countsAgainstLicence = function countsAgainstLicence() {
  return ['held', 'cleared', 'confirmed', 'settled'].includes(this.status);
};

bookingSchema.methods.hasLapsed = function hasLapsed(now = new Date()) {
  return this.status === 'held' && this.holdExpiresAt !== null && this.holdExpiresAt <= now;
};

module.exports = {
  name: 'Booking',
  schema: bookingSchema,
  collection: 'bookings',
  BOOKING_STATUSES,
};
