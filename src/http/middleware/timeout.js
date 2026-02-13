'use strict';

const { DeskError, CODES } = require('../../lib/errors');

/**
 * A request that has taken longer than the desk is prepared to wait is
 * answered rather than left open. The work carries on: node cannot cancel a
 * query mid flight and pretending otherwise would leave a booking half made.
 * What this stops is a client holding a socket for two minutes waiting on a
 * mongo query that is never coming back.
 *
 * The handler is told, through res.timedOut, so it does not try to answer a
 * request that already has an answer.
 */

const DEFAULT_MS = 20000;

/** Extraction calls an upstream model and is allowed far longer. */
const SLOWER_PATHS = Object.freeze([
  { prefix: '/extractions', ms: 90000 },
  { prefix: '/royalty-statements', ms: 60000 },
]);

function limitFor(path, defaultMs) {
  const slower = SLOWER_PATHS.find((entry) => path.startsWith(entry.prefix));
  return slower ? slower.ms : defaultMs;
}

function requestTimeout({ ms = DEFAULT_MS } = {}) {
  return function enforceTimeout(req, res, next) {
    const limit = limitFor(req.path, ms);
    res.timedOut = false;

    const timer = setTimeout(() => {
      if (res.headersSent) return;
      res.timedOut = true;
      req.log.error({ limitMs: limit, path: req.path }, 'request took longer than the desk waits');

      next(
        new DeskError('the desk took too long over that and gave up', {
          code: CODES.INTERNAL,
          status: 503,
          details: { limitMs: limit },
          retryable: true,
        }),
      );
    }, limit);
    timer.unref();

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

module.exports = { requestTimeout, limitFor, DEFAULT_MS, SLOWER_PATHS };
