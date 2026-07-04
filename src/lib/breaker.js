'use strict';

const { DeskError, CODES } = require('./errors');

/**
 * A circuit breaker for the one thing the desk calls that it does not own.
 *
 * When the model is down, every extraction spends thirty seconds timing out
 * before it fails, and a reviewer working through a queue of twenty sits there
 * for ten minutes to be told twenty times what the first one already said. The
 * breaker turns that into one slow failure and nineteen instant ones, and then
 * lets a single call through to find out whether it is back.
 */

const STATES = Object.freeze({ CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half-open' });

class BreakerOpenError extends DeskError {
  constructor(service, openUntil) {
    super(`${service} is not answering, so the desk is not asking for now`, {
      code: CODES.UPSTREAM_FAILED,
      status: 503,
      details: { service, openUntil },
      retryable: true,
    });
    this.openUntil = openUntil;
  }
}

function createBreaker({
  service = 'upstream',
  failuresToOpen = 5,
  openMs = 60000,
  isFailure = () => true,
  now = Date.now,
} = {}) {
  let failures = 0;
  let state = STATES.CLOSED;
  let openedAt = null;
  let probing = false;

  function stateAt(moment) {
    if (state !== STATES.OPEN) return state;
    return moment - openedAt >= openMs ? STATES.HALF_OPEN : STATES.OPEN;
  }

  function open(moment) {
    state = STATES.OPEN;
    openedAt = moment;
    probing = false;
  }

  function close() {
    state = STATES.CLOSED;
    failures = 0;
    openedAt = null;
    probing = false;
  }

  return {
    get state() {
      return stateAt(now());
    },
    get failures() {
      return failures;
    },

    /**
     * Runs the work unless the circuit is open. Exactly one call is let
     * through while half open: a rush of twenty when the model comes back is
     * how it goes down again.
     */
    async run(work) {
      const moment = now();
      const current = stateAt(moment);

      if (current === STATES.OPEN || (current === STATES.HALF_OPEN && probing)) {
        throw new BreakerOpenError(service, new Date(openedAt + openMs));
      }
      if (current === STATES.HALF_OPEN) {
        probing = true;
        state = STATES.HALF_OPEN;
      }

      try {
        const answer = await work();
        close();
        return answer;
      } catch (err) {
        if (!isFailure(err)) {
          // A rejected prompt is the desk's fault, not the model being down.
          probing = false;
          throw err;
        }
        failures += 1;
        if (current === STATES.HALF_OPEN || failures >= failuresToOpen) {
          open(now());
        }
        throw err;
      }
    },

    reset: close,
  };
}

module.exports = { createBreaker, BreakerOpenError, STATES };
