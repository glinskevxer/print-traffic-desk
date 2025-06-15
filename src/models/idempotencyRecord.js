'use strict';

const { Schema } = require('mongoose');

/**
 * A venue's booking desk retries on a timeout, and the first attempt may well
 * have landed. The key plus a hash of the request decides whether a second
 * call is the same call, and the stored response is replayed rather than a
 * second print being committed.
 */
const idempotencyRecordSchema = new Schema(
  {
    key: { type: String, required: true, maxlength: 120 },
    route: { type: String, required: true, maxlength: 120 },
    requestHash: { type: String, required: true, maxlength: 64 },
    state: { type: String, required: true, enum: ['in-flight', 'completed'], default: 'in-flight' },
    status: { type: Number, default: null, min: 100, max: 599 },
    body: { type: Schema.Types.Mixed, default: null },
    actor: { type: String, default: null, maxlength: 160 },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

idempotencyRecordSchema.index({ key: 1, route: 1 }, { unique: true });
// Keys are worth keeping for a day. A retry a week later is a new booking.
idempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = {
  name: 'IdempotencyRecord',
  schema: idempotencyRecordSchema,
  collection: 'idempotency_records',
};
