'use strict';

const {
  forAll,
  integer,
  pick,
  anyMinorAmount,
  anyCurrency,
  anyWeights,
  anyIsoDate,
} = require('../../helpers/generate');
const { Money, money, fromDecimalString } = require('../../../src/lib/money');
const {
  addDays,
  daysBetween,
  isWithin,
  rangesOverlap,
  eachDate,
} = require('../../../src/lib/dates');
const { covers, overlap, expand } = require('../../../src/domain/rights/territories');

describe('the laws money has to obey', () => {
  it('never loses or invents a minor unit when it is split', () => {
    forAll(
      'allocation is exact',
      (random) => ({
        amount: anyMinorAmount(random),
        currency: anyCurrency(random),
        weights: anyWeights(random),
      }),
      ({ amount, currency, weights }) => {
        if (weights.every((weight) => weight === 0)) return;
        const parts = money(amount, currency).allocate(weights);

        expect(Money.sum(parts, currency).amountMinor).toBe(amount);
        expect(parts).toHaveLength(weights.length);
      },
    );
  });

  it('gives nothing to a party with no weight', () => {
    forAll(
      'zero weight gets zero',
      (random) => ({
        amount: integer(random, 0, 1000000),
        currency: anyCurrency(random),
        weights: [0, ...anyWeights(random).map((weight) => weight + 1)],
      }),
      ({ amount, currency, weights }) => {
        const parts = money(amount, currency).allocate(weights);

        expect(parts[0].amountMinor).toBe(0);
      },
    );
  });

  it('takes a share that never exceeds the whole', () => {
    forAll(
      'a share is at most the whole',
      (random) => ({
        amount: integer(random, 0, 10000000),
        currency: anyCurrency(random),
        bps: integer(random, 0, 10000),
      }),
      ({ amount, currency, bps }) => {
        const share = money(amount, currency).timesBasisPoints(bps);

        expect(share.amountMinor).toBeLessThanOrEqual(amount);
        expect(share.amountMinor).toBeGreaterThanOrEqual(0);
      },
    );
  });

  it('round trips through the decimal string a statement prints', () => {
    forAll(
      'printing then parsing is the same amount',
      (random) => ({ amount: anyMinorAmount(random), currency: anyCurrency(random) }),
      ({ amount, currency }) => {
        const printed = money(amount, currency).toDecimalString();

        expect(fromDecimalString(printed, currency).amountMinor).toBe(amount);
      },
    );
  });

  it('adds and subtracts back to where it started', () => {
    forAll(
      'plus then minus is identity',
      (random) => ({
        amount: anyMinorAmount(random),
        other: anyMinorAmount(random),
        currency: anyCurrency(random),
      }),
      ({ amount, other, currency }) => {
        const start = money(amount, currency);
        const there = start.plus(money(other, currency));

        expect(there.minus(money(other, currency)).amountMinor).toBe(amount);
      },
    );
  });
});

describe('the laws dates have to obey', () => {
  it('walks forward and back to the same day', () => {
    forAll(
      'adding then subtracting days is identity',
      (random) => ({ date: anyIsoDate(random), days: integer(random, -400, 400) }),
      ({ date, days }) => {
        expect(addDays(addDays(date, days), -days)).toBe(date);
      },
    );
  });

  it('measures the distance it just walked', () => {
    forAll(
      'daysBetween undoes addDays',
      (random) => ({ date: anyIsoDate(random), days: integer(random, -400, 400) }),
      ({ date, days }) => {
        expect(daysBetween(date, addDays(date, days))).toBe(days);
      },
    );
  });

  it('holds a date inside the window that contains it', () => {
    forAll(
      'a date inside a window is within it',
      (random) => {
        const startsOn = anyIsoDate(random);
        const length = integer(random, 0, 300);
        return { startsOn, endsOn: addDays(startsOn, length), offset: integer(random, 0, length) };
      },
      ({ startsOn, endsOn, offset }) => {
        expect(isWithin(addDays(startsOn, offset), startsOn, endsOn)).toBe(true);
        expect(isWithin(addDays(endsOn, 1), startsOn, endsOn)).toBe(false);
      },
    );
  });

  it('lists exactly as many dates as it measured', () => {
    forAll(
      'eachDate has the length daysBetween says',
      (random) => {
        const startsOn = anyIsoDate(random);
        return { startsOn, endsOn: addDays(startsOn, integer(random, 0, 120)) };
      },
      ({ startsOn, endsOn }) => {
        expect(eachDate(startsOn, endsOn)).toHaveLength(daysBetween(startsOn, endsOn) + 1);
      },
    );
  });

  it('overlaps in both directions or neither', () => {
    forAll(
      'overlap is symmetric',
      (random) => {
        const first = anyIsoDate(random);
        const second = anyIsoDate(random);
        return {
          a: { startsOn: first, endsOn: addDays(first, integer(random, 0, 100)) },
          b: { startsOn: second, endsOn: addDays(second, integer(random, 0, 100)) },
        };
      },
      ({ a, b }) => {
        expect(rangesOverlap(a, b)).toBe(rangesOverlap(b, a));
      },
    );
  });
});

describe('the laws territories have to obey', () => {
  const REGIONS = ['WORLD', 'EU', 'EEA', 'NORDIC', 'DACH', 'BENELUX', 'IBERIA', 'UK-IE'];
  const COUNTRIES = ['GB', 'IE', 'FR', 'DE', 'SE', 'ES', 'JP', 'US'];

  it('covers exactly the countries it expands to', () => {
    forAll(
      'covers agrees with expand',
      (random) => ({ licensed: pick(random, REGIONS), country: pick(random, COUNTRIES) }),
      ({ licensed, country }) => {
        const expanded = expand(licensed);
        const expected = expanded === null || expanded.includes(country);

        expect(covers(licensed, country)).toBe(expected);
      },
    );
  });

  it('overlaps with itself and overlaps symmetrically', () => {
    forAll(
      'overlap is reflexive and symmetric',
      (random) => ({
        first: pick(random, [...REGIONS, ...COUNTRIES]),
        second: pick(random, [...REGIONS, ...COUNTRIES]),
      }),
      ({ first, second }) => {
        expect(overlap(first, first)).toBe(true);
        expect(overlap(first, second)).toBe(overlap(second, first));
      },
    );
  });

  it('is covered by anything that contains it', () => {
    forAll(
      'a country inside a region is covered by it',
      (random) => ({
        region: pick(
          random,
          REGIONS.filter((code) => code !== 'WORLD'),
        ),
      }),
      ({ region }) => {
        for (const country of expand(region)) {
          expect(covers(region, country)).toBe(true);
          expect(covers('WORLD', country)).toBe(true);
        }
      },
    );
  });
});
