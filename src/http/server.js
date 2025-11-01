'use strict';

const { createApp } = require('./app');
const { config } = require('../config/env');
const { logger } = require('../lib/logger');
const { connect, disconnect } = require('../db/connection');
const { registerModels } = require('../models');

async function start() {
  const cfg = config();
  const log = logger();

  const connection = await connect(cfg.mongo, log);
  registerModels(connection);

  const app = createApp({
    log,
    exposeInternal: !cfg.isProduction,
    allowedOrigins: cfg.http.allowedOrigins,
  });
  const server = app.listen(cfg.http.port, () => {
    log.info({ port: cfg.http.port, env: cfg.nodeEnv }, 'print desk listening');
  });

  const shutdown = async (signal) => {
    log.info({ signal }, 'shutting down');
    server.close(async () => {
      await disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    logger().fatal({ err }, 'the desk could not start');
    process.exit(1);
  });
}

module.exports = { start };
