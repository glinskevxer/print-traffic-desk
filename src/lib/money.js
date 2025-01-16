'use strict';

const { ValidationError } = require('./errors');

/**
 * Everything financial on the desk is an integer in the currency's minor unit.
 * Royalties are split between a distributor and an exhibitor and the two sides
 * reconcile by hand, so a floating point penny is a phone call.
 */

const EXPONENTS = Object.freeze({
  GBP: 2,
  EUR: 2,
  USD: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  CZK: 2,
  JPY: 0,
  KRW: 0,
  ISK: 0,
});

const ROUNDING = Object.freeze({
  HALF_UP: 'half-up',
  HALF_EVEN: 'half-even',
  DOWN: 'down',
  UP: 'up',
});

function exponentFor(currency) {
  const exponent = EXPONENTS[currency];
  if (exponent === undefined) {
    throw new ValidationError(`currency ${currency} is not settled by this desk`, [
      { key: 'currency', problem: 'unknown ISO 4217 code' },
    ]);
  }
  return exponent;
}

function assertSameCurrency(a, b) {
  if (a.currency !== b.currency) {
    throw new ValidationError(`cannot mix ${a.currency} and ${b.currency} in one sum`, [
      { key: 'currency', problem: 'mismatched currencies' },
    ]);
  }
}

function roundQuotient(numerator, denominator, mode) {
  const negative = numerator < 0 !== denominator < 0;
  const absNumerator = Math.abs(numerator);
  const absDenominator = Math.abs(denominator);
  const whole = Math.floor(absNumerator / absDenominator);
  const remainder = absNumerator % absDenominator;
  const twice = remainder * 2;

  let magnitude = whole;
  if (mode === ROUNDING.UP) {
    magnitude = remainder > 0 ? whole + 1 : whole;
  } else if (mode === ROUNDING.DOWN) {
    magnitude = whole;
  } else if (mode === ROUNDING.HALF_EVEN) {
    if (twice > absDenominator || (twice === absDenominator && whole % 2 === 1)) magnitude = whole + 1;
  } else {
    if (twice >= absDenominator) magnitude = whole + 1;
  }
  return negative ? -magnitude : magnitude;
}

class Money {
  constructor(amountMinor, currency) {
    if (!Number.isSafeInteger(amountMinor)) {
      throw new ValidationError('a money amount must be a whole number of minor units', [
        { key: 'amountMinor', problem: 'not a safe integer' },
      ]);
    }
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError('a money amount must carry an ISO 4217 currency', [
        { key: 'currency', problem: 'not three upper case letters' },
      ]);
    }
    exponentFor(currency);
    this.amountMinor = amountMinor;
    this.currency = currency;
    Object.freeze(this);
  }

  static zero(currency) {
    return new Money(0, currency);
  }

  plus(other) {
    assertSameCurrency(this, other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  minus(other) {
    assertSameCurrency(this, other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  /** Percentages arrive as basis points so a 37.5% split stays exact. */
  timesBasisPoints(bps, mode = ROUNDING.HALF_UP) {
    if (!Number.isInteger(bps) || bps < 0) {
      throw new ValidationError('basis points must be a whole number of hundredths of a percent', [
        { key: 'bps', problem: 'not a non negative integer' },
      ]);
    }
    return new Money(roundQuotient(this.amountMinor * bps, 10000, mode), this.currency);
  }

  /**
   * Splits into weighted parts with no minor unit lost. The remainder goes to
   * the earliest parts, which is the convention every distributor statement in
   * the archive uses.
   */
  allocate(weights) {
    if (!Array.isArray(weights) || weights.length === 0) {
      throw new ValidationError('allocation needs at least one weight', [
        { key: 'weights', problem: 'empty' },
      ]);
    }
    if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
      throw new ValidationError('allocation weights must be non negative integers', [
        { key: 'weights', problem: 'not integers' },
      ]);
    }
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total === 0) {
      throw new ValidationError('allocation weights cannot all be zero', [
        { key: 'weights', problem: 'sum to zero' },
      ]);
    }

    const parts = weights.map((w) => Math.trunc((this.amountMinor * w) / total));
    let remainder = this.amountMinor - parts.reduce((sum, p) => sum + p, 0);
    const step = remainder < 0 ? -1 : 1;
    for (let i = 0; remainder !== 0; i = (i + 1) % parts.length) {
      if (weights[i] === 0) continue;
      parts[i] += step;
      remainder -= step;
    }
    return parts.map((p) => new Money(p, this.currency));
  }

  isZero() {
    return this.amountMinor === 0;
  }

  isNegative() {
    return this.amountMinor < 0;
  }

  compare(other) {
    assertSameCurrency(this, other);
    return Math.sign(this.amountMinor - other.amountMinor);
  }

  static max(a, b) {
    return a.compare(b) >= 0 ? a : b;
  }

  static min(a, b) {
    return a.compare(b) <= 0 ? a : b;
  }

  static sum(amounts, currency) {
    return amounts.reduce((total, item) => total.plus(item), Money.zero(currency));
  }

  /** Plain decimal string with no symbol, which is what statements print. */
  toDecimalString() {
    const exponent = exponentFor(this.currency);
    if (exponent === 0) return String(this.amountMinor);
    const sign = this.amountMinor < 0 ? '-' : '';
    const digits = String(Math.abs(this.amountMinor)).padStart(exponent + 1, '0');
    return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
  }

  toJSON() {
    return { amountMinor: this.amountMinor, currency: this.currency };
  }

  toString() {
    return `${this.toDecimalString()} ${this.currency}`;
  }
}

function money(amountMinor, currency) {
  return new Money(amountMinor, currency);
}

/** Parses "1234.56" against the currency exponent, refusing extra precision. */
function fromDecimalString(text, currency) {
  const exponent = exponentFor(currency);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(text).trim());
  if (!match) {
    throw new ValidationError(`"${text}" is not a decimal amount`, [
      { key: 'amount', problem: 'unparseable' },
    ]);
  }
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > exponent) {
    throw new ValidationError(`${currency} has ${exponent} minor digits, got ${fraction.length}`, [
      { key: 'amount', problem: 'too much precision' },
    ]);
  }
  const padded = fraction.padEnd(exponent, '0');
  return new Money(Number(`${sign}${whole}${padded}`), currency);
}

module.exports = { Money, money, fromDecimalString, EXPONENTS, ROUNDING, exponentFor };
