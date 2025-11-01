'use strict';

const helmet = require('helmet');
const cors = require('cors');
const { ForbiddenError, ValidationError } = require('../../lib/errors');

/**
 * The desk is an API behind a booking screen, not a website. No inline
 * scripts, no framing, no referrer, and a content security policy that allows
 * nothing at all, because nothing is what an API needs to load.
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 15552000, includeSubDomains: true },
    frameguard: { action: 'deny' },
    noSniff: true,
    xssFilter: false,
  });
}

/**
 * Only the origins the desk knows. A wildcard would be fine for a public read
 * API and is not fine for one that books prints, so an unlisted origin is
 * refused rather than quietly answered without the header.
 */
function crossOrigin(allowedOrigins = []) {
  const allowed = new Set(allowedOrigins);

  return cors({
    origin(origin, done) {
      if (!origin) return done(null, false);
      if (allowed.has(origin)) return done(null, true);
      return done(new ForbiddenError(`${origin} is not an origin this desk answers`));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'idempotent-replay', 'retry-after'],
    maxAge: 600,
  });
}

const MONGO_OPERATOR = /^\$/;

/**
 * A query string is strings. A body is JSON, and JSON can carry an object
 * where the desk expected a string. Zod catches most of it, but a key
 * beginning with a dollar is never anything but an attempt at a query
 * operator, so it is refused at the door with the path it was found at.
 */
function rejectMongoOperators({ maxDepth = 12 } = {}) {
  return function screenBody(req, _res, next) {
    const found = findOperatorKey(req.body, [], maxDepth);
    if (found) {
      return next(
        new ValidationError('that request carries a database operator', [
          { key: found, problem: 'keys cannot begin with a dollar sign' },
        ]),
      );
    }
    return next();
  };
}

function findOperatorKey(value, path, depth) {
  if (depth < 0 || value === null || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findOperatorKey(value[i], [...path, String(i)], depth - 1);
      if (found) return found;
    }
    return null;
  }

  for (const key of Object.keys(value)) {
    if (MONGO_OPERATOR.test(key)) return [...path, key].join('.');
    const found = findOperatorKey(value[key], [...path, key], depth - 1);
    if (found) return found;
  }
  return null;
}

module.exports = { securityHeaders, crossOrigin, rejectMongoOperators, findOperatorKey };
