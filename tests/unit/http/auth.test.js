'use strict';

const { requireRole, requireOwnVenue, outranks } = require('../../../src/http/middleware/auth');
const { ForbiddenError, NotAuthenticatedError } = require('../../../src/lib/errors');

function run(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve(err));
  });
}

const operator = (overrides = {}) => ({
  role: 'viewer',
  venue: null,
  isHouseBound() {
    return this.venue !== null && this.role !== 'admin';
  },
  ...overrides,
});

describe('who is allowed to do what', () => {
  it('ranks the roles so a senior one covers a junior one', () => {
    expect(outranks('admin', 'viewer')).toBe(true);
    expect(outranks('archivist', 'programmer')).toBe(true);
    expect(outranks('viewer', 'programmer')).toBe(false);
    expect(outranks('programmer', 'traffic')).toBe(true);
  });

  it('lets a role through when it is named', async () => {
    expect(await run(requireRole('traffic'), { operator: operator({ role: 'traffic' }) })).toBeUndefined();
  });

  it('lets a senior role through a junior gate', async () => {
    expect(await run(requireRole('viewer'), { operator: operator({ role: 'admin' }) })).toBeUndefined();
  });

  it('turns a junior role away and says what was needed', async () => {
    const err = await run(requireRole('archivist'), { operator: operator({ role: 'viewer' }) });

    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.details).toEqual({ role: 'viewer', allowed: ['archivist'] });
    expect(err.message).toMatch(/you are viewer/);
  });

  it('accepts any of several named roles', async () => {
    const gate = requireRole('traffic', 'archivist');

    expect(await run(gate, { operator: operator({ role: 'traffic' }) })).toBeUndefined();
    expect(await run(gate, { operator: operator({ role: 'archivist' }) })).toBeUndefined();
    expect(await run(gate, { operator: operator({ role: 'viewer' }) })).toBeInstanceOf(ForbiddenError);
  });

  it('needs an operator at all', async () => {
    expect(await run(requireRole('viewer'), {})).toBeInstanceOf(NotAuthenticatedError);
    expect(await run(requireOwnVenue(() => 'x'), {})).toBeInstanceOf(NotAuthenticatedError);
  });

  it('lets an unbound operator act for any house', async () => {
    const gate = requireOwnVenue((req) => req.params.venueId);

    const err = await run(gate, {
      operator: operator({ role: 'traffic' }),
      params: { venueId: 'anything' },
    });

    expect(err).toBeUndefined();
  });

  it('holds a house bound operator to their own house', async () => {
    const gate = requireOwnVenue((req) => req.params.venueId);
    const bound = operator({ role: 'programmer', venue: 'venue-prince' });

    expect(await run(gate, { operator: bound, params: { venueId: 'venue-prince' } })).toBeUndefined();

    const err = await run(gate, { operator: bound, params: { venueId: 'venue-bfi' } });
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toMatch(/your own house/);
  });

  it('does not bind an admin even when they have a house', async () => {
    const gate = requireOwnVenue((req) => req.params.venueId);
    const admin = operator({ role: 'admin', venue: 'venue-prince' });

    expect(await run(gate, { operator: admin, params: { venueId: 'venue-bfi' } })).toBeUndefined();
  });

  it('lets a request with no house named through', async () => {
    const gate = requireOwnVenue(() => null);

    expect(
      await run(gate, { operator: operator({ role: 'programmer', venue: 'venue-prince' }) }),
    ).toBeUndefined();
  });
});
