'use strict';

const { newRequestId } = require('../../lib/ids');
const { runWithContext } = require('../../lib/context');
const { registry, installDefaults } = require('../../lib/metrics');

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

    // Everything downstream of here runs inside the request's context, so an
    // audit written five calls deep still knows who asked for it.
    runWithContext({ requestId, source: 'http' }, () => next());
  };
}

const PUBLIC_ID = /^[a-z]{2,6}_[0-9A-Z]{16}$/;
const BOOKING_REFERENCE = /^BK-\d{4}-\d{3}-[0-9A-Z]{4}$/;
const BARCODE = /^PE-\d{6}$/;

/**
 * A label for the metric, not a path. Express restores req.baseUrl by the time
 * the response finishes, so the router's own pattern is not available there;
 * folding the identifiers out of the url gives the same low cardinality
 * without depending on when express puts its internals back.
 */
function routeLabel(req) {
  const path = req.originalUrl.split('?')[0];

  return path
    .split('/')
    .map((segment) => {
      if (PUBLIC_ID.test(segment)) return ':id';
      if (BOOKING_REFERENCE.test(segment)) return ':reference';
      if (BARCODE.test(segment)) return ':barcode';
      return segment;
    })
    .join('/');
}

/**
 * Logs the outcome once, when the response is on the wire, and counts it. The
 * route label is used rather than the path, so ten thousand booking ids do not
 * become ten thousand metric series.
 */
function requestLogging({ metrics = registry } = {}) {
  return function logOnFinish(req, res, next) {
    res.on('finish', () => {
      const elapsedMs = Number((process.hrtime.bigint() - req.startedAt) / 1000000n);
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      const route = routeLabel(req);

      req.log[level](
        { status: res.statusCode, elapsedMs, bytes: Number(res.get('content-length') || 0) },
        'request finished',
      );

      installDefaults(metrics);
      metrics.increment('printdesk_requests_total', {
        method: req.method,
        route,
        status: res.statusCode,
      });
      metrics.observe('printdesk_request_duration_ms', elapsedMs, { method: req.method, route });
    });
    next();
  };
}

module.exports = { requestContext, requestLogging, routeLabel, HEADER };
