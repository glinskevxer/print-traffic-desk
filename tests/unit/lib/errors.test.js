'use strict';

const {
  CODES,
  DeskError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RuleRefusedError,
  RateLimitedError,
  UpstreamError,
  isDeskError,
  isRetryable,
} = require('../../../src/lib/errors');

describe('desk errors', () => {
  it('gives every deliberate failure a code and a status', () => {
    expect(new ValidationError('bad', []).status).toBe(400);
    expect(new NotFoundError('title', 'abc').status).toBe(404);
    expect(new ConflictError('taken').status).toBe(409);
    expect(new RuleRefusedError('refused').status).toBe(422);
    expect(new RateLimitedError(30).status).toBe(429);
    expect(new UpstreamError('down', { service: 'openai' }).status).toBe(502);
  });

  it('spells the not found message with the resource and the identifier', () => {
    const err = new NotFoundError('print element', 'PE-0091');

    expect(err.message).toBe('print element PE-0091 does not exist');
    expect(err.details).toEqual({ resource: 'print element', identifier: 'PE-0091' });
  });

  it('keeps the stack and the cause out of the client payload', () => {
    const cause = new Error('socket hang up');
    const err = new UpstreamError('extraction call failed', { service: 'openai', cause });

    const payload = err.toPayload();
    expect(payload).toEqual({
      error: {
        code: CODES.UPSTREAM_FAILED,
        message: 'extraction call failed',
        details: { service: 'openai', upstreamStatus: undefined },
      },
    });
    expect(JSON.stringify(payload)).not.toContain('socket hang up');
  });

  it('marks only the failures worth retrying', () => {
    expect(isRetryable(new RateLimitedError(5))).toBe(true);
    expect(isRetryable(new UpstreamError('down', { service: 'openai' }))).toBe(true);
    expect(
      isRetryable(new UpstreamError('bad request', { service: 'openai', retryable: false })),
    ).toBe(false);
    expect(isRetryable(new ValidationError('bad', []))).toBe(false);
    expect(isRetryable(new Error('boom'))).toBe(false);
  });

  it('separates the errors we raise from the ones that escape', () => {
    expect(isDeskError(new ConflictError('x'))).toBe(true);
    expect(isDeskError(new TypeError('x'))).toBe(false);
  });

  it('names itself after the subclass so logs are readable', () => {
    expect(new ConflictError('x').name).toBe('ConflictError');
    expect(new DeskError('x').name).toBe('DeskError');
  });

  it('carries the rule outcomes on a refusal', () => {
    const outcomes = [{ rule: 'territory', ok: false, detail: 'venue in FR, window covers GB' }];
    const err = new RuleRefusedError('booking not cleared', { outcomes });

    expect(err.toPayload().error.details.outcomes).toEqual(outcomes);
  });
});
