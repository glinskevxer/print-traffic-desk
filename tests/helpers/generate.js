'use strict';

/**
 * A very small generator for the laws that have to hold for every input.
 *
 * A property library would do this better, and the desk does not need better:
 * three laws about money and two about dates, run over a few hundred seeded
 * cases each. The seed is printed on a failure so a broken run is reproducible
 * rather than a story about a machine that once went red.
 */

function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function integer(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function pick(random, values) {
  return values[integer(random, 0, values.length - 1)];
}

/**
 * Runs a law over generated cases. On the first failure it reports the case
 * and the seed, so the test that failed can be written down as an example.
 */
function forAll(name, generator, law, { runs = 200, seed = 20250106 } = {}) {
  const random = seededRandom(seed);

  for (let run = 0; run < runs; run += 1) {
    const value = generator(random);
    try {
      law(value);
    } catch (err) {
      const description = JSON.stringify(value);
      throw new Error(
        `${name} does not hold for ${description} (seed ${seed}, run ${run}): ${err.message}`,
      );
    }
  }
}

const CURRENCIES = ['GBP', 'EUR', 'USD', 'JPY'];

function anyMinorAmount(random) {
  return integer(random, -1000000, 1000000);
}

function anyCurrency(random) {
  return pick(random, CURRENCIES);
}

function anyWeights(random) {
  const length = integer(random, 1, 6);
  return Array.from({ length }, () => integer(random, 0, 100));
}

function anyIsoDate(random) {
  const year = integer(random, 2020, 2030);
  const month = integer(random, 1, 12);
  const day = integer(random, 1, 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

module.exports = {
  seededRandom,
  integer,
  pick,
  forAll,
  anyMinorAmount,
  anyCurrency,
  anyWeights,
  anyIsoDate,
  CURRENCIES,
};
