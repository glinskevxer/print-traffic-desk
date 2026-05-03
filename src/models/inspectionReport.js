'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');
const { ALL_CODES, SEVERITIES } = require('../domain/condition/damageCodes');
const { ALL_RESTRICTIONS } = require('../domain/handling');
const { GRADES } = require('../domain/condition/grade');

const INSPECTION_KINDS = Object.freeze([
  'intake',
  'routine',
  'pre-despatch',
  'post-screening',
  'damage',
]);

const findingSchema = new Schema(
  {
    reel: { type: Number, required: true, min: 1, max: 30 },
    footageMark: { type: Number, min: 0, max: 60000 },
    code: { type: String, required: true, enum: ALL_CODES },
    severity: { type: String, required: true, enum: SEVERITIES },
    note: { type: String, maxlength: 400 },
  },
  { _id: false },
);

const measurementSchema = new Schema(
  {
    shrinkagePercent: { type: Number, min: 0, max: 10, default: 0 },
    adStripLevel: { type: Number, min: 0, max: 3, default: 0 },
    warpMillimetres: { type: Number, min: 0, max: 50, default: 0 },
  },
  { _id: false },
);

const assessmentSchema = new Schema(
  {
    grade: { type: String, required: true, enum: GRADES },
    verdict: {
      type: String,
      required: true,
      enum: ['projectable', 'projectable-with-restrictions', 'quarantine'],
    },
    density: { type: Number, required: true, min: 0 },
    restrictions: { type: [String], default: [], enum: ALL_RESTRICTIONS },
    reasons: { type: [String], default: [] },
  },
  { _id: false },
);

/**
 * An inspection is a fact about a moment, never edited. A later inspection
 * supersedes it, which is why the element carries the current grade and this
 * collection carries the history.
 */
const inspectionReportSchema = new Schema({
  element: { type: Schema.Types.ObjectId, ref: 'PrintElement', required: true },
  inspectedAt: { type: Date, required: true, default: Date.now },
  inspector: { type: String, required: true, trim: true, maxlength: 120 },
  kind: { type: String, required: true, enum: INSPECTION_KINDS },
  atVenue: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },

  findings: { type: [findingSchema], default: [] },
  measurements: { type: measurementSchema, default: () => ({}) },
  footageInspected: { type: Number, required: true, min: 1, max: 60000 },

  assessment: { type: assessmentSchema, required: true },
  restrictionsCleared: { type: [String], default: [], enum: ALL_RESTRICTIONS },
  screeningsSinceLast: { type: Number, min: 0, default: 0 },

  source: { type: String, enum: ['manual', 'extracted'], default: 'manual' },
  notes: { type: String, maxlength: 4000 },
});

inspectionReportSchema.plugin(basePlugin, { prefix: 'insp' });
inspectionReportSchema.index({ element: 1, inspectedAt: -1 });
inspectionReportSchema.index({ 'assessment.verdict': 1, inspectedAt: -1 });
inspectionReportSchema.index({ inspector: 1, inspectedAt: -1 });

// A listing projects the findings away, and a virtual that assumes they are
// there turns a page of reports into a 500.
inspectionReportSchema.virtual('severeFindings').get(function severeFindings() {
  return (this.findings || []).filter((finding) => finding.severity === 'severe');
});

inspectionReportSchema.methods.isQuarantine = function isQuarantine() {
  return this.assessment.verdict === 'quarantine';
};

module.exports = {
  name: 'InspectionReport',
  schema: inspectionReportSchema,
  collection: 'inspection_reports',
  INSPECTION_KINDS,
};
