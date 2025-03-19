'use strict';

const {
  ALL_CODES,
  DAMAGE_CODES,
  SEVERITIES,
  isDamageCode,
  isSeverity,
  describeCode,
  scoreFinding,
  restrictionsForFinding,
  summariseByArea,
} = require('../../../../src/domain/condition/damageCodes');
const { ALL_RESTRICTIONS } = require('../../../../src/domain/handling');

describe('inspection damage codes', () => {
  it('is a closed vocabulary', () => {
    expect(isDamageCode('PERF-TEAR')).toBe(true);
    expect(isDamageCode('looks-bad')).toBe(false);
    expect(isSeverity('moderate')).toBe(true);
    expect(isSeverity('quite-bad')).toBe(false);
    expect(ALL_CODES.length).toBe(Object.keys(DAMAGE_CODES).length);
  });

  it('gives every code an area and a label', () => {
    for (const code of ALL_CODES) {
      const definition = describeCode(code);
      expect(definition.label).toEqual(expect.any(String));
      expect(definition.weight).toBeGreaterThan(0);
    }
    expect(describeCode('nope')).toBeNull();
  });

  it('scores perforation damage above a base scratch', () => {
    const tear = scoreFinding({ code: 'PERF-TEAR', severity: 'moderate' });
    const scratch = scoreFinding({ code: 'SCRATCH-BASE', severity: 'moderate' });

    expect(tear).toBeGreaterThan(scratch * 4);
  });

  it('multiplies the weight by the severity', () => {
    const weight = DAMAGE_CODES['SPLICE-TAPE'].weight;

    expect(scoreFinding({ code: 'SPLICE-TAPE', severity: 'minor' })).toBe(weight);
    expect(scoreFinding({ code: 'SPLICE-TAPE', severity: 'moderate' })).toBe(weight * 3);
    expect(scoreFinding({ code: 'SPLICE-TAPE', severity: 'severe' })).toBe(weight * 9);
  });

  it('refuses to score anything outside the vocabulary', () => {
    expect(() => scoreFinding({ code: 'INVENTED', severity: 'minor' })).toThrow(/not an inspection code/);
    expect(() => scoreFinding({ code: 'PERF-TEAR', severity: 'awful' })).toThrow(/not a severity/);
  });

  it('only a severe finding puts a restriction on the print', () => {
    expect(restrictionsForFinding({ code: 'PERF-TEAR', severity: 'moderate' })).toEqual([]);
    expect(restrictionsForFinding({ code: 'PERF-TEAR', severity: 'severe' })).toContain('no-platter');
  });

  it('has nothing to add for codes that only look bad', () => {
    expect(restrictionsForFinding({ code: 'COLOUR-FADE', severity: 'severe' })).toEqual([]);
    expect(restrictionsForFinding({ code: 'WATER-STAIN', severity: 'severe' })).toEqual([]);
  });

  it('only ever names restrictions the handling vocabulary knows', () => {
    for (const code of ALL_CODES) {
      for (const restriction of restrictionsForFinding({ code, severity: 'severe' })) {
        expect(ALL_RESTRICTIONS).toContain(restriction);
      }
    }
  });

  it('adds the damage up by area', () => {
    const summary = summariseByArea([
      { code: 'PERF-TEAR', severity: 'minor' },
      { code: 'PERF-WEAR', severity: 'minor' },
      { code: 'SCRATCH-BASE', severity: 'moderate' },
    ]);

    expect(summary.perforation).toBe(12 + 5);
    expect(summary.base).toBe(2 * 3);
    expect(summary.sound).toBe(0);
  });

  it('ignores a finding whose code it does not know rather than throwing', () => {
    const summary = summariseByArea([{ code: 'INVENTED', severity: 'minor' }]);

    expect(Object.values(summary).every((total) => total === 0)).toBe(true);
  });

  it('lists the severities worst last', () => {
    expect(SEVERITIES).toEqual(['minor', 'moderate', 'severe']);
  });
});
