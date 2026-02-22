'use strict';

const { Schema } = require('mongoose');
const { basePlugin } = require('./plugins/base');

/**
 * Messages the desk owes the outside world: a despatch note to a venue, a
 * statement to a licensor, a quarantine notice to whoever owns the print.
 *
 * They are written in the same transaction as the thing that caused them, so a
 * booking that rolled back never sends a despatch note, and a booking that
 * committed always eventually does. Nothing is sent from inside a request.
 */

const MESSAGE_KINDS = Object.freeze([
  'booking.confirmed',
  'booking.cancelled',
  'shipment.dispatched',
  'element.quarantined',
  'statement.issued',
]);

const DELIVERY_STATUSES = Object.freeze(['pending', 'sending', 'sent', 'failed', 'abandoned']);

const attemptSchema = new Schema(
  {
    at: { type: Date, required: true, default: Date.now },
    outcome: { type: String, required: true, enum: ['sent', 'failed'] },
    detail: { type: String, maxlength: 400 },
    elapsedMs: { type: Number, min: 0 },
  },
  { _id: false },
);

const outboxMessageSchema = new Schema({
  kind: { type: String, required: true, enum: MESSAGE_KINDS },
  subjectType: { type: String, required: true, maxlength: 40 },
  subjectId: { type: String, required: true, maxlength: 40 },

  to: { type: String, required: true, maxlength: 200 },
  channel: { type: String, required: true, enum: ['email', 'webhook', 'log'], default: 'log' },
  payload: { type: Schema.Types.Mixed, required: true },

  status: { type: String, required: true, enum: DELIVERY_STATUSES, default: 'pending' },
  attempts: { type: [attemptSchema], default: [] },
  availableAt: { type: Date, required: true, default: Date.now },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: null, maxlength: 400 },
});

outboxMessageSchema.plugin(basePlugin, { prefix: 'out' });
outboxMessageSchema.index({ status: 1, availableAt: 1 });
outboxMessageSchema.index({ subjectType: 1, subjectId: 1 });
outboxMessageSchema.index({ kind: 1, createdAt: -1 });

/** Six tries over about an hour, then a person has to look at it. */
const MAX_ATTEMPTS = 6;

outboxMessageSchema.methods.failureCount = function failureCount() {
  return this.attempts.filter((attempt) => attempt.outcome === 'failed').length;
};

outboxMessageSchema.methods.isExhausted = function isExhausted() {
  return this.failureCount() >= MAX_ATTEMPTS;
};

/** Backoff doubles and is capped, so a dead endpoint is retried hourly. */
outboxMessageSchema.methods.nextAttemptAt = function nextAttemptAt(now = new Date()) {
  const failures = this.failureCount();
  const delayMs = Math.min(3600000, 30000 * 2 ** Math.max(0, failures - 1));
  return new Date(now.getTime() + delayMs);
};

module.exports = {
  name: 'OutboxMessage',
  schema: outboxMessageSchema,
  collection: 'outbox_messages',
  MESSAGE_KINDS,
  DELIVERY_STATUSES,
  MAX_ATTEMPTS,
};
