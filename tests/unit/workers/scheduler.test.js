'use strict';

const { createScheduler, nextDelay, DEFAULT_JOBS } = require('../../../src/workers/scheduler');
const { createLogger } = require('../../../src/lib/logger');
const { currentContext } = require('../../../src/lib/context');

const log = createLogger({ level: 'silent' });

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('the work that happens whether anybody is at the desk or not', () => {
  it('gives every job an interval and a jitter', () => {
    for (const job of DEFAULT_JOBS) {
      expect(job.everyMs).toBeGreaterThan(0);
      expect(job.jitterMs).toBeGreaterThan(0);
      expect(job.jitterMs).toBeLessThan(job.everyMs);
    }
  });

  it('spreads two desks started by the same deploy', () => {
    const job = { name: 'drain-outbox', everyMs: 60000, jitterMs: 10000 };

    expect(nextDelay(job, () => 0)).toBe(50000);
    expect(nextDelay(job, () => 0.5)).toBe(60000);
    expect(nextDelay(job, () => 1)).toBe(70000);
  });

  it('takes a job with no jitter as it is', () => {
    expect(nextDelay({ name: 'x', everyMs: 1000 }, () => 1)).toBe(1000);
  });

  it('runs a job and counts it', async () => {
    let ran = 0;
    const scheduler = createScheduler({
      jobs: [],
      handlers: { 'lapse-holds': async () => ({ lapsed: (ran += 1) }) },
      log,
    });

    const outcome = await scheduler.runOnce({ name: 'lapse-holds' });

    expect(outcome).toEqual({ lapsed: 1 });
    expect(scheduler.ranCount('lapse-holds')).toBe(1);
  });

  it('runs a job with the worker in the context, so the audit says who', async () => {
    let seen = null;
    const scheduler = createScheduler({
      jobs: [],
      handlers: {
        prune: async () => {
          seen = currentContext();
          return {};
        },
      },
      log,
    });

    await scheduler.runOnce({ name: 'prune' });

    expect(seen).toMatchObject({ actor: 'worker:prune', source: 'worker' });
  });

  it('skips a turn rather than starting a job that is still going', async () => {
    let starts = 0;
    let release;
    const scheduler = createScheduler({
      jobs: [],
      handlers: {
        'drain-outbox': async () => {
          starts += 1;
          await new Promise((resolve) => {
            release = resolve;
          });
          return {};
        },
      },
      log,
    });

    const first = scheduler.runOnce({ name: 'drain-outbox' });
    await tick();
    expect(scheduler.isRunning('drain-outbox')).toBe(true);

    const second = await scheduler.runOnce({ name: 'drain-outbox' });
    expect(second).toBeNull();
    expect(starts).toBe(1);

    release();
    await first;
    expect(scheduler.isRunning('drain-outbox')).toBe(false);
  });

  it('a job that throws does not take the worker down', async () => {
    const scheduler = createScheduler({
      jobs: [],
      handlers: {
        prune: async () => {
          throw new Error('mongo went away');
        },
      },
      log,
    });

    expect(await scheduler.runOnce({ name: 'prune' })).toBeNull();
    expect(scheduler.isRunning('prune')).toBe(false);
  });

  it('says so rather than throwing when a job has no handler', async () => {
    const scheduler = createScheduler({ jobs: [], handlers: {}, log });

    expect(await scheduler.runOnce({ name: 'nothing-like-this' })).toBeNull();
  });

  it('starts and stops without leaving a timer behind', async () => {
    const scheduler = createScheduler({
      jobs: [{ name: 'prune', everyMs: 60000, jitterMs: 0 }],
      handlers: { prune: async () => ({}) },
      log,
    });

    scheduler.start();
    await scheduler.stop();

    expect(scheduler.isRunning('prune')).toBe(false);
  });

  it('waits for what is mid flight before it stops', async () => {
    let finished = false;
    let release;
    const scheduler = createScheduler({
      jobs: [],
      handlers: {
        prune: async () => {
          await new Promise((resolve) => {
            release = resolve;
          });
          finished = true;
          return {};
        },
      },
      log,
    });

    const running = scheduler.runOnce({ name: 'prune' });
    await tick();
    const stopping = scheduler.stop();
    release();
    await running;
    await stopping;

    expect(finished).toBe(true);
  });
});
