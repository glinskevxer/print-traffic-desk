'use strict';

const {
  runWithContext,
  withContext,
  currentContext,
  currentActor,
  currentRequestId,
} = require('../../../src/lib/context');

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('request context', () => {
  it('is empty outside any request', () => {
    expect(currentActor()).toBeNull();
    expect(currentRequestId()).toBeNull();
    expect(currentContext().source).toBe('system');
  });

  it('carries the actor through an await', async () => {
    await runWithContext({ requestId: 'req-1', actor: 'ops@archive.test' }, async () => {
      await tick();
      expect(currentActor()).toBe('ops@archive.test');
      await tick();
      expect(currentRequestId()).toBe('req-1');
    });
  });

  it('does not leak out of the call it was set for', async () => {
    await runWithContext({ requestId: 'req-1' }, async () => {
      await tick();
    });

    expect(currentRequestId()).toBeNull();
  });

  it('keeps two concurrent requests apart', async () => {
    const seen = [];
    await Promise.all([
      runWithContext({ requestId: 'a' }, async () => {
        await tick();
        await tick();
        seen.push(currentRequestId());
      }),
      runWithContext({ requestId: 'b' }, async () => {
        await tick();
        seen.push(currentRequestId());
      }),
    ]);

    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('adds to a context without losing what was there', async () => {
    await runWithContext({ requestId: 'req-1', actor: 'ops' }, async () => {
      await withContext({ source: 'worker' }, async () => {
        expect(currentContext()).toEqual({
          requestId: 'req-1',
          actor: 'ops',
          role: null,
          source: 'worker',
        });
      });
      expect(currentContext().source).toBe('system');
    });
  });

  it('hands back a frozen context', async () => {
    await runWithContext({ requestId: 'req-1' }, async () => {
      expect(Object.isFrozen(currentContext())).toBe(true);
    });
  });
});
