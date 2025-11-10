'use strict';

const { Schema } = require('mongoose');

/**
 * A fixed window counter, one document per key and window. In mongo rather
 * than in memory because the desk runs two processes behind a load balancer,
 * and a per process limit is two limits.
 */
const rateCounterSchema = new Schema(
  {
    key: { type: String, required: true, maxlength: 200 },
    windowStartedAt: { type: Date, required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

rateCounterSchema.index({ key: 1, windowStartedAt: 1 }, { unique: true });
rateCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = { name: 'RateCounter', schema: rateCounterSchema, collection: 'rate_counters' };
