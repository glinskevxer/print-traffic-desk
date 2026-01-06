'use strict';

const { models } = require('../models');
const { currentContext } = require('./context');
const { paginate } = require('./pagination');

/**
 * A change list, not a document copy. Storing whole before and after documents
 * put a hundred megabytes of unread mongo in the first month and still did not
 * answer what actually changed.
 */
function diffFields(before = {}, after = {}, fields) {
  const names = fields || [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes = [];

  for (const field of names) {
    const wasValue = normalise(before[field]);
    const isValue = normalise(after[field]);
    if (JSON.stringify(wasValue) !== JSON.stringify(isValue)) {
      changes.push({ field, before: wasValue, after: isValue });
    }
  }
  return changes;
}

function normalise(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value.toJSON === 'function' && typeof value !== 'string') {
    return value.toJSON();
  }
  return value;
}

/**
 * Writes one event. Takes the session so an audit and the change it describes
 * commit together: an audit trail with entries for writes that rolled back is
 * worse than none.
 */
async function record(
  { action, subjectType, subjectId, changes = [], metadata = {} },
  { session = null } = {},
) {
  const { AuditEvent } = models();
  const context = currentContext();

  const [event] = await AuditEvent.create(
    [
      {
        action,
        subjectType,
        subjectId,
        changes,
        metadata,
        actor: context.actor,
        requestId: context.requestId,
        source: context.source,
        at: new Date(),
      },
    ],
    { session },
  );
  return event;
}

/** Convenience for the common case: a document before and after a save. */
async function recordChange(
  { action, subjectType, document, before, fields, metadata },
  options = {},
) {
  const changes = diffFields(before, document.toObject(), fields);
  if (changes.length === 0 && !metadata) return null;
  return record({ action, subjectType, subjectId: document.publicId, changes, metadata }, options);
}

async function trailFor(subjectType, subjectId, { limit = 50 } = {}) {
  const { AuditEvent } = models();
  return AuditEvent.find({ subjectType, subjectId }).sort({ at: -1 }).limit(limit);
}

/**
 * The trail as a page. Distributors ask for a year of it at a time and the
 * answer to "who released that quarantine" is somewhere in the middle, so it
 * pages by keyset like everything else rather than by an offset that moves
 * while it is being read.
 */
async function searchTrail(query = {}) {
  const { AuditEvent } = models();
  const filter = {};

  if (query.subjectType) filter.subjectType = query.subjectType;
  if (query.subjectId) filter.subjectId = query.subjectId;
  if (query.actor) filter.actor = query.actor;
  if (query.action) filter.action = query.action;
  if (query.source) filter.source = query.source;
  if (query.from || query.to) {
    filter.at = {};
    if (query.from) filter.at.$gte = new Date(query.from);
    if (query.to) filter.at.$lte = new Date(query.to);
  }

  return paginate(AuditEvent, {
    filter,
    sortField: 'at',
    order: query.order || 'desc',
    limit: query.limit,
    cursor: query.cursor,
  });
}

/** Who has touched a record, and how often, for a distributor's question. */
async function actorsFor(subjectType, subjectId) {
  const { AuditEvent } = models();
  const rows = await AuditEvent.aggregate([
    { $match: { subjectType, subjectId } },
    { $group: { _id: '$actor', changes: { $sum: 1 }, last: { $max: '$at' } } },
    { $sort: { changes: -1, _id: 1 } },
  ]);

  return rows.map((row) => ({ actor: row._id, changes: row.changes, last: row.last }));
}

module.exports = { diffFields, normalise, record, recordChange, trailFor, searchTrail, actorsFor };
