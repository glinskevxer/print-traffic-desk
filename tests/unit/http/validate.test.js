'use strict';

const { z } = require('zod');
const { validate, validateAll, parseOrThrow } = require('../../../src/http/middleware/validate');
const { ValidationError } = require('../../../src/lib/errors');
const { listQuery, dateRange, publicId, barcode } = require('../../../src/http/schemas/common');

function run(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve(err));
  });
}

describe('request validation', () => {
  it('puts the parsed input on req.valid and leaves the body alone', async () => {
    const middleware = validate({ body: z.object({ seats: z.coerce.number() }) });
    const req = { body: { seats: '288' } };

    const err = await run(middleware, req);

    expect(err).toBeUndefined();
    expect(req.valid.body).toEqual({ seats: 288 });
    expect(req.body).toEqual({ seats: '288' });
  });

  it('names the source and the key of every problem', async () => {
    const middleware = validate({ body: z.object({ year: z.number().int() }) });

    const err = await run(middleware, { body: { year: 'nineteen' } });

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details.issues).toEqual([
      { source: 'body', key: 'year', problem: expect.stringMatching(/number/) },
    ]);
  });

  it('stops at the first source when validating one at a time', async () => {
    const middleware = validate({
      body: z.object({ year: z.number() }),
      query: z.object({ limit: z.number() }),
    });

    const err = await run(middleware, { body: { year: 'x' }, query: { limit: 'y' } });

    expect(err.details.issues.map((i) => i.source)).toEqual(['body']);
  });

  it('collects failures from every source when asked for all of them', async () => {
    const middleware = validateAll({
      body: z.object({ year: z.number() }),
      query: z.object({ limit: z.number() }),
      params: z.object({ id: z.string().uuid() }),
    });

    const err = await run(middleware, { body: { year: 'x' }, query: { limit: 'y' }, params: { id: 'z' } });

    expect(err.details.issues.map((i) => i.source).sort()).toEqual(['body', 'path', 'query']);
    expect(err.message).toMatch(/body and query and path/);
  });

  it('applies the defaults on a list query', () => {
    expect(parseOrThrow(listQuery, {}, 'query')).toEqual({ limit: 50, order: 'asc' });
    expect(parseOrThrow(listQuery, { limit: '10', order: 'desc' }, 'query')).toEqual({
      limit: 10,
      order: 'desc',
    });
  });

  it('caps how much of a list one call can take', () => {
    expect(() => parseOrThrow(listQuery, { limit: '5000' }, 'query')).toThrow(ValidationError);
    expect(() => parseOrThrow(listQuery, { limit: '0' }, 'query')).toThrow(ValidationError);
  });

  it('refuses a window that ends before it starts', () => {
    let caught;
    try {
      parseOrThrow(dateRange, { startsOn: '2025-05-01', endsOn: '2025-04-01' }, 'body');
    } catch (err) {
      caught = err;
    }
    expect(caught.details.issues).toEqual([
      { source: 'body', key: 'endsOn', problem: 'the window ends before it starts' },
    ]);
    expect(parseOrThrow(dateRange, { startsOn: '2025-04-01', endsOn: '2025-04-01' }, 'body')).toEqual({
      startsOn: '2025-04-01',
      endsOn: '2025-04-01',
    });
  });

  it('checks a public id against its prefix', () => {
    const schema = publicId('ttl');

    expect(schema.safeParse('ttl_0123456789ABCDEF').success).toBe(true);
    expect(schema.safeParse('ven_0123456789ABCDEF').success).toBe(false);
    expect(schema.safeParse('ttl_0123').success).toBe(false);
  });

  it('checks a barcode against the printed shape', () => {
    expect(barcode.safeParse('PE-000123').success).toBe(true);
    expect(barcode.safeParse('PE-123').success).toBe(false);
  });
});
