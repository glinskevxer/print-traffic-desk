'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');
const { SERVICES } = require('../domain/traffic/carriers');

const SHIPMENT_STATUSES = Object.freeze([
  'planned',
  'collected',
  'in-transit',
  'delivered',
  'delayed',
  'lost',
  'cancelled',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const arrivalCheckSchema = new Schema(
  {
    checkedBy: { type: String, required: true, trim: true, maxlength: 120 },
    cansReceived: { type: Number, required: true, min: 0, max: 40 },
    sealsIntact: { type: Boolean, default: true },
    notes: { type: String, maxlength: 1000 },
    inspectionReport: { type: Schema.Types.ObjectId, ref: 'InspectionReport', default: null },
  },
  { _id: false },
);

/**
 * One leg. A print going out and coming back is two shipments, because the two
 * legs have different carriers, different dates and different people signing
 * for them, and treating them as one row lost a return leg for six weeks.
 */
const shipmentSchema = new Schema({
  element: { type: Schema.Types.ObjectId, ref: 'PrintElement', required: true },
  fromVenue: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },
  toVenue: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },
  leg: { type: String, required: true, enum: ['outbound', 'return', 'transfer'] },

  service: { type: String, required: true, enum: SERVICES },
  carrier: { type: String, trim: true, maxlength: 80 },
  trackingReference: { type: String, trim: true, maxlength: 80 },

  plannedDispatchOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
  plannedArrivalOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
  dispatchedOn: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },
  arrivedOn: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },

  cans: { type: Number, min: 1, max: 40 },
  weightKilos: { type: Number, min: 0, max: 500 },
  insuredValueMinor: { type: Number, min: 0 },
  insuredValueCurrency: { type: String, match: [/^[A-Z]{3}$/, 'ISO 4217 code'] },

  status: { type: String, required: true, enum: SHIPMENT_STATUSES, default: 'planned' },
  arrivalCheck: { type: arrivalCheckSchema, default: null },
  lostReportedOn: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },
  notes: { type: String, maxlength: 2000 },
});

shipmentSchema.plugin(basePlugin, { prefix: 'shp' });
shipmentSchema.index({ element: 1, plannedDispatchOn: 1 });
shipmentSchema.index({ status: 1, plannedArrivalOn: 1 });
shipmentSchema.index({ toVenue: 1, status: 1 });
shipmentSchema.index({ trackingReference: 1 }, { sparse: true });

shipmentSchema.pre('validate', function orderTheLeg(next) {
  if (this.plannedArrivalOn < this.plannedDispatchOn) {
    this.invalidate('plannedArrivalOn', 'a leg cannot arrive before it leaves');
  }
  if (this.arrivedOn && this.dispatchedOn && this.arrivedOn < this.dispatchedOn) {
    this.invalidate('arrivedOn', 'a leg cannot arrive before it leaves');
  }
  if (String(this.fromVenue) === String(this.toVenue)) {
    this.invalidate('toVenue', 'a leg has to go somewhere else');
  }
  next();
});

shipmentSchema.methods.isOpen = function isOpen() {
  return ['planned', 'collected', 'in-transit', 'delayed'].includes(this.status);
};

shipmentSchema.methods.isLate = function isLate(today) {
  return this.isOpen() && this.status !== 'planned' && this.plannedArrivalOn < today;
};

module.exports = {
  name: 'Shipment',
  schema: shipmentSchema,
  collection: 'shipments',
  SHIPMENT_STATUSES,
};
