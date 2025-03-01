'use strict';

/**
 * Express 4 does not catch a rejected promise from a handler, so an await that
 * throws hangs the request until the client gives up. Every async handler is
 * wrapped.
 */
function asyncHandler(handler) {
  return function runHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
