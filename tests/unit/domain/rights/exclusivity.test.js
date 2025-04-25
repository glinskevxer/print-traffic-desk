'use strict';

const {
  blocks,
  exclusivityRule,
  findExclusivityClashes,
  clashIsResolvable,
} = require('../../../../src/domain/rights/exclusivity');

const exclusive = (overrides = {}) => ({
  publicId: 'rw_EXCLUSIVE00000A',
  status: 'active',
  startsOn: '2025-01-01',
  endsOn: '2025-12-31',
  territory: 'GB',
  exhibitionTypes: ['repertory'],
  exclusivity: { scope: 'city', heldBy: 'venue-prince' },
  holderCity: 'London',
  holderName: 'Prince Charles Cinema',
  ...overrides,
});

const request = (overrides = {}) => ({
  localDate: '2025-04-17',
  country: 'GB',
  city: 'London',
  exhibitionType: 'repertory',
  venueId: 'venue-ica',
  ...overrides,
});

describe('exclusivity', () => {
  it('blocks another house in the same city', () => {
    expect(blocks(exclusive(), request())).toBe(true);
  });

  it('does not block the house that holds it', () => {
    expect(blocks(exclusive(), request({ venueId: 'venue-prince' }))).toBe(false);
  });

  it('does not reach another city under a city exclusive', () => {
    expect(blocks(exclusive(), request({ city: 'Glasgow' }))).toBe(false);
  });

  it('ignores the case and the spacing of a city name', () => {
    expect(blocks(exclusive({ holderCity: ' london ' }), request({ city: 'LONDON' }))).toBe(true);
  });

  it('reaches every city under a territory exclusive', () => {
    const territoryWide = exclusive({ exclusivity: { scope: 'territory', heldBy: 'venue-prince' } });

    expect(blocks(territoryWide, request({ city: 'Glasgow' }))).toBe(true);
    expect(blocks(territoryWide, request({ country: 'FR' }))).toBe(false);
  });

  it('does not block outside its own dates', () => {
    expect(blocks(exclusive(), request({ localDate: '2026-01-01' }))).toBe(false);
  });

  it('does not block a kind of exhibition it never covered', () => {
    expect(blocks(exclusive(), request({ exhibitionType: 'educational' }))).toBe(false);
  });

  it('a suspended exclusive blocks nobody', () => {
    expect(blocks(exclusive({ status: 'suspended' }), request())).toBe(false);
    expect(blocks(exclusive({ status: 'draft' }), request())).toBe(false);
  });

  it('a window with no exclusivity blocks nobody', () => {
    expect(blocks(exclusive({ exclusivity: { scope: 'none', heldBy: null } }), request())).toBe(false);
  });

  it('names every house doing the blocking', () => {
    const outcome = exclusivityRule(
      [
        exclusive(),
        exclusive({
          publicId: 'rw_EXCLUSIVE00000B',
          holderName: 'BFI Southbank',
          exclusivity: { scope: 'territory', heldBy: 'venue-bfi' },
        }),
      ],
      request(),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toMatch(/Prince Charles Cinema \(city\)/);
    expect(outcome.detail).toMatch(/BFI Southbank \(territory\)/);
    expect(outcome.blockedBy).toEqual(['rw_EXCLUSIVE00000A', 'rw_EXCLUSIVE00000B']);
  });

  it('passes when nothing exclusive covers the screening', () => {
    expect(exclusivityRule([], request()).ok).toBe(true);
    expect(exclusivityRule(undefined, request()).ok).toBe(true);
  });

  it('finds a clash between two exclusive licences that overlap', () => {
    const candidate = exclusive({ publicId: 'rw_NEW', territory: 'EU' });
    const existing = exclusive({ publicId: 'rw_OLD', territory: 'FR' });

    expect(findExclusivityClashes(candidate, [existing])).toHaveLength(1);
  });

  it('is not a clash when the territories never meet', () => {
    const candidate = exclusive({ publicId: 'rw_NEW', territory: 'NORDIC' });
    const existing = exclusive({ publicId: 'rw_OLD', territory: 'DACH' });

    expect(findExclusivityClashes(candidate, [existing])).toEqual([]);
  });

  it('is not a clash when the dates never meet', () => {
    const candidate = exclusive({ publicId: 'rw_NEW', startsOn: '2026-01-01', endsOn: '2026-06-01' });

    expect(findExclusivityClashes(candidate, [exclusive({ publicId: 'rw_OLD' })])).toEqual([]);
  });

  it('is not a clash when the kinds of exhibition never meet', () => {
    const candidate = exclusive({ publicId: 'rw_NEW', exhibitionTypes: ['festival'] });

    expect(findExclusivityClashes(candidate, [exclusive({ publicId: 'rw_OLD' })])).toEqual([]);
  });

  it('a non exclusive candidate clashes with nothing', () => {
    const candidate = exclusive({ publicId: 'rw_NEW', exclusivity: { scope: 'none', heldBy: null } });

    expect(findExclusivityClashes(candidate, [exclusive()])).toEqual([]);
  });

  it('does not clash with itself', () => {
    const candidate = exclusive({ publicId: 'rw_SAME' });

    expect(findExclusivityClashes(candidate, [exclusive({ publicId: 'rw_SAME' })])).toEqual([]);
  });

  it('lets one house hold both a city and a territory exclusive', () => {
    const candidate = exclusive({ exclusivity: { scope: 'territory', heldBy: 'venue-prince' } });

    expect(clashIsResolvable(candidate, exclusive())).toBe(true);
    expect(clashIsResolvable(candidate, exclusive({ exclusivity: { scope: 'city', heldBy: 'x' } }))).toBe(
      false,
    );
  });
});
