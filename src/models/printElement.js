'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');
const {
  GAUGES,
  SOUND_FORMATS,
  ASPECT_RATIOS,
  BASE_STOCKS,
  ELEMENT_KINDS,
  PROJECTION_SPEEDS,
} = require('../domain/formats');
const { ALL_RESTRICTIONS } = require('../domain/handling');

const ELEMENT_STATUSES = Object.freeze([
  'intake',
  'available',
  'committed',
  'in-transit',
  'on-loan',
  'quarantined',
  'retired',
]);

const CONDITION_GRADES = Object.freeze(['A', 'B', 'C', 'D']);

const subtitleSchema = new Schema(
  {
    language: { type: String, required: true, match: [/^[a-z]{2,3}$/, 'ISO 639 code'] },
    kind: { type: String, required: true, enum: ['burned-in', 'electronic', 'inserted-titles'] },
  },
  { _id: false },
);

/**
 * One physical thing on a shelf. Two prints of the same film are two elements
 * and they are booked separately, because their condition, their track and the
 * restrictions on them all differ.
 */
const printElementSchema = new Schema({
  barcode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: [/^PE-[0-9]{6}$/, 'barcode is PE- followed by six digits'],
  },
  title: { type: Schema.Types.ObjectId, ref: 'Title', required: true },
  kind: { type: String, required: true, enum: ELEMENT_KINDS },
  gauge: { type: String, required: true, enum: GAUGES },
  baseStock: { type: String, required: true, enum: BASE_STOCKS },
  aspectRatio: { type: String, required: true, enum: ASPECT_RATIOS },
  soundFormat: { type: String, required: true, enum: SOUND_FORMATS },
  projectionSpeed: { type: Number, default: 24, enum: PROJECTION_SPEEDS },
  footage: { type: Number, required: true, min: 1, max: 60000 },
  reelCount: { type: Number, required: true, min: 1, max: 30 },
  subtitles: { type: [subtitleSchema], default: [] },
  printLanguage: { type: String, match: [/^[a-z]{2,3}$/, 'ISO 639 code'] },

  owner: { type: Schema.Types.ObjectId, ref: 'RightsHolder', required: true },
  custodian: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },
  currentLocation: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },

  status: { type: String, required: true, enum: ELEMENT_STATUSES, default: 'intake' },
  conditionGrade: { type: String, enum: CONDITION_GRADES, default: null },
  handlingRestrictions: { type: [String], default: [], enum: ALL_RESTRICTIONS },

  screeningsSinceInspection: { type: Number, default: 0, min: 0 },
  inspectionIntervalScreenings: { type: Number, default: 6, min: 1, max: 60 },
  lastInspectedOn: { type: String, default: null, match: [/^\d{4}-\d{2}-\d{2}$/, 'ISO date'] },
  acquiredOn: { type: String, match: [/^\d{4}-\d{2}-\d{2}$/, 'ISO date'] },

  provenance: { type: String, maxlength: 2000 },
  shelfMark: { type: String, trim: true, maxlength: 40 },
  insuredValueMinor: { type: Number, min: 0 },
  insuredValueCurrency: { type: String, match: [/^[A-Z]{3}$/, 'ISO 4217 code'] },
});

printElementSchema.plugin(basePlugin, { prefix: 'elem' });
printElementSchema.index({ barcode: 1 }, { unique: true });
printElementSchema.index({ title: 1, status: 1 });
printElementSchema.index({ currentLocation: 1, status: 1 });
printElementSchema.index({ owner: 1 });

printElementSchema.virtual('runningMinutesAt24').get(function runningMinutes() {
  if (this.gauge === '16mm' || this.gauge === 'super16') return this.footage / 36;
  if (this.gauge === '70mm') return this.footage / 112.5;
  return this.footage / 90;
});

printElementSchema.methods.needsInspection = function needsInspection() {
  if (!this.lastInspectedOn) return true;
  return this.screeningsSinceInspection >= this.inspectionIntervalScreenings;
};

printElementSchema.methods.isCirculating = function isCirculating() {
  return ['available', 'committed', 'in-transit', 'on-loan'].includes(this.status);
};

printElementSchema.methods.hasRestriction = function hasRestriction(restriction) {
  return this.handlingRestrictions.includes(restriction);
};

module.exports = {
  name: 'PrintElement',
  schema: printElementSchema,
  collection: 'print_elements',
  ELEMENT_STATUSES,
  CONDITION_GRADES,
};
