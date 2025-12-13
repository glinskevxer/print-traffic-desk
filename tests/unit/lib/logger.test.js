'use strict';

const { Writable } = require('stream');
const { createLogger, serialiseError } = require('../../../src/lib/logger');
const { UpstreamError, ConflictError } = require('../../../src/lib/errors');

function capture() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  return { lines, stream };
}

describe('logger', () => {
  it('stamps the service name on every line', () => {
    const { lines, stream } = capture();
    const log = createLogger({ service: 'printdesk', destination: stream });

    log.info('booking cleared');

    expect(lines[0].service).toBe('printdesk');
    expect(lines[0].msg).toBe('booking cleared');
  });

  it('blanks the credentials that ride on a request', () => {
    const { lines, stream } = capture();
    const log = createLogger({ destination: stream });

    log.info(
      { req: { headers: { authorization: 'Bearer sk-live-1234', 'x-api-key': 'pd_secret' } } },
      'inbound',
    );

    expect(lines[0].req.headers.authorization).toBe('[redacted]');
    expect(lines[0].req.headers['x-api-key']).toBe('[redacted]');
    expect(JSON.stringify(lines[0])).not.toContain('sk-live-1234');
  });

  it('keeps the desk code and status on a logged error', () => {
    const { lines, stream } = capture();
    const log = createLogger({ destination: stream });

    log.error({ err: new ConflictError('barcode already held', { barcode: 'PE-1' }) }, 'refused');

    expect(lines[0].err.code).toBe('conflict');
    expect(lines[0].err.status).toBe(409);
    expect(lines[0].err.details).toEqual({ barcode: 'PE-1' });
  });

  it('flattens a cause down to its type and message', () => {
    const cause = new Error('ETIMEDOUT');
    const serialised = serialiseError(
      new UpstreamError('extract failed', { service: 'openai', cause }),
    );

    expect(serialised.cause).toEqual({ type: 'Error', message: 'ETIMEDOUT' });
    expect(serialised.retryable).toBe(true);
  });

  it('drops lines below the configured level', () => {
    const { lines, stream } = capture();
    const log = createLogger({ level: 'warn', destination: stream });

    log.debug('noise');
    log.warn('worth reading');

    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('worth reading');
  });
});
