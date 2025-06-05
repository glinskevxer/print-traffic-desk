'use strict';

const {
  boothCompatibility,
  venuesThatCanRun,
  elementsRunnableAt,
  restrictionChecks,
} = require('../../../../src/domain/elements/compatibility');

const element = (overrides = {}) => ({
  gauge: '35mm',
  soundFormat: 'optical-mono',
  projectionSpeed: 24,
  baseStock: 'polyester',
  reelCount: 6,
  handlingRestrictions: [],
  ...overrides,
});

const venue = (booth = {}) => ({
  code: 'GB-LON-PRINCE',
  booth: {
    gauges: ['35mm'],
    soundFormats: ['optical-mono', 'dolby-a'],
    speeds: [24],
    changeoverCapable: true,
    platterEquipped: false,
    nitrateCertified: false,
    projectionistOnStaff: true,
    reelCapacity: 8,
    ...booth,
  },
});

describe('booth compatibility', () => {
  it('says yes when the booth has the kit', () => {
    const result = boothCompatibility(element(), venue());

    expect(result.compatible).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.playableSound).toBe('optical-mono');
  });

  it('names the gauge a booth cannot run', () => {
    const result = boothCompatibility(element({ gauge: '70mm' }), venue());

    expect(result.problems[0]).toEqual({
      rule: 'gauge',
      detail: 'GB-LON-PRINCE does not run 70mm',
    });
  });

  it('falls a track back rather than refusing it', () => {
    const result = boothCompatibility(element({ soundFormat: 'dolby-digital' }), venue());

    expect(result.compatible).toBe(true);
    expect(result.playableSound).toBe('dolby-a');
  });

  it('refuses a track with nothing to fall back to', () => {
    const result = boothCompatibility(element({ soundFormat: 'magnetic-6track' }), venue());

    expect(result.problems.map((p) => p.rule)).toEqual(['sound']);
  });

  it('refuses a speed the booth cannot hold', () => {
    const result = boothCompatibility(element({ projectionSpeed: 18 }), venue());

    expect(result.problems[0].detail).toMatch(/18 frames a second/);
  });

  it('refuses nitrate in an uncertified booth', () => {
    const result = boothCompatibility(element({ baseStock: 'nitrate' }), venue());

    expect(result.problems.map((p) => p.rule)).toEqual(['nitrate']);
  });

  it('accepts nitrate in a certified booth', () => {
    const result = boothCompatibility(
      element({ baseStock: 'nitrate' }),
      venue({ nitrateCertified: true }),
    );

    expect(result.compatible).toBe(true);
  });

  it('refuses more reels than the booth holds', () => {
    const result = boothCompatibility(element({ reelCount: 12 }), venue());

    expect(result.problems[0].detail).toMatch(/past the 8 this booth holds/);
  });

  it('collects every problem rather than the first', () => {
    const result = boothCompatibility(
      element({ gauge: '70mm', reelCount: 20, soundFormat: 'magnetic-4track' }),
      venue(),
    );

    expect(result.problems.map((p) => p.rule).sort()).toEqual(['gauge', 'reels', 'sound']);
  });

  it('explains what a changeover only print demands', () => {
    const problems = restrictionChecks(
      element({ handlingRestrictions: ['changeover-only'] }),
      venue({ changeoverCapable: false }),
    );

    expect(problems[0].detail).toMatch(/two projectors in changeover/);
  });

  it('refuses an archive print at a house with nobody in the booth', () => {
    const problems = restrictionChecks(
      element({ handlingRestrictions: ['archive-projectionist-only'] }),
      venue({ projectionistOnStaff: false }),
    );

    expect(problems.map((p) => p.rule)).toEqual(['projectionist']);
  });

  it('never lets a study only element on to a screen', () => {
    const result = boothCompatibility(
      element({ handlingRestrictions: ['no-public-exhibition'] }),
      venue(),
    );

    expect(result.compatible).toBe(false);
    expect(result.problems[0].rule).toBe('exhibition');
  });

  it('narrows a list of houses to the ones that could run it', () => {
    const houses = [venue(), venue({ gauges: ['16mm'] })];

    expect(venuesThatCanRun(element(), houses)).toHaveLength(1);
  });

  it('narrows a shelf to what one booth could run', () => {
    const shelf = [element(), element({ gauge: '70mm' }), element({ reelCount: 30 })];

    expect(elementsRunnableAt(shelf, venue())).toHaveLength(1);
  });
});
