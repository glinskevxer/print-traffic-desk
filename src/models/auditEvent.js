'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');

const SUBJECT_TYPES = Object.freeze([
  'operator',
  'title',
  'venue',
  'rights-holder',
  'print-element',
  'inspection-report',
  'rights-window',
  'booking',
  'shipment',
  'royalty-statement',
]);

/**
 * Who changed what, and to what. Distributors audit the desk, so the answer to
 * "who released that quarantine" has to survive the person who did it leaving.
 */
const auditEventSchema = new Schema({
  at: { type: Date, required: true, default: Date.now },
  action: { type: String, required: true, trim: true, maxlength: 80 },
  subjectType: { type: String, required: true, enum: SUBJECT_TYPES },
  subjectId: { type: String, required: true, maxlength: 40 },
  actor: { type: String, default: null, maxlength: 160 },
  requestId: { type: String, default: null, maxlength: 64 },
  source: { type: String, enum: ['http', 'cli', 'worker', 'system'], default: 'system' },
  changes: {
    type: [
      new Schema(
        {
          field: { type: String, required: true, maxlength: 80 },
          before: { type: Schema.Types.Mixed, default: null },
          after: { type: Schema.Types.Mixed, default: null },
        },
        { _id: false },
      ),
    ],
    default: [],
  },
  metadata: { type: Schema.Types.Mixed, default: {} },
});

auditEventSchema.plugin(basePlugin, { prefix: 'aud' });
auditEventSchema.index({ subjectType: 1, subjectId: 1, at: -1 });
auditEventSchema.index({ actor: 1, at: -1 });
auditEventSchema.index({ action: 1, at: -1 });
auditEventSchema.index({ at: -1 });

module.exports = {
  name: 'AuditEvent',
  schema: auditEventSchema,
  collection: 'audit_events',
  SUBJECT_TYPES,
};
