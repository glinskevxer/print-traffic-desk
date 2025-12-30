'use strict';

const os = require('os');
const { workerCount, RESTART_DELAY_MS } = require('../../../src/http/cluster');

describe('running across workers', () => {
  const originalConcurrency = process.env.WEB_CONCURRENCY;

  afterEach(() => {
    if (originalConcurrency === undefined) delete process.env.WEB_CONCURRENCY;
    else process.env.WEB_CONCURRENCY = originalConcurrency;
  });

  it('takes the count it was given', () => {
    process.env.WEB_CONCURRENCY = '7';

    expect(workerCount()).toBe(7);
  });

  it('ignores a count that is not a positive number', () => {
    process.env.WEB_CONCURRENCY = 'lots';
    expect(workerCount()).toBeGreaterThanOrEqual(1);

    process.env.WEB_CONCURRENCY = '0';
    expect(workerCount()).toBeGreaterThanOrEqual(1);
  });

  it('otherwise takes what the box has, up to four', () => {
    delete process.env.WEB_CONCURRENCY;
    const available = os.availableParallelism ? os.availableParallelism() : os.cpus().length;

    expect(workerCount()).toBe(Math.max(1, Math.min(available, 4)));
    expect(workerCount()).toBeLessThanOrEqual(4);
  });

  it('waits before replacing a worker, so a crash loop is not a busy loop', () => {
    expect(RESTART_DELAY_MS).toBeGreaterThanOrEqual(1000);
  });
});
