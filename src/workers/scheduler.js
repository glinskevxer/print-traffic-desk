'use strict';

const { logger } = require('../lib/logger');
const { runWithContext } = require('../lib/context');

/**
 * The jobs that have to happen whether anybody is at the desk or not.
 *
 * Deliberately a timer in a process rather than cron in a container: the desk
 * already knows how to connect, log and audit, and a cron entry that shells
 * into a container to run a command is a second deployment nobody updates.
 *
 * Each job runs alone. Two of them overlapping is not dangerous, because they
 * all claim what they work on, but a slow drain that starts three more drains
 * behind it is a queue of connections nobody asked for.
 */

const DEFAULT_JOBS = Object.freeze([
  { name: 'lapse-holds', everyMs: 300000, jitterMs: 30000 },
  { name: 'drain-outbox', everyMs: 60000, jitterMs: 10000 },
  { name: 'expire-windows', everyMs: 3600000, jitterMs: 120000 },
  { name: 'quarantine-overdue', everyMs: 86400000, jitterMs: 600000 },
  { name: 'prune', everyMs: 86400000, jitterMs: 600000 },
]);

/**
 * Spread, so two desks started by the same deploy do not both wake at the same
 * second and race each other for the same rows.
 */
function nextDelay(job, random = Math.random) {
  return job.everyMs + Math.round((random() * 2 - 1) * (job.jitterMs || 0));
}

function createScheduler({ jobs = DEFAULT_JOBS, handlers, log = logger(), random = Math.random }) {
  const timers = new Map();
  const running = new Set();
  const counts = new Map();
  let stopped = false;

  async function runOnce(job) {
    if (running.has(job.name)) {
      log.warn({ job: job.name }, 'job is still running, skipping this turn');
      return null;
    }
    const handler = handlers[job.name];
    if (!handler) {
      log.error({ job: job.name }, 'no handler for that job');
      return null;
    }

    running.add(job.name);
    const startedAt = Date.now();
    try {
      const outcome = await runWithContext({ actor: `worker:${job.name}`, source: 'worker' }, () =>
        handler({ log }),
      );
      counts.set(job.name, (counts.get(job.name) || 0) + 1);
      log.info({ job: job.name, elapsedMs: Date.now() - startedAt, outcome }, 'job finished');
      return outcome;
    } catch (err) {
      log.error({ job: job.name, err, elapsedMs: Date.now() - startedAt }, 'job failed');
      return null;
    } finally {
      running.delete(job.name);
    }
  }

  function schedule(job) {
    if (stopped) return;
    const delay = nextDelay(job, random);
    const timer = setTimeout(async () => {
      await runOnce(job);
      schedule(job);
    }, delay);
    timer.unref();
    timers.set(job.name, timer);
  }

  return {
    start() {
      stopped = false;
      for (const job of jobs) schedule(job);
      log.info({ jobs: jobs.map((job) => job.name) }, 'scheduler started');
      return this;
    },
    async stop() {
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      // Let whatever is mid flight finish rather than tearing a transaction up.
      while (running.size > 0) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      log.info('scheduler stopped');
    },
    runOnce,
    ranCount: (name) => counts.get(name) || 0,
    isRunning: (name) => running.has(name),
  };
}

module.exports = { createScheduler, nextDelay, DEFAULT_JOBS };
