'use strict';

const { UpstreamError } = require('../lib/errors');

/**
 * How a message actually leaves the building.
 *
 * There is no SMTP here on purpose. A repertory circuit sends its despatch
 * notes through whatever the office already uses, so the desk posts them to a
 * configured endpoint and lets that decide whether it is an email, a Slack
 * message or a printer. With nothing configured, a message is written to the
 * log and marked sent, which is what a development desk wants.
 */

function logDeliverer(log) {
  return async function deliver(message) {
    log.info(
      { outbox: message.publicId, kind: message.kind, to: message.to, payload: message.payload },
      'message delivered to the log',
    );
    return { detail: 'written to the log' };
  };
}

/**
 * Posts the message somewhere. A non 2xx is an upstream failure and goes back
 * on the queue; a 4xx that is not 429 will never succeed, so it is not
 * retryable and the message is abandoned after one go.
 */
function webhookDeliverer({ url, timeoutMs = 10000, fetchImpl = globalThis.fetch }) {
  return async function deliver(message) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-printdesk-kind': message.kind },
        body: JSON.stringify({
          id: message.publicId,
          kind: message.kind,
          to: message.to,
          subject: { type: message.subjectType, id: message.subjectId },
          payload: message.payload,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        throw new UpstreamError(`the endpoint answered ${response.status}`, {
          service: 'outbox-webhook',
          status: response.status,
          retryable,
        });
      }
      return { detail: `posted, ${response.status}` };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new UpstreamError(`the endpoint did not answer within ${timeoutMs}ms`, {
          service: 'outbox-webhook',
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Picks the deliverer for a message. Email falls back to the log rather than
 * failing, because a desk with no endpoint configured should still be able to
 * confirm a booking.
 */
function deliverers({ log, webhookUrl = null, fetchImpl = globalThis.fetch }) {
  const toLog = logDeliverer(log);
  const toWebhook = webhookUrl ? webhookDeliverer({ url: webhookUrl, fetchImpl }) : null;

  return {
    log: toLog,
    webhook: toWebhook || toLog,
    email: toWebhook || toLog,
  };
}

module.exports = { logDeliverer, webhookDeliverer, deliverers };
