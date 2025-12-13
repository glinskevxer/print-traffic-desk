'use strict';

const {
  scoreCandidate,
  rankCandidates,
  bestCandidate,
} = require('../../../../src/domain/elements/selection');

const venue = {
  code: 'GB-LON-PRINCE',
  territory: 'GB',
  booth: {
    gauges: ['35mm'],
    soundFormats: ['optical-mono'],
    speeds: [24],
    changeoverCapable: true,
    nitrateCertified: false,
    projectionistOnStaff: true,
    reelCapacity: 8,
  },
};

const element = (overrides = {}) => ({
  barcode: 'PE-000001',
  gauge: '35mm',
  soundFormat: 'optical-mono',
  projectionSpeed: 24,
  baseStock: 'polyester',
  reelCount: 6,
  kind: 'release-print',
  conditionGrade: 'B',
  screeningsSinceInspection: 0,
  handlingRestrictions: [],
  ...overrides,
});

describe('choosing which print to send', () => {
  it('prefers the better graded print', () => {
    const good = scoreCandidate(element({ conditionGrade: 'A' }), { venue });
    const worn = scoreCandidate(element({ conditionGrade: 'C' }), { venue });

    expect(good).toBeLessThan(worn);
  });

  it('never picks a duplicating element over a print', () => {
    const print = scoreCandidate(element({ kind: 'release-print' }), { venue });
    const negative = scoreCandidate(element({ kind: 'dupe-negative' }), { venue });

    expect(print).toBeLessThan(negative);
  });

  it('prefers a print that is already in the country', () => {
    const home = scoreCandidate(element(), { venue, locationTerritory: 'GB' });
    const abroad = scoreCandidate(element(), { venue, locationTerritory: 'FR' });

    expect(abroad).toBeGreaterThan(home);
  });

  it('prefers a print that is not overdue a look', () => {
    const fresh = scoreCandidate(element({ screeningsSinceInspection: 0 }), { venue });
    const tired = scoreCandidate(element({ screeningsSinceInspection: 9 }), { venue });

    expect(tired).toBeGreaterThan(fresh);
  });

  it('prefers a print with fewer strings attached', () => {
    const plain = scoreCandidate(element(), { venue });
    const restricted = scoreCandidate(
      element({ handlingRestrictions: ['no-platter', 'reduced-speed'] }),
      { venue },
    );

    expect(restricted).toBeGreaterThan(plain);
  });

  it('splits the shelf into what the booth can run and what it cannot', () => {
    const { runnable, rejected } = rankCandidates(
      [element(), element({ barcode: 'PE-000002', gauge: '70mm' })],
      { venue },
    );

    expect(runnable).toHaveLength(1);
    expect(rejected[0].problems[0].rule).toBe('gauge');
  });

  it('orders the runnable prints best first', () => {
    const { runnable } = rankCandidates(
      [
        element({ barcode: 'PE-000003', conditionGrade: 'C' }),
        element({ barcode: 'PE-000004', conditionGrade: 'A' }),
      ],
      { venue },
    );

    expect(runnable.map((each) => each.element.barcode)).toEqual(['PE-000004', 'PE-000003']);
  });

  it('breaks a tie on the barcode so the answer never moves', () => {
    const { runnable } = rankCandidates(
      [element({ barcode: 'PE-000009' }), element({ barcode: 'PE-000002' })],
      { venue },
    );

    expect(runnable[0].element.barcode).toBe('PE-000002');
  });

  it('takes the location of each print into account', () => {
    const { runnable } = rankCandidates(
      [element({ barcode: 'PE-000005' }), element({ barcode: 'PE-000006' })],
      { venue, territoryOf: (each) => (each.barcode === 'PE-000005' ? 'FR' : 'GB') },
    );

    expect(runnable[0].element.barcode).toBe('PE-000006');
  });

  it('has nothing to offer when the booth can run none of them', () => {
    expect(bestCandidate([element({ gauge: '70mm' })], { venue })).toBeNull();
    expect(bestCandidate([], { venue })).toBeNull();
  });

  it('reports which track the booth would actually play', () => {
    const best = bestCandidate([element()], { venue });

    expect(best.playableSound).toBe('optical-mono');
  });
});
