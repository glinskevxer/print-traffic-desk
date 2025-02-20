'use strict';

const { DeskError, NotFoundError, isDeskError } = require('../../lib/errors');

/** Anything that reaches here matched no route. */
function notFoundHandler() {
  return function notFound(req, _res, next) {
    next(new NotFoundError('route', `${req.method} ${req.path}`));
  };
}

function isBodyParseFailure(err) {
  return err && err.type === 'entity.parse.failed';
}

function isBodyTooLarge(err) {
  return err && err.type === 'entity.too.large';
}

/**
 * The one place a status code is chosen. Anything that is not a DeskError is a
 * defect, so it is logged with its stack and answered with a bare 500 rather
 * than leaking the message.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler({ exposeInternal = false } = {}) {
  return function handleError(err, req, res, next) {
    if (res.headersSent) {
      req.log.error({ err }, 'error after the response started');
      return next(err);
    }

    let desk = err;
    if (isBodyParseFailure(err)) {
      desk = new DeskError('request body is not valid json', {
        code: 'validation_failed',
        status: 400,
      });
    } else if (isBodyTooLarge(err)) {
      desk = new DeskError('request body is larger than the desk accepts', {
        code: 'validation_failed',
        status: 413,
      });
    }

    if (isDeskError(desk)) {
      const level = desk.status >= 500 ? 'error' : 'warn';
      req.log[level]({ err: desk }, 'request refused');
      if (desk.retryAfterSeconds) res.set('retry-after', String(desk.retryAfterSeconds));
      return res.status(desk.status).json(desk.toPayload());
    }

    req.log.error({ err }, 'unhandled error');
    return res.status(500).json({
      error: {
        code: 'internal_error',
        message: exposeInternal ? err.message : 'the desk could not complete that request',
        requestId: req.id,
      },
    });
  };
}

module.exports = { errorHandler, notFoundHandler };
