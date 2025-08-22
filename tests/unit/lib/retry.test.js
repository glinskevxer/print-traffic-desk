'use strict';

const { backoffDelay, withRetry, delayFromError } = require('../../../src/lib/retry');
const { RateLimitedError, UpstreamError, ValidationError } = require('../../../src/lib/errors');

function recorder() {
  const slept = [];
  return { slept, sleep: async (ms) => slept.push(ms) };
}

describe('retrying an upstream call', () => {
  it('returns the first answer when there is nothing to retry', async () => {
    const { sleep, slept } = recorder();

    const result = await withRetry(async () => 'ok', { sleep });

    expect(result).toBe('ok');
    expect(slept).toEqual([]);
  });

  it('retries a retryable failure and gives the answer when it lands', async () => {
    const { sleep, slept } = recorder();
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new UpstreamError('502', { service: 'openai' });
        return 'landed';
      },
      { sleep, random: () => 1 },
    );

    expect(result).toBe('landed');
    expect(calls).toBe(3);
    expect(slept).toEqual([500, 1000]);
  });

  it('does not retry a failure the caller will get the same answer to', async () => {
    const { sleep, slept } = recorder();
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new ValidationError('bad body', []);
        },
        { sleep },
      ),
    ).rejects.toThrow(ValidationError);

    expect(calls).toBe(1);
    expect(slept).toEqual([]);
  });

  it('gives up after the attempts run out and throws the last failure', async () => {
    const { sleep, slept } = recorder();
    let calls = 0;

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new UpstreamError(`attempt ${calls}`, { service: 'openai' });
        },
        { sleep, attempts: 4, random: () => 1 },
      ),
    ).rejects.toThrow('attempt 4');

    expect(calls).toBe(4);
    expect(slept).toHaveLength(3);
  });

  it('tells the caller which attempt it is on', async () => {
    const attempts = [];

    await withRetry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 2) throw new UpstreamError('again', { service: 'openai' });
        return 'ok';
      },
      { sleep: async () => {} },
    );

    expect(attempts).toEqual([1, 2]);
  });

  it('reports every retry to whoever is watching', async () => {
    const seen = [];
    let calls = 0;

    await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new RateLimitedError(1);
        return 'ok';
      },
      { sleep: async () => {}, onRetry: (info) => seen.push(info), random: () => 0.5 },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].attempt).toBe(1);
    expect(seen[0].error).toBeInstanceOf(RateLimitedError);
  });

  it('doubles the ceiling each attempt and never passes the cap', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 800, random: () => 1 };

    expect(backoffDelay(1, options)).toBe(100);
    expect(backoffDelay(2, options)).toBe(200);
    expect(backoffDelay(3, options)).toBe(400);
    expect(backoffDelay(4, options)).toBe(800);
    expect(backoffDelay(9, options)).toBe(800);
  });

  it('spreads the retries out rather than lining them up', () => {
    const options = { baseDelayMs: 1000, maxDelayMs: 60000 };

    expect(backoffDelay(3, { ...options, random: () => 0 })).toBe(0);
    expect(backoffDelay(3, { ...options, random: () => 0.25 })).toBe(1000);
    expect(backoffDelay(3, { ...options, random: () => 1 })).toBe(4000);
  });

  it('waits as long as the upstream asked when it said', () => {
    expect(delayFromError(new RateLimitedError(30), 500)).toBe(30000);
    expect(delayFromError(new UpstreamError('x', { service: 'openai' }), 500)).toBe(500);
    expect(delayFromError(null, 500)).toBe(500);
  });

  it('refuses a nonsense attempt count', async () => {
    await expect(withRetry(async () => 'ok', { attempts: 0 })).rejects.toThrow(TypeError);
  });
});
