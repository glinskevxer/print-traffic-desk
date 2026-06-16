'use strict';

const { config } = require('../config/env');
const { logger } = require('../lib/logger');
const { connect, disconnect } = require('../db/connection');
const { registerModels } = require('../models');
const { createScheduler } = require('./scheduler');
const { drain } = require('./outboxWorker');
const bookings = require('../services/bookingService');
const rights = require('../services/rightsService');
const inspections = require('../services/inspectionService');
const retention = require('../services/retentionService');
const { localDateOf } = require('../lib/dates');

/**
 * The worker process. Same image as the desk, different command, so it cannot
 * drift from the code it is running against.
 */
function handlersFor(cfg) {
  return {
    'lapse-holds': async () => ({ lapsed: (await bookings.lapseExpiredHolds()).length }),

    'drain-outbox': async ({ log }) =>
      drain({
        log,
        limit: 50,
        webhookUrl: cfg.outbox.webhookUrl,
        webhookSecret: cfg.outbox.webhookSecret,
      }),

    'expire-windows': async () => ({
      expired: await rights.expireFinishedWindows(localDateOf(new Date(), 'Europe/London')),
    }),

    'quarantine-overdue': async () => ({
      quarantined: (await inspections.quarantineOverdue()).length,
    }),

    prune: async () => retention.prune({ limit: 2000 }),
  };
}

async function start({ cfg = config(), log = logger() } = {}) {
  registerModels(await connect(cfg.mongo, log));

  const scheduler = createScheduler({ handlers: handlersFor(cfg), log }).start();

  const stop = async (signal) => {
    log.info({ signal }, 'worker shutting down');
    await scheduler.stop();
    await disconnect();
  };

  return { scheduler, stop };
}

if (require.main === module) {
  const log = logger();
  start({ log })
    .then((handle) => {
      process.on('SIGTERM', () => handle.stop('SIGTERM').then(() => process.exit(0)));
      process.on('SIGINT', () => handle.stop('SIGINT').then(() => process.exit(0)));
    })
    .catch((err) => {
      log.fatal({ err }, 'the worker could not start');
      process.exit(1);
    });
}

module.exports = { start, handlersFor };
