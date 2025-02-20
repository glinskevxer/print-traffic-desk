'use strict';

const { newRequestId } = require('../../lib/ids');

const HEADER = 'x-request-id';

/**
 * Every inbound request gets an id, echoed back so a venue can quote it when
 * they ring up about a refused booking. A caller supplied id is trusted only
 * when it looks like one, because it ends up in log lines.
 */
function requestContext({ logger }) {
  return function attachContext(req, res, next) {
    const supplied = req.get(HEADER);
    const requestId = /^[A-Za-z0-9-]{8,64}$/.test(supplied || '') ? supplied : newRequestId();

    req.id = requestId;
    req.startedAt = process.hrtime.bigint();
    req.log = logger.child({ requestId, method: req.method, path: req.path });
    res.set(HEADER, requestId);

    next();
  };
}

/** Logs the outcome once, when the response is on the wire. */
function requestLogging() {
  return function logOnFinish(req, res, next) {
    res.on('finish', () => {
      const elapsedMs = Number((process.hrtime.bigint() - req.startedAt) / 1000000n);
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      req.log[level](
        { status: res.statusCode, elapsedMs, bytes: Number(res.get('content-length') || 0) },
        'request finished',
      );
    });
    next();
  };
}

module.exports = { requestContext, requestLogging, HEADER };
