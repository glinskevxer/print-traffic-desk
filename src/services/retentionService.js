'use strict';

const { models } = require('../models');
const { RuleRefusedError } = require('../lib/errors');

/**
 * What the desk throws away, and what it keeps forever.
 *
 * Kept forever: audit events about money, rights and condition. A distributor
 * can query a statement years later and "we deleted it" is not an answer.
 *
 * Thrown away: the operational chaff. Idempotency keys stop being useful after
 * a day, sent messages after a month, and request scoped audit lines about
 * lists nobody reads twice.
 */

const KEEP_FOREVER = Object.freeze([
  'booking.',
  'statement.',
  'rights-window.',
  'element.inspected',
  'element.quarantined',
  'element.quarantined-overdue',
  'element.custody-changed',
  'title.merged',
  'operator.',
]);

const DEFAULT_RETENTION_DAYS = Object.freeze({
  auditEvents: 730,
  outboxMessages: 30,
  idempotencyRecords: 2,
  extractionJobs: 365,
});

function keepForever(action) {
  return KEEP_FOREVER.some((prefix) => String(action).startsWith(prefix));
}

function cutoff(days, now) {
  return new Date(now.getTime() - days * 86400000);
}

/**
 * Deletes in bounded batches. A single deleteMany over two years of audit
 * events holds a lock long enough to be noticed, and this runs on a schedule
 * where finishing next time is fine.
 */
async function pruneAuditEvents({ days, now, limit }) {
  const { AuditEvent } = models();
  const before = cutoff(days, now);

  const doomed = await AuditEvent.find({ at: { $lt: before } }, 'publicId action').limit(limit);

  const removable = doomed.filter((event) => !keepForever(event.action));
  if (removable.length === 0) return { examined: doomed.length, deleted: 0 };

  const result = await AuditEvent.deleteMany({
    publicId: { $in: removable.map((event) => event.publicId) },
  });
  return { examined: doomed.length, deleted: result.deletedCount };
}

async function pruneOutbox({ days, now, limit }) {
  const { OutboxMessage } = models();
  const before = cutoff(days, now);

  const doomed = await OutboxMessage.find(
    { status: 'sent', sentAt: { $lt: before } },
    'publicId',
  ).limit(limit);
  if (doomed.length === 0) return { examined: 0, deleted: 0 };

  const result = await OutboxMessage.deleteMany({
    publicId: { $in: doomed.map((message) => message.publicId) },
  });
  return { examined: doomed.length, deleted: result.deletedCount };
}

/**
 * The TTL index does this too, but a mongo that has been restored from a dump
 * comes back with the index and no background thread that has caught up yet,
 * and a stale key replaying a booking answer is worse than a slow prune.
 */
async function pruneIdempotency({ days, now, limit }) {
  const { IdempotencyRecord } = models();
  const before = cutoff(days, now);

  const doomed = await IdempotencyRecord.find({ createdAt: { $lt: before } }, '_id').limit(limit);
  if (doomed.length === 0) return { examined: 0, deleted: 0 };

  const result = await IdempotencyRecord.deleteMany({
    _id: { $in: doomed.map((record) => record._id) },
  });
  return { examined: doomed.length, deleted: result.deletedCount };
}

/** A rejected reading is chaff. An applied one is why a licence says what it says. */
async function pruneExtractionJobs({ days, now, limit }) {
  const { ExtractionJob } = models();
  const before = cutoff(days, now);

  const doomed = await ExtractionJob.find(
    { createdAt: { $lt: before }, status: { $in: ['failed', 'rejected'] } },
    'publicId',
  ).limit(limit);
  if (doomed.length === 0) return { examined: 0, deleted: 0 };

  const result = await ExtractionJob.deleteMany({
    publicId: { $in: doomed.map((job) => job.publicId) },
  });
  return { examined: doomed.length, deleted: result.deletedCount };
}

const PRUNERS = Object.freeze({
  auditEvents: pruneAuditEvents,
  outboxMessages: pruneOutbox,
  idempotencyRecords: pruneIdempotency,
  extractionJobs: pruneExtractionJobs,
});

async function prune({ only = null, days = {}, limit = 1000, now = new Date() } = {}) {
  const names = only ? [only] : Object.keys(PRUNERS);
  const unknown = names.filter((name) => !PRUNERS[name]);
  if (unknown.length > 0) {
    throw new RuleRefusedError(`${unknown.join(', ')} is not something the desk prunes`, {
      prunable: Object.keys(PRUNERS),
    });
  }

  const outcome = {};
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop
    outcome[name] = await PRUNERS[name]({
      days: days[name] || DEFAULT_RETENTION_DAYS[name],
      now,
      limit,
    });
  }
  return outcome;
}

module.exports = {
  prune,
  keepForever,
  KEEP_FOREVER,
  DEFAULT_RETENTION_DAYS,
  PRUNERS,
};
