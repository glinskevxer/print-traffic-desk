'use strict';

const { isRetryable: isRetryableError } = require('./errors');

/**
 * Exponential backoff with full jitter. The extraction calls all go to one
 * upstream, so a fixed backoff lines every retry up and hits it again in a
 * wave. Jitter spreads them, and the sleep and the randomness are injectable
 * so the tests do not actually wait.
 */

const DEFAULTS = Object.freeze({
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 20000,
});

function backoffDelay(attempt, { baseDelayMs, maxDelayMs, random = Math.random }) {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.round(random() * ceiling);
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs work until it succeeds or the attempts run out. Only failures the
 * caller calls retryable are retried: a rejected request body will be rejected
 * exactly as fast the second time.
 */
async function withRetry(work, options = {}) {
  const {
    attempts = DEFAULTS.attempts,
    baseDelayMs = DEFAULTS.baseDelayMs,
    maxDelayMs = DEFAULTS.maxDelayMs,
    shouldRetry = isRetryableError,
    onRetry = null,
    sleep = realSleep,
    random = Math.random,
  } = options;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError('attempts must be a positive whole number');
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await work(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !shouldRetry(err)) throw err;

      const delayMs = backoffDelay(attempt, { baseDelayMs, maxDelayMs, random });
      if (onRetry) onRetry({ attempt, delayMs, error: err });
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/**
 * Upstreams sometimes say how long to wait. When they do the desk waits that
 * long rather than guessing, because guessing shorter gets it rate limited
 * again and guessing longer wastes the window.
 */
function delayFromError(err, fallback) {
  const seconds = err && err.retryAfterSeconds;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return fallback;
}

module.exports = { DEFAULTS, backoffDelay, withRetry, delayFromError, realSleep };
