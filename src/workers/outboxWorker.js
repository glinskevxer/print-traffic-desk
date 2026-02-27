'use strict';

const outbox = require('../lib/outbox');
const { deliverers } = require('./delivery');
const { logger } = require('../lib/logger');

/**
 * Sends what the desk owes. One message at a time, claimed with a conditional
 * update, so running two of these is safe and running none of them only means
 * nothing goes out until one starts.
 */

async function deliverOne(message, couriers) {
  const startedAt = Date.now();
  const courier = couriers[message.channel] || couriers.log;

  try {
    const outcome = await courier(message);
    await outbox.markSent(message, { elapsedMs: Date.now() - startedAt, detail: outcome.detail });
    return { message, sent: true };
  } catch (err) {
    await outbox.markFailed(message, err);
    return { message, sent: false, error: err };
  }
}

/**
 * Sends up to `limit` messages and stops. A worker that drains the whole queue
 * in one go holds a connection for as long as the queue is deep; a bounded
 * drain called on a timer keeps every pass short.
 */
async function drain({
  limit = 25,
  log = logger(),
  webhookUrl = null,
  fetchImpl,
  kinds = null,
} = {}) {
  const couriers = deliverers({ log, webhookUrl, fetchImpl });
  const results = { claimed: 0, sent: 0, failed: 0, ids: [] };

  for (let taken = 0; taken < limit; taken += 1) {
    // eslint-disable-next-line no-await-in-loop
    const message = await outbox.claimNext({ kinds });
    if (!message) break;

    results.claimed += 1;
    results.ids.push(message.publicId);

    // eslint-disable-next-line no-await-in-loop
    const outcome = await deliverOne(message, couriers);
    if (outcome.sent) results.sent += 1;
    else results.failed += 1;
  }

  if (results.claimed > 0) {
    log.info(results, 'outbox drained');
  }
  return results;
}

module.exports = { drain, deliverOne };
