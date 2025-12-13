'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');
const { EXTRACTION_KINDS } = require('../ai/schemas');

const JOB_STATUSES = Object.freeze([
  'queued',
  'running',
  'succeeded',
  'failed',
  'applied',
  'rejected',
]);

const usageSchema = new Schema(
  {
    promptTokens: { type: Number, default: 0, min: 0 },
    completionTokens: { type: Number, default: 0, min: 0 },
    costHundredthCents: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const attemptSchema = new Schema(
  {
    at: { type: Date, required: true, default: Date.now },
    outcome: { type: String, required: true, enum: ['succeeded', 'failed'] },
    errorCode: { type: String, default: null, maxlength: 60 },
    errorMessage: { type: String, default: null, maxlength: 500 },
    elapsedMs: { type: Number, default: null, min: 0 },
  },
  { _id: false },
);

/**
 * One reading of one document. The input is stored as a hash and a short
 * preview rather than in full: licence letters are commercially sensitive and
 * the desk has no business keeping a second copy of them.
 */
const extractionJobSchema = new Schema({
  kind: { type: String, required: true, enum: EXTRACTION_KINDS },
  subjectType: { type: String, required: true, enum: ['title', 'print-element'] },
  subject: { type: Schema.Types.ObjectId, required: true },
  subjectPublicId: { type: String, required: true, maxlength: 40 },

  inputHash: { type: String, required: true, maxlength: 64 },
  // A preview is a preview. Truncating here rather than validating means no
  // caller can accidentally store a licence letter in the job record.
  inputPreview: {
    type: String,
    required: true,
    maxlength: 240,
    set: (value) => String(value).slice(0, 240),
  },
  inputLength: { type: Number, required: true, min: 0 },

  // model is what was asked for and forms part of the cache key. resolvedModel
  // is the dated build the API actually answered with, which is what is priced.
  model: { type: String, required: true, maxlength: 60 },
  resolvedModel: { type: String, default: null, maxlength: 60 },
  promptVersion: { type: String, required: true, maxlength: 40 },

  status: { type: String, required: true, enum: JOB_STATUSES, default: 'queued' },
  attempts: { type: [attemptSchema], default: [] },
  usage: { type: usageSchema, default: () => ({}) },

  result: { type: Schema.Types.Mixed, default: null },
  confidence: { type: Number, default: null, min: 0, max: 1 },
  needsHumanReview: { type: Boolean, default: true },

  appliedTo: { type: String, default: null, maxlength: 40 },
  reviewedBy: { type: String, default: null, maxlength: 160 },
  reviewedAt: { type: Date, default: null },
  rejectedReason: { type: String, default: null, maxlength: 400 },
  requestedBy: { type: String, default: null, maxlength: 160 },
});

extractionJobSchema.plugin(basePlugin, { prefix: 'exj' });
extractionJobSchema.index({ kind: 1, inputHash: 1, model: 1, promptVersion: 1 });
extractionJobSchema.index({ subjectType: 1, subject: 1, createdAt: -1 });
extractionJobSchema.index({ status: 1, createdAt: -1 });
extractionJobSchema.index({ createdAt: -1 });

extractionJobSchema.virtual('totalTokens').get(function totalTokens() {
  return this.usage.promptTokens + this.usage.completionTokens;
});

extractionJobSchema.methods.isReusable = function isReusable() {
  return this.status === 'succeeded' || this.status === 'applied';
};

extractionJobSchema.methods.failureCount = function failureCount() {
  return this.attempts.filter((attempt) => attempt.outcome === 'failed').length;
};

module.exports = {
  name: 'ExtractionJob',
  schema: extractionJobSchema,
  collection: 'extraction_jobs',
  JOB_STATUSES,
};
