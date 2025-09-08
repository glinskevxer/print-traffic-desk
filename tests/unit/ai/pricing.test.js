'use strict';

const { familyOf, rateFor, costOf, isKnownModel, toDollars } = require('../../../src/ai/pricing');

describe('what a call costs', () => {
  it('prices a dated model as its family', () => {
    expect(familyOf('gpt-4o-mini-2024-07-18')).toBe('gpt-4o-mini');
    expect(familyOf('gpt-4o-2024-11-20')).toBe('gpt-4o');
    expect(familyOf('gpt-4o-mini')).toBe('gpt-4o-mini');
  });

  it('prefers the longest matching family so mini is not priced as gpt-4o', () => {
    expect(rateFor('gpt-4o-mini-2024-07-18')).toEqual({ input: 15, output: 60 });
  });

  it('prices an unknown model at the dearest rate rather than at nothing', () => {
    expect(isKnownModel('llama-local')).toBe(false);
    expect(rateFor('llama-local')).toEqual({ input: 250, output: 1000 });
  });

  it('works a call out in hundredths of a cent', () => {
    const cost = costOf({ model: 'gpt-4o-mini', promptTokens: 1000000, completionTokens: 0 });

    expect(cost.inputHundredthCents).toBe(1500);
    expect(cost.totalHundredthCents).toBe(1500);
  });

  it('keeps a small call visible instead of rounding it to zero', () => {
    const cost = costOf({ model: 'gpt-4o-mini', promptTokens: 800, completionTokens: 120 });

    expect(cost.totalHundredthCents).toBeGreaterThan(0);
  });

  it('charges output at the output rate', () => {
    const cost = costOf({ model: 'gpt-4o', promptTokens: 0, completionTokens: 1000000 });

    expect(cost.outputHundredthCents).toBe(100000);
  });

  it('costs nothing for a call that used nothing', () => {
    expect(costOf({ model: 'gpt-4o-mini' }).totalHundredthCents).toBe(0);
  });

  it('prints a running total in dollars', () => {
    expect(toDollars(100000)).toBe('10.0000');
    expect(toDollars(1500)).toBe('0.1500');
    expect(toDollars(7)).toBe('0.0007');
  });
});
