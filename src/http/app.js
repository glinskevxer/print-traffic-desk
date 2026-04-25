'use strict';

const express = require('express');
const { requestContext, requestLogging } = require('./middleware/requestContext');
const { authenticate, requireOperator } = require('./middleware/auth');
const { securityHeaders, crossOrigin, rejectMongoOperators } = require('./middleware/security');
const { rateLimit } = require('./middleware/rateLimit');
const { requestTimeout } = require('./middleware/timeout');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { openRouters, guardedRouters } = require('./routers');
const { logger } = require('../lib/logger');
const { installDefaults } = require('../lib/metrics');
const { version } = require('../../package.json');

/**
 * The app is built, not imported as a singleton. authenticateWith is injected
 * so a test can hand in a known operator instead of signing one in for every
 * request; the real middleware is covered by its own tests.
 */
function createApp({
  log = null,
  bodyLimit = '256kb',
  exposeInternal = false,
  authenticateWith = authenticate(),
  allowedOrigins = [],
  limits = null,
  timeoutMs = null,
} = {}) {
  const app = express();
  const startedAt = Date.now();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.set('etag', false);

  app.use(securityHeaders());
  // The origin check runs after the request context, because refusing an
  // origin raises a desk error and the error handler logs against req.log.
  app.use(requestContext({ logger: log || logger() }));
  installDefaults();
  app.use(requestLogging());
  app.use(crossOrigin(allowedOrigins));
  if (timeoutMs) app.use(requestTimeout({ ms: timeoutMs }));
  app.use(express.json({ limit: bodyLimit }));
  app.use(rejectMongoOperators());

  if (limits) {
    // Sign in is limited far harder than the rest, and by address rather than
    // by operator, because the caller has not proved who they are yet.
    app.use(
      '/auth/sign-in',
      rateLimit({ windowMs: limits.windowMs, max: limits.signInMax, scope: 'sign-in' }),
    );
  }
  for (const router of openRouters()) {
    app.use(router.path, router.build({ version, startedAt }));
  }

  // Everything past here needs an operator. Health, metrics and sign in do not.
  app.use(authenticateWith);
  app.use(requireOperator());
  if (limits) app.use(rateLimit({ windowMs: limits.windowMs, max: limits.max }));

  for (const router of guardedRouters()) {
    app.use(router.path, router.build({ version, startedAt }));
  }

  app.use(notFoundHandler());
  app.use(errorHandler({ exposeInternal }));

  return app;
}

module.exports = { createApp };
