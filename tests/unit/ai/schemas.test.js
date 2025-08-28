'use strict';

const {
  licenceTermsSchema,
  inspectionNotesSchema,
  EXTRACTION_KINDS,
  schemaFor,
} = require('../../../src/ai/schemas');

const licence = (overrides = {}) => ({
  territory: 'GB',
  exhibitionTypes: ['repertory'],
  startsOn: '2025-01-01',
  endsOn: '2025-12-31',
  terms: { kind: 'flat', currency: 'GBP', flatFeeMinor: 25000 },
  confidence: 0.9,
  ...overrides,
});

describe('what the model is allowed to have said', () => {
  it('knows the two kinds of extraction', () => {
    expect(EXTRACTION_KINDS).toEqual(['licence-terms', 'inspection-notes']);
    expect(schemaFor('licence-terms')).toBe(licenceTermsSchema);
    expect(() => schemaFor('screenplay')).toThrow(/not something this desk extracts/);
  });

  it('fills in the parts a contract did not mention', () => {
    const parsed = licenceTermsSchema.parse(licence());

    expect(parsed.holdbackUntil).toBeNull();
    expect(parsed.maxScreenings).toBeNull();
    expect(parsed.exclusivity).toEqual({ scope: 'none', heldByVenueCode: null });
    expect(parsed.blackouts).toEqual([]);
    expect(parsed.unclear).toEqual([]);
  });

  it('takes a named region as a territory', () => {
    expect(licenceTermsSchema.parse(licence({ territory: 'NORDIC' })).territory).toBe('NORDIC');
  });

  it('refuses a territory the desk does not licence', () => {
    expect(licenceTermsSchema.safeParse(licence({ territory: 'Scandinavia' })).success).toBe(false);
    expect(licenceTermsSchema.safeParse(licence({ territory: 'gb' })).success).toBe(false);
  });

  it('refuses a kind of exhibition nobody sells', () => {
    expect(
      licenceTermsSchema.safeParse(licence({ exhibitionTypes: ['streaming'] })).success,
    ).toBe(false);
  });

  it('refuses a licence that ends before it starts', () => {
    const result = licenceTermsSchema.safeParse(
      licence({ startsOn: '2025-06-01', endsOn: '2025-01-01' }),
    );

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['endsOn']);
  });

  it('refuses an exclusive with nobody named', () => {
    const result = licenceTermsSchema.safeParse(
      licence({ exclusivity: { scope: 'city', heldByVenueCode: null } }),
    );

    expect(result.success).toBe(false);
  });

  it('refuses a percentage outside the basis point range', () => {
    expect(
      licenceTermsSchema.safeParse(
        licence({ terms: { kind: 'percentage', currency: 'GBP', percentageBps: 20000 } }),
      ).success,
    ).toBe(false);
  });

  it('refuses money that is not whole minor units', () => {
    expect(
      licenceTermsSchema.safeParse(
        licence({ terms: { kind: 'flat', currency: 'GBP', flatFeeMinor: 250.5 } }),
      ).success,
    ).toBe(false);
  });

  it('keeps what the model could not read', () => {
    const parsed = licenceTermsSchema.parse(
      licence({ unclear: [{ field: 'maxScreenings', why: 'the clause says a reasonable number' }] }),
    );

    expect(parsed.unclear).toHaveLength(1);
  });

  it('takes a full inspection note', () => {
    const parsed = inspectionNotesSchema.parse({
      findings: [{ reel: 2, code: 'PERF-TEAR', severity: 'severe', footageMark: 340 }],
      measurements: { shrinkagePercent: 0.8, adStripLevel: 1 },
      confidence: 0.8,
    });

    expect(parsed.findings[0].note).toBeNull();
    expect(parsed.measurements.warpMillimetres).toBeNull();
  });

  it('refuses a damage code the inspectors do not use', () => {
    expect(
      inspectionNotesSchema.safeParse({
        findings: [{ reel: 1, code: 'LOOKS-ROUGH', severity: 'minor' }],
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it('refuses a severity that is not one of the three', () => {
    expect(
      inspectionNotesSchema.safeParse({
        findings: [{ reel: 1, code: 'PERF-TEAR', severity: 'quite bad' }],
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it('refuses a reel number off the end of the print', () => {
    expect(
      inspectionNotesSchema.safeParse({
        findings: [{ reel: 99, code: 'PERF-TEAR', severity: 'minor' }],
        confidence: 0.9,
      }).success,
    ).toBe(false);
  });

  it('insists on a confidence figure', () => {
    expect(inspectionNotesSchema.safeParse({ findings: [] }).success).toBe(false);
    expect(inspectionNotesSchema.safeParse({ findings: [], confidence: 1.4 }).success).toBe(false);
  });

  it('takes an empty note as an empty note', () => {
    const parsed = inspectionNotesSchema.parse({ confidence: 0.99 });

    expect(parsed.findings).toEqual([]);
  });
});
