'use strict';

const { ValidationError } = require('../../lib/errors');

/**
 * Licences are written for territories, and a territory is not always a
 * country. A pan European deal and a Nordic deal both exist, they overlap, and
 * the desk has to be able to say whether a screening in Malmö is inside either.
 */

const EU = Object.freeze([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE',
  'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

const EEA = Object.freeze([...EU, 'IS', 'LI', 'NO']);
const NORDIC = Object.freeze(['DK', 'FI', 'IS', 'NO', 'SE']);
const DACH = Object.freeze(['AT', 'CH', 'DE']);
const BENELUX = Object.freeze(['BE', 'LU', 'NL']);
const IBERIA = Object.freeze(['ES', 'PT']);
const UK_IRELAND = Object.freeze(['GB', 'IE']);

const REGIONS = Object.freeze({
  WORLD: null,
  EU,
  EEA,
  NORDIC,
  DACH,
  BENELUX,
  IBERIA,
  'UK-IE': UK_IRELAND,
});

const REGION_CODES = Object.freeze(Object.keys(REGIONS));

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

function isRegion(code) {
  return REGION_CODES.includes(code);
}

function isCountry(code) {
  return typeof code === 'string' && COUNTRY_PATTERN.test(code) && !isRegion(code);
}

function isTerritory(code) {
  return isRegion(code) || isCountry(code);
}

function assertTerritory(code, key = 'territory') {
  if (!isTerritory(code)) {
    throw new ValidationError(`${code} is not a territory this desk licences`, [
      { key, problem: 'expected an ISO 3166-1 alpha-2 code or a named region' },
    ]);
  }
  return code;
}

/** The countries a licence territory reaches. WORLD is left open on purpose. */
function expand(code) {
  assertTerritory(code);
  if (code === 'WORLD') return null;
  if (isRegion(code)) return REGIONS[code];
  return [code];
}

/** Does a licence written for `licensed` reach a screening in `country`? */
function covers(licensed, country) {
  assertTerritory(licensed, 'licensedTerritory');
  if (!isCountry(country)) {
    throw new ValidationError(`${country} is not a country`, [
      { key: 'country', problem: 'expected an ISO 3166-1 alpha-2 code' },
    ]);
  }
  if (licensed === 'WORLD') return true;
  return expand(licensed).includes(country);
}

/** Two licence territories that share any country can conflict on exclusivity. */
function overlap(first, second) {
  assertTerritory(first, 'first');
  assertTerritory(second, 'second');
  if (first === 'WORLD' || second === 'WORLD') return true;

  const left = expand(first);
  const right = new Set(expand(second));
  return left.some((country) => right.has(country));
}

/** How narrow a territory is, so the tightest licence can be preferred. */
function breadth(code) {
  const expanded = expand(code);
  return expanded === null ? Number.MAX_SAFE_INTEGER : expanded.length;
}

/**
 * Sorts candidate windows so the most specific licence is used first. A venue
 * covered by both a national and a pan European deal is booked under the
 * national one, because that is the one the local office is paid on.
 */
function narrowestFirst(territories) {
  return [...territories].sort((a, b) => breadth(a) - breadth(b) || a.localeCompare(b));
}

module.exports = {
  REGIONS,
  REGION_CODES,
  EU,
  EEA,
  NORDIC,
  isRegion,
  isCountry,
  isTerritory,
  assertTerritory,
  expand,
  covers,
  overlap,
  breadth,
  narrowestFirst,
};
