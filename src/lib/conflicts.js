'use strict';

const { ConflictError } = require('./errors');

/**
 * Two desks booking the last print of a title at the same moment is not a
 * client error. One of them loses the conditional update and the honest answer
 * is to look again: the shelf may have another copy, or the same one may still
 * be free because the other booking was refused a step later.
 *
 * Only conflicts marked as worth retrying are retried. A duplicate barcode is
 * a conflict too, and trying that again gets the same answer forever.
 */

const RETRYABLE = 'retryableConflict';

function retryableConflict(message, details = {}) {
  return new ConflictError(message, { ...details, [RETRYABLE]: true });
}

function isRetryableConflict(err) {
  return err instanceof ConflictError && Boolean(err.details && err.details[RETRYABLE]);
}

/**
 * Runs a unit of work again when it lost a race. The delay is short and
 * jittered: the two callers have to separate, and a fixed delay puts them back
 * in step with each other.
 */
async function retryOnConflict(
  work,
  { attempts = 3, sleep = defaultSleep, random = Math.random } = {},
) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await work(attempt);
    } catch (err) {
      if (!isRetryableConflict(err) || attempt === attempts) throw err;
      lastError = err;
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.round(random() * 40 * attempt));
    }
  }
  throw lastError;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { retryOnConflict, retryableConflict, isRetryableConflict, RETRYABLE };
