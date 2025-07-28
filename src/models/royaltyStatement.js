'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');

const STATEMENT_STATUSES = Object.freeze(['draft', 'issued', 'paid', 'void']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const lineSchema = new Schema(
  {
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    reference: { type: String, required: true, maxlength: 40 },
    titleSlug: { type: String, required: true, maxlength: 120 },
    venueCode: { type: String, required: true, maxlength: 40 },
    localDate: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
    admissions: { type: Number, required: true, min: 0 },
    grossMinor: { type: Number, required: true, min: 0 },
    royaltyMinor: { type: Number, required: true, min: 0 },
    basis: { type: String, required: true, maxlength: 200 },
  },
  { _id: false },
);

/**
 * What one licensor is owed for one period. Built from settled bookings and
 * then frozen: a statement that recalculates itself when a booking is amended
 * is a statement nobody can reconcile against a remittance advice.
 */
const royaltyStatementSchema = new Schema({
  rightsHolder: { type: Schema.Types.ObjectId, ref: 'RightsHolder', required: true },
  periodStartsOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
  periodEndsOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
  currency: { type: String, required: true, match: [/^[A-Z]{3}$/, 'ISO 4217 code'] },

  lines: { type: [lineSchema], default: [] },
  totalMinor: { type: Number, required: true, min: 0, default: 0 },
  screeningCount: { type: Number, required: true, min: 0, default: 0 },
  admissionsTotal: { type: Number, required: true, min: 0, default: 0 },
  grossTotalMinor: { type: Number, required: true, min: 0, default: 0 },

  status: { type: String, required: true, enum: STATEMENT_STATUSES, default: 'draft' },
  issuedOn: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },
  dueOn: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },
  paidOn: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },
  paymentReference: { type: String, default: null, maxlength: 80 },
  voidReason: { type: String, default: null, maxlength: 400 },
  notes: { type: String, maxlength: 2000 },
});

royaltyStatementSchema.plugin(basePlugin, { prefix: 'stmt' });
// One live statement per holder per period. A partial index cannot express
// "not void", so the live statuses are listed instead.
royaltyStatementSchema.index(
  { rightsHolder: 1, periodStartsOn: 1, periodEndsOn: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['draft', 'issued', 'paid'] } },
  },
);
royaltyStatementSchema.index({ status: 1, dueOn: 1 });

royaltyStatementSchema.pre('validate', function orderThePeriod(next) {
  if (this.periodEndsOn < this.periodStartsOn) {
    this.invalidate('periodEndsOn', 'a period cannot end before it starts');
  }
  next();
});

royaltyStatementSchema.methods.isFrozen = function isFrozen() {
  return this.status !== 'draft';
};

royaltyStatementSchema.methods.isOverdue = function isOverdue(today) {
  return this.status === 'issued' && this.dueOn !== null && this.dueOn < today;
};

module.exports = {
  name: 'RoyaltyStatement',
  schema: royaltyStatementSchema,
  collection: 'royalty_statements',
  STATEMENT_STATUSES,
};
