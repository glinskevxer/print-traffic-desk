'use strict';

const { models } = require('../models');
const { paginate } = require('./pagination');

/**
 * Writing a message is one line and it takes the session, because the whole
 * point is that the message and the change that caused it commit together.
 * Sending is somebody else's job, later, from the worker.
 */
async function enqueue(
  { kind, subjectType, subjectId, to, channel = 'log', payload = {} },
  { session = null } = {},
) {
  const { OutboxMessage } = models();
  const [message] = await OutboxMessage.create(
    [{ kind, subjectType, subjectId, to, channel, payload, availableAt: new Date() }],
    { session },
  );
  return message;
}

/**
 * The next few messages that are due, claimed one at a time so two workers do
 * not send the same despatch note twice. The claim is a conditional update,
 * which is the only lock a mongo collection needs for this.
 */
async function claimNext({ now = new Date(), kinds = null } = {}) {
  const { OutboxMessage } = models();
  const filter = { status: 'pending', availableAt: { $lte: now } };
  if (kinds) filter.kind = { $in: kinds };

  return OutboxMessage.findOneAndUpdate(
    filter,
    { $set: { status: 'sending' } },
    { sort: { availableAt: 1 }, new: true },
  );
}

async function markSent(message, { elapsedMs = 0, detail = null } = {}) {
  message.status = 'sent';
  message.sentAt = new Date();
  message.lastError = null;
  message.attempts.push({ outcome: 'sent', elapsedMs, detail });
  await message.save();
  return message;
}

/**
 * A failure goes back in the queue with a longer wait, until it has failed
 * enough times that trying again is not the answer.
 */
async function markFailed(message, error, { now = new Date() } = {}) {
  message.attempts.push({ outcome: 'failed', detail: String(error.message).slice(0, 400) });
  message.lastError = String(error.message).slice(0, 400);

  if (message.isExhausted()) {
    message.status = 'abandoned';
  } else {
    message.status = 'pending';
    message.availableAt = message.nextAttemptAt(now);
  }

  await message.save();
  return message;
}

async function pendingCount(now = new Date()) {
  const { OutboxMessage } = models();
  return OutboxMessage.countDocuments({ status: 'pending', availableAt: { $lte: now } });
}

async function listMessages(query = {}) {
  const { OutboxMessage } = models();
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.kind) filter.kind = query.kind;
  if (query.subjectId) filter.subjectId = query.subjectId;

  return paginate(OutboxMessage, {
    filter,
    sortField: 'createdAt',
    order: query.order || 'desc',
    limit: query.limit,
    cursor: query.cursor,
  });
}

/** Puts an abandoned message back, once somebody has fixed whatever broke. */
async function requeue(publicId) {
  const { OutboxMessage } = models();
  const message = await OutboxMessage.byPublicId(publicId);
  if (!message) return null;

  message.status = 'pending';
  message.availableAt = new Date();
  message.attempts = [];
  message.lastError = null;
  await message.save();
  return message;
}

module.exports = { enqueue, claimNext, markSent, markFailed, pendingCount, listMessages, requeue };
