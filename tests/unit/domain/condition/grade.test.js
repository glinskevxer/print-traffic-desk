'use strict';

const {
  worse,
  damageDensity,
  gradeFromDensity,
  readMeasurements,
  assessCondition,
} = require('../../../../src/domain/condition/grade');

const FEATURE_FOOTAGE = 12150;

describe('condition grading', () => {
  it('picks the worse of two grades', () => {
    expect(worse('A', 'C')).toBe('C');
    expect(worse('D', 'B')).toBe('D');
    expect(worse('B', 'B')).toBe('B');
  });

  it('spreads the damage over the print length', () => {
    const findings = [{ code: 'PERF-TEAR', severity: 'moderate' }];

    const short = damageDensity(findings, 1000);
    const long = damageDensity(findings, 12000);

    expect(short).toBeGreaterThan(long);
    expect(short).toBe(36);
  });

  it('refuses to grade against a footage that makes no sense', () => {
    expect(() => damageDensity([], 0)).toThrow(/positive number of feet/);
    expect(() => damageDensity([], -100)).toThrow(/positive number of feet/);
  });

  it('bands a density into a grade', () => {
    expect(gradeFromDensity(0)).toBe('A');
    expect(gradeFromDensity(19.9)).toBe('A');
    expect(gradeFromDensity(20)).toBe('B');
    expect(gradeFromDensity(59.9)).toBe('B');
    expect(gradeFromDensity(60)).toBe('C');
    expect(gradeFromDensity(139.9)).toBe('C');
    expect(gradeFromDensity(140)).toBe('D');
    expect(gradeFromDensity(100000)).toBe('D');
  });

  it('grades a clean print A and calls it projectable', () => {
    const result = assessCondition({ findings: [], footage: FEATURE_FOOTAGE });

    expect(result.grade).toBe('A');
    expect(result.verdict).toBe('projectable');
    expect(result.restrictions).toEqual([]);
  });

  it('lets a moderate perforation tear stay above C', () => {
    const result = assessCondition({
      findings: [{ code: 'PERF-TEAR', severity: 'moderate' }],
      footage: FEATURE_FOOTAGE,
    });

    expect(result.grade).toBe('A');
    expect(result.verdict).toBe('projectable');
  });

  it('caps a severe perforation tear at C however long the print is', () => {
    const result = assessCondition({
      findings: [{ code: 'PERF-TEAR', severity: 'severe' }],
      footage: 60000,
    });

    expect(result.density).toBeLessThan(20);
    expect(result.grade).toBe('C');
    expect(result.restrictions).toContain('no-platter');
    expect(result.reasons).toContain('a severe perforation finding caps this print at C');
  });

  it('does not cap on a severe finding somewhere harmless', () => {
    const result = assessCondition({
      findings: [{ code: 'COLOUR-FADE', severity: 'severe' }],
      footage: FEATURE_FOOTAGE,
    });

    expect(result.grade).toBe('A');
  });

  it('reads shrinkage in bands', () => {
    expect(readMeasurements({ shrinkagePercent: 0.5 }).cap).toBe('A');
    expect(readMeasurements({ shrinkagePercent: 0.7 }).cap).toBe('B');
    expect(readMeasurements({ shrinkagePercent: 1.0 }).cap).toBe('C');
    expect(readMeasurements({ shrinkagePercent: 1.5 }).quarantine).toBe(true);
  });

  it('adds the gate restrictions shrinkage forces', () => {
    const measured = readMeasurements({ shrinkagePercent: 1.2 });

    expect(measured.restrictions).toEqual(['no-platter', 'reduced-speed']);
    expect(measured.reasons[0]).toMatch(/shrinkage gate/);
  });

  it('quarantines an element whose vinegar is active', () => {
    const result = assessCondition({
      findings: [],
      measurements: { adStripLevel: 2 },
      footage: FEATURE_FOOTAGE,
    });

    expect(result.verdict).toBe('quarantine');
    expect(result.quarantineForced).toBe(true);
    expect(result.grade).toBe('D');
  });

  it('keeps an element with early decay in the country', () => {
    const result = assessCondition({
      findings: [],
      measurements: { adStripLevel: 1 },
      footage: FEATURE_FOOTAGE,
    });

    expect(result.grade).toBe('C');
    expect(result.restrictions).toEqual(['no-travel-abroad']);
    expect(result.verdict).toBe('projectable-with-restrictions');
  });

  it('lets a measurement override a spotless finding list', () => {
    const result = assessCondition({
      findings: [],
      measurements: { shrinkagePercent: 1.6 },
      footage: FEATURE_FOOTAGE,
    });

    expect(result.density).toBe(0);
    expect(result.verdict).toBe('quarantine');
  });

  it('takes the worst of every measurement, not the last one read', () => {
    const result = assessCondition({
      findings: [],
      measurements: { shrinkagePercent: 0.8, adStripLevel: 1, warpMillimetres: 1 },
      footage: FEATURE_FOOTAGE,
    });

    expect(result.grade).toBe('C');
    expect(result.restrictions).toEqual(['no-platter', 'no-travel-abroad']);
  });

  it('always sends nitrate to a certified booth', () => {
    const result = assessCondition({ findings: [], footage: FEATURE_FOOTAGE, baseStock: 'nitrate' });

    expect(result.restrictions).toEqual(['nitrate-booth']);
    expect(result.verdict).toBe('projectable-with-restrictions');
    expect(result.grade).toBe('A');
  });

  it('carries restrictions an earlier inspection put on', () => {
    const result = assessCondition({
      findings: [],
      footage: FEATURE_FOOTAGE,
      existingRestrictions: ['archive-projectionist-only'],
    });

    expect(result.restrictions).toEqual(['archive-projectionist-only']);
    expect(result.verdict).toBe('projectable-with-restrictions');
  });

  it('grades a badly worn print D and quarantines it', () => {
    const findings = Array.from({ length: 20 }, () => ({ code: 'PERF-TEAR', severity: 'severe' }));

    const result = assessCondition({ findings, footage: FEATURE_FOOTAGE });

    expect(result.grade).toBe('D');
    expect(result.verdict).toBe('quarantine');
  });

  it('breaks the damage down by area for the report', () => {
    const result = assessCondition({
      findings: [
        { code: 'PERF-WEAR', severity: 'minor' },
        { code: 'SOUND-SCRATCH', severity: 'moderate' },
      ],
      footage: FEATURE_FOOTAGE,
    });

    expect(result.byArea.perforation).toBe(5);
    expect(result.byArea.sound).toBe(18);
    expect(result.byArea.chemical).toBe(0);
  });
});
