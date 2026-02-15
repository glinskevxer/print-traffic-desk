'use strict';

const {
  retryOnConflict,
  retryableConflict,
  isRetryableConflict,
} = require('../../../src/lib/conflicts');
const { ConflictError, ValidationError } = require('../../../src/lib/errors');

describe('losing a race', () => {
  const sleep = async () => {};

  it('hands the answer back when nothing raced', async () => {
    expect(await retryOnConflict(async () => 'ok', { sleep })).toBe('ok');
  });

  it('tries again when the work lost a race, and gives the second answer', async () => {
    let attempts = 0;

    const result = await retryOnConflict(
      async () => {
        attempts += 1;
        if (attempts < 2) throw retryableConflict('somebody else took it');
        return 'got it on the second go';
      },
      { sleep },
    );

    expect(result).toBe('got it on the second go');
    expect(attempts).toBe(2);
  });

  it('gives up after the attempts run out, with the last refusal', async () => {
    let attempts = 0;

    await expect(
      retryOnConflict(
        async () => {
          attempts += 1;
          throw retryableConflict(`lost race ${attempts}`);
        },
        { attempts: 3, sleep },
      ),
    ).rejects.toThrow('lost race 3');
    expect(attempts).toBe(3);
  });

  it('does not retry a conflict that will answer the same way forever', async () => {
    let attempts = 0;

    await expect(
      retryOnConflict(
        async () => {
          attempts += 1;
          throw new ConflictError('barcode PE-000001 is already catalogued');
        },
        { sleep },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(attempts).toBe(1);
  });

  it('does not retry anything that is not a conflict', async () => {
    let attempts = 0;

    await expect(
      retryOnConflict(
        async () => {
          attempts += 1;
          throw new ValidationError('bad body', []);
        },
        { sleep },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(attempts).toBe(1);
  });

  it('tells the work which attempt it is on', async () => {
    const seen = [];

    await retryOnConflict(
      async (attempt) => {
        seen.push(attempt);
        if (attempt < 3) throw retryableConflict('again');
        return 'ok';
      },
      { sleep },
    );

    expect(seen).toEqual([1, 2, 3]);
  });

  it('separates the callers by waiting a little longer each time', async () => {
    const slept = [];
    let attempts = 0;

    await retryOnConflict(
      async () => {
        attempts += 1;
        if (attempts < 3) throw retryableConflict('again');
        return 'ok';
      },
      { sleep: async (ms) => slept.push(ms), random: () => 1 },
    );

    expect(slept).toEqual([40, 80]);
  });

  it('marks a conflict as one worth trying again, and reads it back', () => {
    const racy = retryableConflict('lost the race', { element: 'elem_1' });

    expect(isRetryableConflict(racy)).toBe(true);
    expect(racy.details.element).toBe('elem_1');
    expect(isRetryableConflict(new ConflictError('taken'))).toBe(false);
    expect(isRetryableConflict(new Error('boom'))).toBe(false);
  });
});
