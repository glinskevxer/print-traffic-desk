'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');
const { REGION_CODES } = require('../domain/rights/territories');

const EXHIBITION_TYPES = Object.freeze([
  'repertory',
  'festival',
  'educational',
  'commercial',
  'private',
]);

const TERM_KINDS = Object.freeze(['flat', 'percentage', 'greater-of', 'split-after-nut']);

const EXCLUSIVITY_SCOPES = Object.freeze(['none', 'city', 'territory']);

const WINDOW_STATUSES = Object.freeze(['draft', 'active', 'suspended', 'expired']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const termsSchema = new Schema(
  {
    kind: { type: String, required: true, enum: TERM_KINDS },
    currency: { type: String, required: true, match: [/^[A-Z]{3}$/, 'ISO 4217 code'] },
    flatFeeMinor: { type: Number, min: 0, default: null },
    percentageBps: { type: Number, min: 0, max: 10000, default: null },
    minimumGuaranteeMinor: { type: Number, min: 0, default: null },
    houseNutDeductible: { type: Boolean, default: false },
    capMinor: { type: Number, min: 0, default: null },
  },
  { _id: false },
);

const blackoutSchema = new Schema(
  {
    startsOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
    endsOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
    reason: { type: String, maxlength: 200 },
  },
  { _id: false },
);

/**
 * One licence statement: this holder allows this title to be shown in this
 * territory, for this kind of exhibition, between these dates, on these terms.
 * Everything a booking has to satisfy is here, and a booking that satisfies no
 * window does not happen.
 */
const rightsWindowSchema = new Schema({
  title: { type: Schema.Types.ObjectId, ref: 'Title', required: true },
  rightsHolder: { type: Schema.Types.ObjectId, ref: 'RightsHolder', required: true },
  reference: { type: String, trim: true, maxlength: 80 },

  territory: {
    type: String,
    required: true,
    validate: {
      validator: (value) => /^[A-Z]{2}$/.test(value) || REGION_CODES.includes(value),
      message: 'territory must be an alpha-2 code or a named region',
    },
  },
  exhibitionTypes: {
    type: [String],
    required: true,
    enum: EXHIBITION_TYPES,
    validate: { validator: (v) => v.length > 0, message: 'a window covers at least one kind' },
  },

  startsOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
  endsOn: { type: String, required: true, match: [ISO_DATE, 'ISO date'] },
  holdbackUntil: { type: String, default: null, match: [ISO_DATE, 'ISO date'] },

  maxScreenings: { type: Number, default: null, min: 1, max: 10000 },
  screeningsUsed: { type: Number, default: 0, min: 0 },
  maxScreeningsPerVenue: { type: Number, default: null, min: 1, max: 1000 },

  exclusivity: {
    scope: { type: String, enum: EXCLUSIVITY_SCOPES, default: 'none' },
    heldBy: { type: Schema.Types.ObjectId, ref: 'Venue', default: null },
  },
  blackouts: { type: [blackoutSchema], default: [] },

  terms: { type: termsSchema, required: true },
  status: { type: String, enum: WINDOW_STATUSES, default: 'draft', index: true },
  suspendedReason: { type: String, maxlength: 400 },

  sourceDocument: {
    extractionJob: { type: Schema.Types.ObjectId, ref: 'ExtractionJob', default: null },
    confidence: { type: Number, min: 0, max: 1, default: null },
    reviewedBy: { type: String, default: null, maxlength: 120 },
  },
  notes: { type: String, maxlength: 4000 },
});

rightsWindowSchema.plugin(basePlugin, { prefix: 'rw' });
rightsWindowSchema.index({ title: 1, status: 1, startsOn: 1, endsOn: 1 });
rightsWindowSchema.index({ territory: 1, status: 1 });
rightsWindowSchema.index({ rightsHolder: 1, status: 1 });
rightsWindowSchema.index({ 'exclusivity.scope': 1, status: 1 });

rightsWindowSchema.pre('validate', function orderTheWindow(next) {
  if (this.startsOn && this.endsOn && this.endsOn < this.startsOn) {
    this.invalidate('endsOn', 'a window cannot end before it starts');
  }
  if (this.holdbackUntil && this.holdbackUntil > this.endsOn) {
    this.invalidate('holdbackUntil', 'a holdback that outlasts the window licences nothing');
  }
  if (this.exclusivity.scope !== 'none' && !this.exclusivity.heldBy) {
    this.invalidate('exclusivity.heldBy', 'an exclusive window has to name the house holding it');
  }
  next();
});

rightsWindowSchema.virtual('screeningsRemaining').get(function remaining() {
  if (this.maxScreenings === null) return null;
  return Math.max(0, this.maxScreenings - this.screeningsUsed);
});

rightsWindowSchema.methods.isExhausted = function isExhausted() {
  return this.maxScreenings !== null && this.screeningsUsed >= this.maxScreenings;
};

rightsWindowSchema.methods.isExclusive = function isExclusive() {
  return this.exclusivity.scope !== 'none';
};

module.exports = {
  name: 'RightsWindow',
  schema: rightsWindowSchema,
  collection: 'rights_windows',
  EXHIBITION_TYPES,
  TERM_KINDS,
  EXCLUSIVITY_SCOPES,
  WINDOW_STATUSES,
};
