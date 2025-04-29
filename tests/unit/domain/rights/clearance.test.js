'use strict';

const {
  clearScreening,
  preferenceOrder,
  summariseRefusal,
  refusalDetails,
} = require('../../../../src/domain/rights/clearance');

const licence = (overrides = {}) => ({
  publicId: 'rw_A00000000000000',
  status: 'active',
  startsOn: '2025-01-01',
  endsOn: '2025-12-31',
  holdbackUntil: null,
  territory: 'GB',
  exhibitionTypes: ['repertory'],
  maxScreenings: null,
  screeningsUsed: 0,
  maxScreeningsPerVenue: null,
  blackouts: [],
  ...overrides,
});

const request = (overrides = {}) => ({
  localDate: '2025-04-17',
  country: 'GB',
  city: 'London',
  exhibitionType: 'repertory',
  venueId: 'venue-ica',
  screenings: 1,
  screeningsAtVenue: 0,
  ...overrides,
});

describe('clearing a screening', () => {
  it('clears under the only licence that fits', () => {
    const result = clearScreening({ windows: [licence()], request: request() });

    expect(result.cleared).toBe(true);
    expect(result.windowId).toBe('rw_A00000000000000');
    expect(result.evaluations[0].outcomes).toHaveLength(9);
  });

  it('refuses when there is no licence at all', () => {
    const result = clearScreening({ windows: [], request: request() });

    expect(result.cleared).toBe(false);
    expect(result.refusalCodes).toEqual(['no-licence']);
  });

  it('prefers the narrowest territory when two licences both fit', () => {
    const national = licence({ publicId: 'rw_NATIONAL000000', territory: 'GB' });
    const anglophone = licence({ publicId: 'rw_UKIE0000000000', territory: 'UK-IE' });
    const worldwide = licence({ publicId: 'rw_WORLD000000000', territory: 'WORLD' });

    const result = clearScreening({ windows: [worldwide, anglophone, national], request: request() });

    expect(result.windowId).toBe('rw_NATIONAL000000');
    expect(result.alternatives).toEqual(['rw_UKIE0000000000', 'rw_WORLD000000000']);
  });

  it('prefers the licence that closes soonest when the territories match', () => {
    const closing = licence({ publicId: 'rw_CLOSING00000000', endsOn: '2025-05-31' });
    const open = licence({ publicId: 'rw_OPEN00000000000', endsOn: '2026-12-31' });

    const result = clearScreening({ windows: [open, closing], request: request() });

    expect(result.windowId).toBe('rw_CLOSING00000000');
  });

  it('breaks a full tie on the id so the answer never moves', () => {
    const first = licence({ publicId: 'rw_A00000000000000' });
    const second = licence({ publicId: 'rw_B00000000000000' });

    expect(clearScreening({ windows: [second, first], request: request() }).windowId).toBe(
      'rw_A00000000000000',
    );
    expect(clearScreening({ windows: [first, second], request: request() }).windowId).toBe(
      'rw_A00000000000000',
    );
  });

  it('refuses a licence that fits when somebody else holds the exclusive', () => {
    const exclusiveElsewhere = {
      publicId: 'rw_EXCLUSIVE000000',
      status: 'active',
      startsOn: '2025-01-01',
      endsOn: '2025-12-31',
      territory: 'GB',
      exhibitionTypes: ['repertory'],
      exclusivity: { scope: 'city', heldBy: 'venue-prince' },
      holderCity: 'London',
      holderName: 'Prince Charles Cinema',
    };

    const result = clearScreening({
      windows: [licence()],
      exclusiveWindows: [exclusiveElsewhere],
      request: request(),
    });

    expect(result.cleared).toBe(false);
    expect(result.refusalCodes).toEqual(['exclusivity']);
    expect(refusalDetails(result.evaluations)[0].detail).toMatch(/Prince Charles Cinema/);
  });

  it('lets the holder of the exclusive book under it', () => {
    const held = {
      publicId: 'rw_EXCLUSIVE000000',
      status: 'active',
      startsOn: '2025-01-01',
      endsOn: '2025-12-31',
      territory: 'GB',
      exhibitionTypes: ['repertory'],
      exclusivity: { scope: 'city', heldBy: 'venue-prince' },
      holderCity: 'London',
      maxScreenings: null,
      screeningsUsed: 0,
      blackouts: [],
    };

    const result = clearScreening({
      windows: [held],
      exclusiveWindows: [held],
      request: request({ venueId: 'venue-prince' }),
    });

    expect(result.cleared).toBe(true);
  });

  it('collects every distinct reason across the candidates', () => {
    const result = clearScreening({
      windows: [
        licence({ publicId: 'rw_ONE00000000000', status: 'suspended' }),
        licence({ publicId: 'rw_TWO00000000000', territory: 'FR' }),
      ],
      request: request(),
    });

    expect(result.refusalCodes).toEqual(['status', 'territory']);
  });

  it('does not clear on a licence that is exhausted', () => {
    const result = clearScreening({
      windows: [licence({ maxScreenings: 2, screeningsUsed: 2 })],
      request: request(),
    });

    expect(result.cleared).toBe(false);
    expect(result.refusalCodes).toEqual(['screening-cap']);
  });

  it('lists the failing detail once even when two licences fail the same way', () => {
    const details = refusalDetails(
      clearScreening({
        windows: [
          licence({ publicId: 'rw_ONE00000000000', territory: 'FR' }),
          licence({ publicId: 'rw_TWO00000000000', territory: 'FR' }),
        ],
        request: request(),
      }).evaluations,
    );

    expect(details).toHaveLength(1);
    expect(details[0].detail).toMatch(/FR does not reach GB/);
  });

  it('says no-licence only when there was nothing to evaluate', () => {
    expect(summariseRefusal([])).toEqual(['no-licence']);
    expect(summariseRefusal([{ refusals: ['window'] }])).toEqual(['window']);
  });

  it('orders two candidates the same way whichever is asked first', () => {
    const a = { territory: 'GB', endsOn: '2025-06-01', publicId: 'rw_A' };
    const b = { territory: 'EU', endsOn: '2025-06-01', publicId: 'rw_B' };

    expect(preferenceOrder(a, b)).toBeLessThan(0);
    expect(preferenceOrder(b, a)).toBeGreaterThan(0);
  });
});
