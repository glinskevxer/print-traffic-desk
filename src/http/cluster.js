'use strict';

const cluster = require('cluster');
const os = require('os');
const { logger } = require('../lib/logger');
const { start, install } = require('./server');

/**
 * Runs the desk across the cores it has been given. Node is single threaded
 * and the desk is mostly waiting on mongo, so two workers per core would be
 * pointless, but one process on a four core box wastes three of them.
 *
 * A worker that dies is replaced, unless the whole thing is shutting down, in
 * which case replacing it would keep the container alive forever.
 */

const RESTART_DELAY_MS = 1000;

function workerCount() {
  const requested = Number(process.env.WEB_CONCURRENCY || 0);
  if (requested > 0) return requested;
  return Math.max(
    1,
    Math.min(os.availableParallelism ? os.availableParallelism() : os.cpus().length, 4),
  );
}

function runPrimary(log) {
  const workers = workerCount();
  let shuttingDown = false;

  log.info({ workers, pid: process.pid }, 'starting the desk across workers');
  for (let i = 0; i < workers; i += 1) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;
    log.error({ worker: worker.process.pid, code, signal }, 'worker died, replacing it');
    setTimeout(() => cluster.fork(), RESTART_DELAY_MS).unref();
  });

  const stop = (incoming) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal: incoming }, 'telling the workers to stop');
    for (const worker of Object.values(cluster.workers)) worker.kill('SIGTERM');
  };

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

async function runWorker(log) {
  const handle = await start({ log });
  install(handle, log);
}

if (require.main === module) {
  const log = logger();
  if (cluster.isPrimary) {
    runPrimary(log);
  } else {
    runWorker(log).catch((err) => {
      log.fatal({ err }, 'a worker could not start');
      process.exit(1);
    });
  }
}

module.exports = { workerCount, runPrimary, RESTART_DELAY_MS };
