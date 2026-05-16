'use strict';

const crypto = require('crypto');
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
 * The signature the receiving end checks.
 *
 * A despatch note tells a venue to send a print somewhere, so the endpoint has
 * to be able to tell a real one from a post by anybody who found the url. The
 * timestamp is signed with the body: without it, an old message can be replayed
 * forever, and a venue would ship the same print twice.
 */
function signBody({ body, secret, timestamp }) {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function verifySignature({ body, secret, header, toleranceSeconds = 300, now = Date.now() }) {
  const parts = Object.fromEntries(
    String(header || '')
      .split(',')
      .map((piece) => piece.split('=')),
  );
  if (!parts.t || !parts.v1) return false;

  const age = Math.abs(now / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${body}`).digest('hex');
  const given = Buffer.from(parts.v1, 'hex');
  const mine = Buffer.from(expected, 'hex');
  return given.length === mine.length && crypto.timingSafeEqual(given, mine);
}

/**
 * Posts the message somewhere. A non 2xx is an upstream failure and goes back
 * on the queue; a 4xx that is not 429 will never succeed, so it is not
 * retryable and the message is abandoned after one go.
 */
function webhookDeliverer({
  url,
  secret = null,
  timeoutMs = 10000,
  fetchImpl = globalThis.fetch,
  now = Date.now,
}) {
  return async function deliver(message) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const body = JSON.stringify({
      id: message.publicId,
      kind: message.kind,
      to: message.to,
      subject: { type: message.subjectType, id: message.subjectId },
      payload: message.payload,
    });
    const headers = { 'content-type': 'application/json', 'x-printdesk-kind': message.kind };
    if (secret) {
      headers['x-printdesk-signature'] = signBody({
        body,
        secret,
        timestamp: Math.floor(now() / 1000),
      });
    }

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
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
function deliverers({
  log,
  webhookUrl = null,
  webhookSecret = null,
  fetchImpl = globalThis.fetch,
}) {
  const toLog = logDeliverer(log);
  const toWebhook = webhookUrl
    ? webhookDeliverer({ url: webhookUrl, secret: webhookSecret, fetchImpl })
    : null;

  return {
    log: toLog,
    webhook: toWebhook || toLog,
    email: toWebhook || toLog,
  };
}

module.exports = { logDeliverer, webhookDeliverer, deliverers, signBody, verifySignature };
