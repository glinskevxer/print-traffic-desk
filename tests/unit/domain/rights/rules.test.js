'use strict';

const {
  statusRule,
  windowRule,
  holdbackRule,
  territoryRule,
  exhibitionTypeRule,
  screeningCapRule,
  venueCapRule,
  blackoutRule,
  evaluateSelfContained,
} = require('../../../../src/domain/rights/rules');

const window = (overrides = {}) => ({
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
  exhibitionType: 'repertory',
  screenings: 1,
  screeningsAtVenue: 0,
  ...overrides,
});

describe('clearance rules', () => {
  it('only an active licence grants anything', () => {
    expect(statusRule(window()).ok).toBe(true);
    expect(statusRule(window({ status: 'draft' })).detail).toMatch(/still a draft/);
    expect(statusRule(window({ status: 'expired' })).ok).toBe(false);
    expect(
      statusRule(window({ status: 'suspended', suspendedReason: 'unpaid invoice' })).detail,
    ).toMatch(/unpaid invoice/);
  });

  it('reads the screening date against the window, ends included', () => {
    expect(windowRule(window(), request({ localDate: '2025-01-01' })).ok).toBe(true);
    expect(windowRule(window(), request({ localDate: '2025-12-31' })).ok).toBe(true);
    expect(windowRule(window(), request({ localDate: '2024-12-31' })).detail).toMatch(
      /does not open until/,
    );
    expect(windowRule(window(), request({ localDate: '2026-01-01' })).detail).toMatch(/closed on/);
  });

  it('holds a title back inside its own licence', () => {
    const held = window({ holdbackUntil: '2025-06-01' });

    expect(holdbackRule(held, request({ localDate: '2025-05-31' })).ok).toBe(false);
    expect(holdbackRule(held, request({ localDate: '2025-06-01' })).ok).toBe(true);
    expect(holdbackRule(window(), request()).detail).toMatch(/no holdback/);
  });

  it('matches the territory through a region', () => {
    expect(territoryRule(window({ territory: 'EU' }), request({ country: 'FR' })).ok).toBe(true);
    expect(territoryRule(window({ territory: 'EU' }), request({ country: 'GB' })).ok).toBe(false);
    expect(territoryRule(window({ territory: 'WORLD' }), request({ country: 'JP' })).ok).toBe(true);
    expect(territoryRule(window(), request({ country: 'IE' })).detail).toMatch(/does not reach IE/);
  });

  it('checks the kind of exhibition the licence was written for', () => {
    const festivalOnly = window({ exhibitionTypes: ['festival'] });

    expect(exhibitionTypeRule(festivalOnly, request({ exhibitionType: 'festival' })).ok).toBe(true);
    expect(exhibitionTypeRule(festivalOnly, request()).detail).toMatch(/covers festival, not repertory/);
  });

  it('counts the whole licence allowance', () => {
    expect(screeningCapRule(window(), request()).detail).toMatch(/not capped/);
    expect(screeningCapRule(window({ maxScreenings: 4, screeningsUsed: 3 }), request()).ok).toBe(true);
    expect(screeningCapRule(window({ maxScreenings: 4, screeningsUsed: 4 }), request()).ok).toBe(false);
  });

  it('counts a run of screenings against the allowance in one go', () => {
    const capped = window({ maxScreenings: 4, screeningsUsed: 2 });

    expect(screeningCapRule(capped, request({ screenings: 2 })).ok).toBe(true);
    expect(screeningCapRule(capped, request({ screenings: 3 })).detail).toMatch(/3 asked for/);
  });

  it('counts what one house has already taken', () => {
    const perVenue = window({ maxScreeningsPerVenue: 2 });

    expect(venueCapRule(perVenue, request({ screeningsAtVenue: 1 })).ok).toBe(true);
    expect(venueCapRule(perVenue, request({ screeningsAtVenue: 2 })).ok).toBe(false);
    expect(venueCapRule(window(), request({ screeningsAtVenue: 99 })).ok).toBe(true);
  });

  it('blacks a date out with the reason it was imposed', () => {
    const blacked = window({
      blackouts: [{ startsOn: '2025-05-13', endsOn: '2025-05-24', reason: 'Cannes' }],
    });

    expect(blackoutRule(blacked, request({ localDate: '2025-05-13' })).detail).toMatch(/for Cannes/);
    expect(blackoutRule(blacked, request({ localDate: '2025-05-24' })).ok).toBe(false);
    expect(blackoutRule(blacked, request({ localDate: '2025-05-25' })).ok).toBe(true);
  });

  it('runs every rule so one refusal names every reason', () => {
    const outcomes = evaluateSelfContained(
      window({ status: 'draft', territory: 'FR', exhibitionTypes: ['festival'] }),
      request(),
    );

    const failed = outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.code);
    expect(failed).toEqual(['status', 'territory', 'exhibition-type']);
    expect(outcomes).toHaveLength(8);
  });

  it('passes everything for a licence that fits', () => {
    const outcomes = evaluateSelfContained(window(), request());

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
  });
});
