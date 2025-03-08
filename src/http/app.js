'use strict';

const express = require('express');
const { requestContext, requestLogging } = require('./middleware/requestContext');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { healthRoutes } = require('./routes/health');
const { titleRoutes } = require('./routes/titles');
const { venueRoutes } = require('./routes/venues');
const { rightsHolderRoutes } = require('./routes/rightsHolders');
const { logger } = require('../lib/logger');
const { version } = require('../../package.json');

/**
 * The app is built, not imported as a singleton, so a test can hand in its own
 * logger and a fake clock without reaching into module state.
 */
function createApp({ log = null, bodyLimit = '256kb', exposeInternal = false } = {}) {
  const app = express();
  const startedAt = Date.now();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.set('etag', false);

  app.use(requestContext({ logger: log || logger() }));
  app.use(requestLogging());
  app.use(express.json({ limit: bodyLimit }));

  app.use('/health', healthRoutes({ version, startedAt }));
  app.use('/titles', titleRoutes());
  app.use('/venues', venueRoutes());
  app.use('/rights-holders', rightsHolderRoutes());

  app.use(notFoundHandler());
  app.use(errorHandler({ exposeInternal }));

  return app;
}

module.exports = { createApp };
