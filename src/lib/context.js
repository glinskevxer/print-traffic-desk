'use strict';

const { AsyncLocalStorage } = require('async_hooks');

/**
 * Who is asking, and under which request. Threading an actor through every
 * service signature made the booking path take four arguments nobody used, so
 * it rides in async local storage instead. Nothing in the domain reads this:
 * only logging, auditing and rate limiting do.
 */

const storage = new AsyncLocalStorage();

const EMPTY = Object.freeze({
  requestId: null,
  actor: null,
  role: null,
  source: 'system',
});

function runWithContext(context, work) {
  return storage.run(Object.freeze({ ...EMPTY, ...context }), work);
}

function currentContext() {
  return storage.getStore() || EMPTY;
}

function currentActor() {
  return currentContext().actor;
}

function currentRequestId() {
  return currentContext().requestId;
}

/**
 * Adds to the context for the duration of one call without losing what is
 * already there. Used when a worker picks a job up on behalf of an operator.
 */
function withContext(extra, work) {
  return runWithContext({ ...currentContext(), ...extra }, work);
}

module.exports = { runWithContext, withContext, currentContext, currentActor, currentRequestId, EMPTY };
