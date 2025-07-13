'use strict';

const {
  problemsWith,
  assertTermsComplete,
  describeTerms,
} = require('../../../../src/domain/royalties/terms');
const { RuleRefusedError } = require('../../../../src/lib/errors');

const flat = { kind: 'flat', currency: 'GBP', flatFeeMinor: 25000 };
const percentage = { kind: 'percentage', currency: 'GBP', percentageBps: 3500 };

describe('licence terms', () => {
  it('accepts a complete flat deal', () => {
    expect(problemsWith(flat)).toEqual([]);
    expect(assertTermsComplete(flat)).toBe(flat);
  });

  it('accepts a complete percentage deal', () => {
    expect(problemsWith(percentage)).toEqual([]);
  });

  it('refuses a kind nobody settles', () => {
    expect(problemsWith({ kind: 'handshake', currency: 'GBP' })).toEqual([
      'handshake is not a kind of deal this desk settles',
    ]);
  });

  it('refuses a currency the desk cannot settle', () => {
    expect(() => problemsWith({ ...flat, currency: 'XBT' })).toThrow(/not settled by this desk/);
  });

  it('needs a fee where the deal names one', () => {
    expect(problemsWith({ kind: 'flat', currency: 'GBP' })).toEqual(['a flat fee is needed']);
  });

  it('needs a rate where the deal names one', () => {
    expect(problemsWith({ kind: 'percentage', currency: 'GBP' })).toEqual([
      'a percentage in basis points is needed',
    ]);
  });

  it('needs both for a greater of deal', () => {
    expect(problemsWith({ kind: 'greater-of', currency: 'GBP' })).toEqual([
      'a flat fee is needed',
      'a percentage in basis points is needed',
    ]);
  });

  it('will not split after a nut it does not deduct', () => {
    expect(
      problemsWith({ kind: 'split-after-nut', currency: 'GBP', percentageBps: 5000 }),
    ).toEqual(['a split after the nut has to deduct the nut']);
  });

  it('will not let a flat deal carry a rate as well', () => {
    expect(problemsWith({ ...flat, percentageBps: 1000 })).toEqual([
      'a flat deal cannot also carry a percentage',
    ]);
  });

  it('spots a cap that is already below the fee', () => {
    expect(problemsWith({ ...flat, capMinor: 10000 })).toEqual([
      'the flat fee is already above the cap',
    ]);
  });

  it('spots a guarantee above the cap', () => {
    expect(
      problemsWith({ ...percentage, minimumGuaranteeMinor: 50000, capMinor: 20000 }),
    ).toEqual(['the minimum guarantee is above the cap']);
  });

  it('takes a zero fee as a real fee', () => {
    expect(problemsWith({ kind: 'flat', currency: 'GBP', flatFeeMinor: 0 })).toEqual([]);
  });

  it('throws with every problem listed', () => {
    let caught;
    try {
      assertTermsComplete({ kind: 'greater-of', currency: 'GBP' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RuleRefusedError);
    expect(caught.details.problems).toHaveLength(2);
  });

  it('says a flat deal in one line', () => {
    expect(describeTerms(flat)).toBe('flat 25000 GBP');
  });

  it('says a percentage deal in one line', () => {
    expect(describeTerms(percentage)).toBe('35% of the gross');
  });

  it('says a greater of deal in one line', () => {
    expect(describeTerms({ kind: 'greater-of', currency: 'GBP', flatFeeMinor: 25000, percentageBps: 3500 })).toBe(
      'the greater of 25000 GBP and 35%',
    );
  });

  it('mentions the nut, the guarantee and the cap', () => {
    const described = describeTerms({
      ...percentage,
      houseNutDeductible: true,
      minimumGuaranteeMinor: 15000,
      capMinor: 90000,
    });

    expect(described).toBe('35% of the gross, after the nut, minimum 15000 GBP, capped at 90000 GBP');
  });

  it('does not say after the nut twice for a split deal', () => {
    const described = describeTerms({
      kind: 'split-after-nut',
      currency: 'GBP',
      percentageBps: 5000,
      houseNutDeductible: true,
    });

    expect(described).toBe('50% of the gross after the house nut');
  });
});
