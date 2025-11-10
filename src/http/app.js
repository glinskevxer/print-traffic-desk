'use strict';

const express = require('express');
const { requestContext, requestLogging } = require('./middleware/requestContext');
const { authenticate, requireOperator } = require('./middleware/auth');
const {
  securityHeaders,
  crossOrigin,
  rejectMongoOperators,
} = require('./middleware/security');
const { rateLimit } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { healthRoutes } = require('./routes/health');
const { authRoutes } = require('./routes/auth');
const { titleRoutes } = require('./routes/titles');
const { venueRoutes } = require('./routes/venues');
const { rightsHolderRoutes } = require('./routes/rightsHolders');
const { elementRoutes } = require('./routes/elements');
const { inspectionRoutes } = require('./routes/inspections');
const { rightsRoutes } = require('./routes/rights');
const { shipmentRoutes } = require('./routes/shipments');
const { bookingRoutes } = require('./routes/bookings');
const { royaltyRoutes } = require('./routes/royalties');
const { extractionRoutes } = require('./routes/extraction');
const { logger } = require('../lib/logger');
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
  app.use(requestLogging());
  app.use(crossOrigin(allowedOrigins));
  app.use(express.json({ limit: bodyLimit }));
  app.use(rejectMongoOperators());

  app.use('/health', healthRoutes({ version, startedAt }));
  if (limits) {
    // Sign in is limited far harder than the rest, and by address rather than
    // by operator, because the caller has not proved who they are yet.
    app.use(
      '/auth/sign-in',
      rateLimit({ windowMs: limits.windowMs, max: limits.signInMax, scope: 'sign-in' }),
    );
  }
  app.use('/auth', authRoutes());

  // Everything past here needs an operator. Health and sign in do not.
  app.use(authenticateWith);
  app.use(requireOperator());
  if (limits) app.use(rateLimit({ windowMs: limits.windowMs, max: limits.max }));

  app.use('/titles', titleRoutes());
  app.use('/venues', venueRoutes());
  app.use('/rights-holders', rightsHolderRoutes());
  app.use('/elements', elementRoutes());
  app.use('/', inspectionRoutes());
  app.use('/', rightsRoutes());
  app.use('/shipments', shipmentRoutes());
  app.use('/bookings', bookingRoutes());
  app.use('/royalty-statements', royaltyRoutes());
  app.use('/extractions', extractionRoutes());

  app.use(notFoundHandler());
  app.use(errorHandler({ exposeInternal }));

  return app;
}

module.exports = { createApp };
