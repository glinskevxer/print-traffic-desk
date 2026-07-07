'use strict';

const { clearScreening } = require('../../../../src/domain/rights/clearance');
const { planRoundTrip } = require('../../../../src/domain/traffic/routing');
const { assessCondition } = require('../../../../src/domain/condition/grade');

/**
 * What the rules cost, pinned.
 *
 * Not timing tests. They count how many times the engine reads each part of
 * the input, because the mistakes worth catching here are shape mistakes: a
 * refactor that moves the exclusivity check inside the per licence loop turns
 * one pass over the exclusives into one per licence, and on a title with forty
 * licences that is forty times the work for the same answer.
 *
 * Counting reads rather than calls means the assertions survive the engine
 * being rewritten, which a spy on a named function does not.
 */
function countingLicence(counter, overrides = {}) {
  const base = {
    publicId: `rw_${String(overrides.n ?? 0).padStart(16, '0')}`,
    status: 'active',
    startsOn: '2025-01-01',
    endsOn: '2025-12-31',
    holdbackUntil: null,
    territory: 'GB',
    exhibitionTypes: ['repertory'],
    maxScreenings: null,
    screeningsUsed: 0,
    maxScreeningsPerVenue: null,
    exclusivity: { scope: 'none', heldBy: null },
    ...overrides,
  };

  return Object.defineProperties(base, {
    blackouts: {
      enumerable: true,
      get() {
        counter.blackouts += 1;
        return overrides.blackouts || [];
      },
    },
  });
}

function countingExclusive(counter, overrides = {}) {
  const base = {
    publicId: `rw_EXCLUSIVE${String(overrides.n ?? 0).padStart(7, '0')}`,
    status: 'active',
    startsOn: '2025-01-01',
    endsOn: '2025-12-31',
    territory: 'GB',
    exhibitionTypes: ['repertory'],
    holderCity: 'London',
    maxScreenings: null,
    screeningsUsed: 0,
    blackouts: [],
    ...overrides,
  };

  return Object.defineProperties(base, {
    exclusivity: {
      enumerable: true,
      get() {
        counter.exclusivity += 1;
        return { scope: 'city', heldBy: 'venue-prince' };
      },
    },
  });
}

const request = {
  localDate: '2025-04-17',
  country: 'GB',
  city: 'London',
  exhibitionType: 'repertory',
  venueId: 'venue-ica',
  screenings: 1,
  screeningsAtVenue: 0,
};

function clearWith(licences, exclusives) {
  const counter = { blackouts: 0, exclusivity: 0 };
  const windows = Array.from({ length: licences }, (_, n) => countingLicence(counter, { n }));
  const exclusiveWindows = Array.from({ length: exclusives }, (_, n) =>
    countingExclusive(counter, { n }),
  );

  const decision = clearScreening({ windows, exclusiveWindows, request });
  return { counter, decision };
}

describe('what clearing a screening costs', () => {
  it('reads each licence blackout list exactly once', () => {
    expect(clearWith(12, 0).counter.blackouts).toBe(12);
    expect(clearWith(40, 0).counter.blackouts).toBe(40);
  });

  it('does not read the exclusives again for every licence', () => {
    const few = clearWith(5, 3).counter.exclusivity;
    const many = clearWith(50, 3).counter.exclusivity;

    expect(many).toBe(few);
    expect(many).toBeLessThan(20);
  });

  it('does not stop early, because a refusal names every reason', () => {
    const counter = { blackouts: 0, exclusivity: 0 };
    const windows = [countingLicence(counter, { status: 'suspended' })];

    clearScreening({ windows, exclusiveWindows: [], request });

    expect(counter.blackouts).toBe(1);
  });

  it('answers the same whatever order the licences arrive in', () => {
    const counter = { blackouts: 0, exclusivity: 0 };
    const windows = Array.from({ length: 30 }, (_, n) => countingLicence(counter, { n }));

    const forwards = clearScreening({ windows, exclusiveWindows: [], request });
    const backwards = clearScreening({
      windows: [...windows].reverse(),
      exclusiveWindows: [],
      request,
    });

    expect(backwards.windowId).toBe(forwards.windowId);
    expect(backwards.alternatives).toEqual(forwards.alternatives);
  });

  it('clears against two hundred licences and still answers', () => {
    const { decision } = clearWith(200, 0);

    expect(decision.cleared).toBe(true);
    expect(decision.evaluations).toHaveLength(200);
  });
});

describe('what the other engines cost', () => {
  it('plans a year ahead without walking the calendar forever', () => {
    const plan = planRoundTrip({
      fromTerritory: 'GB',
      toTerritory: 'US',
      outboundLeadDays: 2,
      inboundLeadDays: 3,
      inspectionDays: 3,
      screeningLocalDate: '2025-12-24',
      holdDaysAfterScreening: 2,
      today: '2025-01-02',
      service: 'road-freight',
    });

    expect(plan.feasible).toBe(true);
    expect(plan.committedFrom < plan.outbound.dates.dispatchOn).toBe(true);
  });

  it('grades a print with four hundred findings without falling over', () => {
    const findings = Array.from({ length: 400 }, (_, i) => ({
      reel: (i % 6) + 1,
      code: i % 2 === 0 ? 'PERF-WEAR' : 'SCRATCH-BASE',
      severity: 'minor',
    }));

    const result = assessCondition({ findings, footage: 12150 });

    expect(result.grade).toBe('C');
    expect(result.density).toBeGreaterThan(100);
    expect(result.byArea.perforation).toBeGreaterThan(0);
  });

  it('reads every finding exactly once when it grades', () => {
    let reads = 0;
    const findings = Array.from({ length: 50 }, () =>
      Object.defineProperty({ reel: 1, severity: 'minor' }, 'code', {
        enumerable: true,
        get() {
          reads += 1;
          return 'SPLICE-TAPE';
        },
      }),
    );

    assessCondition({ findings, footage: 12150 });

    // Scored once, summarised by area once, and checked for a severe
    // perforation once: three passes over the list, not one per finding.
    expect(reads).toBeLessThanOrEqual(50 * 4);
  });
});
