'use strict';

const { computeRoyalty, totalFor } = require('../../../../src/domain/royalties/compute');
const { RuleRefusedError } = require('../../../../src/lib/errors');

const takings = (overrides = {}) => ({
  grossMinor: 184000,
  currency: 'GBP',
  admissions: 210,
  houseNutMinor: 42000,
  ...overrides,
});

describe('working out a royalty', () => {
  it('pays a flat fee whatever the house took', () => {
    const result = computeRoyalty({
      terms: { kind: 'flat', currency: 'GBP', flatFeeMinor: 25000 },
      boxOffice: takings(),
    });

    expect(result.amountMinor).toBe(25000);
    expect(result.venueKeepsMinor).toBe(159000);
    expect(result.basis).toBe('flat 25000 GBP');
  });

  it('takes a percentage of the gross', () => {
    const result = computeRoyalty({
      terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500 },
      boxOffice: takings(),
    });

    expect(result.amountMinor).toBe(64400);
  });

  it('takes a percentage after the nut when the deal says so', () => {
    const result = computeRoyalty({
      terms: {
        kind: 'split-after-nut',
        currency: 'GBP',
        percentageBps: 5000,
        houseNutDeductible: true,
      },
      boxOffice: takings(),
    });

    expect(result.amountMinor).toBe(71000);
  });

  it('never pays a share of a negative base', () => {
    const result = computeRoyalty({
      terms: {
        kind: 'split-after-nut',
        currency: 'GBP',
        percentageBps: 5000,
        houseNutDeductible: true,
      },
      boxOffice: takings({ grossMinor: 10000 }),
    });

    expect(result.amountMinor).toBe(0);
  });

  it('pays the greater of a fee and a share', () => {
    const terms = { kind: 'greater-of', currency: 'GBP', flatFeeMinor: 25000, percentageBps: 3500 };

    expect(computeRoyalty({ terms, boxOffice: takings() }).amountMinor).toBe(64400);
    expect(computeRoyalty({ terms, boxOffice: takings({ grossMinor: 20000 }) }).amountMinor).toBe(
      25000,
    );
  });

  it('lifts a thin night up to the guarantee', () => {
    const result = computeRoyalty({
      terms: {
        kind: 'percentage',
        currency: 'GBP',
        percentageBps: 3500,
        minimumGuaranteeMinor: 30000,
      },
      boxOffice: takings({ grossMinor: 40000 }),
    });

    expect(result.amountMinor).toBe(30000);
    expect(result.workings.map((w) => w.label)).toContain('minimum guarantee applied');
  });

  it('holds a good night down to the cap', () => {
    const result = computeRoyalty({
      terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500, capMinor: 50000 },
      boxOffice: takings(),
    });

    expect(result.amountMinor).toBe(50000);
    expect(result.workings.map((w) => w.label)).toContain('cap applied');
  });

  it('carries a guarantee and a cap on the same deal', () => {
    const terms = {
      kind: 'percentage',
      currency: 'GBP',
      percentageBps: 9000,
      minimumGuaranteeMinor: 30000,
      capMinor: 50000,
    };

    expect(computeRoyalty({ terms, boxOffice: takings() }).amountMinor).toBe(50000);
    expect(computeRoyalty({ terms, boxOffice: takings({ grossMinor: 10000 }) }).amountMinor).toBe(
      30000,
    );
  });

  it('refuses a deal whose guarantee it could never pay under the cap', () => {
    expect(() =>
      computeRoyalty({
        terms: {
          kind: 'percentage',
          currency: 'GBP',
          percentageBps: 1,
          minimumGuaranteeMinor: 30000,
          capMinor: 20000,
        },
        boxOffice: takings(),
      }),
    ).toThrow(/incomplete/);
  });

  it('rounds a share to whole minor units', () => {
    const result = computeRoyalty({
      terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3333 },
      boxOffice: takings({ grossMinor: 101 }),
    });

    expect(result.amountMinor).toBe(34);
  });

  it('shows its working', () => {
    const result = computeRoyalty({
      terms: {
        kind: 'split-after-nut',
        currency: 'GBP',
        percentageBps: 5000,
        houseNutDeductible: true,
      },
      boxOffice: takings(),
    });

    expect(result.workings.map((w) => w.label)).toEqual([
      'box office gross',
      'house nut deducted',
      'shareable base',
      '50% share',
      'payable',
    ]);
  });

  it('flags a fee the night did not cover', () => {
    const result = computeRoyalty({
      terms: { kind: 'flat', currency: 'GBP', flatFeeMinor: 250000 },
      boxOffice: takings(),
    });

    expect(result.exceedsGross).toBe(true);
    expect(result.venueKeepsMinor).toBeLessThan(0);
  });

  it('refuses a box office in another currency', () => {
    expect(() =>
      computeRoyalty({
        terms: { kind: 'flat', currency: 'EUR', flatFeeMinor: 25000 },
        boxOffice: takings(),
      }),
    ).toThrow(/different currencies/);
  });

  it('refuses terms that are not a deal', () => {
    expect(() =>
      computeRoyalty({ terms: { kind: 'percentage', currency: 'GBP' }, boxOffice: takings() }),
    ).toThrow(RuleRefusedError);
  });

  it('adds a run of screenings up', () => {
    const lines = [
      { amountMinor: 25000, currency: 'GBP' },
      { amountMinor: 31000, currency: 'GBP' },
    ];

    expect(totalFor(lines, 'GBP')).toBe(56000);
    expect(totalFor([], 'GBP')).toBe(0);
  });

  it('will not total a statement that mixes currencies', () => {
    expect(() =>
      totalFor(
        [
          { amountMinor: 1, currency: 'GBP' },
          { amountMinor: 1, currency: 'EUR' },
        ],
        'GBP',
      ),
    ).toThrow(/cannot mix currencies/);
  });
});
