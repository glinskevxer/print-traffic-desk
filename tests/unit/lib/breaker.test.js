'use strict';

const { createBreaker, BreakerOpenError, STATES } = require('../../../src/lib/breaker');
const { UpstreamError, ValidationError } = require('../../../src/lib/errors');

function clock(start = 1_750_000_000_000) {
  let at = start;
  return { now: () => at, advance: (ms) => (at += ms) };
}

const down = () => Promise.reject(new UpstreamError('timeout', { service: 'openai' }));

describe('not asking an upstream that is not answering', () => {
  it('lets everything through while it is working', async () => {
    const breaker = createBreaker();

    expect(await breaker.run(async () => 'ok')).toBe('ok');
    expect(breaker.state).toBe(STATES.CLOSED);
    expect(breaker.failures).toBe(0);
  });

  it('counts failures and opens on the threshold', async () => {
    const breaker = createBreaker({ failuresToOpen: 3 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(breaker.run(down)).rejects.toThrow(UpstreamError);
    }

    expect(breaker.state).toBe(STATES.OPEN);
  });

  it('fails instantly once it is open, without calling anything', async () => {
    const breaker = createBreaker({ failuresToOpen: 1, service: 'openai' });
    await expect(breaker.run(down)).rejects.toThrow(UpstreamError);

    let called = false;
    await expect(
      breaker.run(async () => {
        called = true;
      }),
    ).rejects.toBeInstanceOf(BreakerOpenError);
    expect(called).toBe(false);
  });

  it('says which upstream and when it will look again', async () => {
    const time = clock();
    const breaker = createBreaker({
      failuresToOpen: 1,
      openMs: 60000,
      service: 'openai',
      now: time.now,
    });
    await breaker.run(down).catch(() => {});

    let caught;
    try {
      await breaker.run(async () => 'ok');
    } catch (err) {
      caught = err;
    }

    expect(caught.details.service).toBe('openai');
    expect(caught.status).toBe(503);
    expect(caught.retryable).toBe(true);
    expect(caught.openUntil.getTime()).toBe(time.now() + 60000);
  });

  it('lets one call through once the wait is over', async () => {
    const time = clock();
    const breaker = createBreaker({ failuresToOpen: 1, openMs: 60000, now: time.now });
    await breaker.run(down).catch(() => {});

    time.advance(60000);
    expect(breaker.state).toBe(STATES.HALF_OPEN);
    expect(await breaker.run(async () => 'back')).toBe('back');
    expect(breaker.state).toBe(STATES.CLOSED);
  });

  it('lets exactly one through while it is finding out', async () => {
    const time = clock();
    const breaker = createBreaker({ failuresToOpen: 1, openMs: 1000, now: time.now });
    await breaker.run(down).catch(() => {});
    time.advance(1000);

    let release;
    const probe = breaker.run(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    await expect(breaker.run(async () => 'second')).rejects.toBeInstanceOf(BreakerOpenError);
    release('first');
    expect(await probe).toBe('first');
  });

  it('opens again on a failed probe rather than counting to the threshold', async () => {
    const time = clock();
    const breaker = createBreaker({ failuresToOpen: 5, openMs: 1000, now: time.now });
    for (let attempt = 0; attempt < 5; attempt += 1) await breaker.run(down).catch(() => {});
    time.advance(1000);

    await expect(breaker.run(down)).rejects.toThrow(UpstreamError);

    expect(breaker.state).toBe(STATES.OPEN);
  });

  it('does not count a failure that is the desk fault', async () => {
    const breaker = createBreaker({
      failuresToOpen: 2,
      isFailure: (err) => err instanceof UpstreamError,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        breaker.run(async () => {
          throw new ValidationError('the model answered with nonsense', []);
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }

    expect(breaker.state).toBe(STATES.CLOSED);
    expect(breaker.failures).toBe(0);
  });

  it('forgets the failures after a success', async () => {
    const breaker = createBreaker({ failuresToOpen: 3 });
    await breaker.run(down).catch(() => {});
    await breaker.run(down).catch(() => {});

    await breaker.run(async () => 'ok');

    expect(breaker.failures).toBe(0);
    expect(breaker.state).toBe(STATES.CLOSED);
  });

  it('can be put back by hand', async () => {
    const breaker = createBreaker({ failuresToOpen: 1 });
    await breaker.run(down).catch(() => {});

    breaker.reset();

    expect(breaker.state).toBe(STATES.CLOSED);
    expect(await breaker.run(async () => 'ok')).toBe('ok');
  });
});
