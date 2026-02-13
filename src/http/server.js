'use strict';

const { createApp } = require('./app');
const { config } = require('../config/env');
const { logger } = require('../lib/logger');
const { connect, disconnect } = require('../db/connection');
const { registerModels, syncIndexes } = require('../models');

/**
 * Starting and stopping the desk.
 *
 * The shutdown is the part worth reading. A print booking is a transaction
 * across three collections, and killing the process mid-flight leaves an
 * element committed to a booking that does not exist. So the listener closes
 * first, in-flight requests are given time to finish, and only then does mongo
 * go. If the deadline passes anyway the process leaves loudly rather than
 * hanging until an orchestrator kills it.
 */

const SHUTDOWN_GRACE_MS = 15000;

function trackConnections(server) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return {
    count: () => sockets.size,
    destroyAll: () => sockets.forEach((socket) => socket.destroy()),
  };
}

async function start({ cfg = config(), log = logger() } = {}) {
  const connection = await connect(cfg.mongo, log);
  registerModels(connection);

  if (!cfg.isProduction) {
    // A development desk fixes its own indexes. Production does it from the
    // command line, on purpose, where somebody is watching.
    await syncIndexes();
  }

  const app = createApp({
    log,
    exposeInternal: !cfg.isProduction,
    allowedOrigins: cfg.http.allowedOrigins,
    limits: cfg.rateLimit,
    timeoutMs: cfg.http.timeoutMs,
  });

  const server = app.listen(cfg.http.port);
  const connections = trackConnections(server);

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  log.info({ port: cfg.http.port, env: cfg.nodeEnv }, 'print desk listening');

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal, openConnections: connections.count() }, 'shutting down');

    const deadline = setTimeout(() => {
      log.error({ openConnections: connections.count() }, 'shutdown deadline passed, forcing');
      connections.destroyAll();
    }, SHUTDOWN_GRACE_MS);
    deadline.unref();

    await new Promise((resolve) => server.close(resolve));
    clearTimeout(deadline);

    await disconnect();
    log.info({ signal }, 'shut down cleanly');
  }

  return { server, shutdown, connections };
}

function install(handle, log = logger()) {
  const stop = async (signal) => {
    try {
      await handle.shutdown(signal);
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  // An unhandled rejection has already skipped whatever error handling the
  // desk has. Log it and leave: a process in an unknown state should not be
  // holding print bookings open.
  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'unhandled rejection');
    stop('unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

if (require.main === module) {
  start()
    .then((handle) => install(handle))
    .catch((err) => {
      logger().fatal({ err }, 'the desk could not start');
      process.exit(1);
    });
}

module.exports = { start, install, trackConnections, SHUTDOWN_GRACE_MS };
