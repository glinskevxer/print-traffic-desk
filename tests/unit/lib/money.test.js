'use strict';

const { Money, money, fromDecimalString, ROUNDING } = require('../../../src/lib/money');
const { ValidationError } = require('../../../src/lib/errors');

describe('money', () => {
  it('refuses anything that is not a whole minor unit', () => {
    expect(() => money(12.5, 'GBP')).toThrow(ValidationError);
    expect(() => money(NaN, 'GBP')).toThrow(ValidationError);
  });

  it('refuses a currency the desk does not settle', () => {
    expect(() => money(100, 'XBT')).toThrow(/not settled by this desk/);
    expect(() => money(100, 'gbp')).toThrow(/ISO 4217/);
  });

  it('will not add two currencies together', () => {
    expect(() => money(100, 'GBP').plus(money(100, 'EUR'))).toThrow(/cannot mix GBP and EUR/);
  });

  it('adds and subtracts inside one currency', () => {
    expect(money(1250, 'GBP').plus(money(750, 'GBP')).amountMinor).toBe(2000);
    expect(money(1250, 'GBP').minus(money(1500, 'GBP')).amountMinor).toBe(-250);
  });

  it('takes a percentage as basis points', () => {
    expect(money(10000, 'GBP').timesBasisPoints(3500).amountMinor).toBe(3500);
    expect(money(999, 'GBP').timesBasisPoints(3750).amountMinor).toBe(375);
  });

  it('rounds a share the way the mode says', () => {
    expect(money(101, 'GBP').timesBasisPoints(5000, ROUNDING.HALF_UP).amountMinor).toBe(51);
    expect(money(101, 'GBP').timesBasisPoints(5000, ROUNDING.HALF_EVEN).amountMinor).toBe(50);
    expect(money(101, 'GBP').timesBasisPoints(5000, ROUNDING.DOWN).amountMinor).toBe(50);
    expect(money(101, 'GBP').timesBasisPoints(5000, ROUNDING.UP).amountMinor).toBe(51);
  });

  it('rejects a negative or fractional basis point figure', () => {
    expect(() => money(100, 'GBP').timesBasisPoints(-1)).toThrow(ValidationError);
    expect(() => money(100, 'GBP').timesBasisPoints(12.5)).toThrow(ValidationError);
  });

  it('allocates without losing a penny', () => {
    const parts = money(10000, 'GBP').allocate([1, 1, 1]);

    expect(parts.map((p) => p.amountMinor)).toEqual([3334, 3333, 3333]);
    expect(Money.sum(parts, 'GBP').amountMinor).toBe(10000);
  });

  it('allocates by weight and hands the remainder to the earliest share', () => {
    const parts = money(1001, 'GBP').allocate([70, 30]);

    expect(parts.map((p) => p.amountMinor)).toEqual([701, 300]);
  });

  it('skips zero weighted parties when spreading the remainder', () => {
    const parts = money(100, 'GBP').allocate([0, 1, 1, 1]);

    expect(parts[0].amountMinor).toBe(0);
    expect(Money.sum(parts, 'GBP').amountMinor).toBe(100);
  });

  it('allocates a negative total the same way', () => {
    const parts = money(-100, 'GBP').allocate([1, 1, 1]);

    expect(Money.sum(parts, 'GBP').amountMinor).toBe(-100);
    expect(parts.map((p) => p.amountMinor)).toEqual([-34, -33, -33]);
  });

  it('refuses an allocation that cannot be made', () => {
    expect(() => money(100, 'GBP').allocate([])).toThrow(/at least one weight/);
    expect(() => money(100, 'GBP').allocate([0, 0])).toThrow(/cannot all be zero/);
    expect(() => money(100, 'GBP').allocate([1.5, 1])).toThrow(/non negative integers/);
  });

  it('prints against the currency exponent', () => {
    expect(money(123456, 'GBP').toDecimalString()).toBe('1234.56');
    expect(money(-5, 'GBP').toDecimalString()).toBe('-0.05');
    expect(money(123456, 'JPY').toDecimalString()).toBe('123456');
  });

  it('parses a decimal string only at the currency precision', () => {
    expect(fromDecimalString('1234.56', 'GBP').amountMinor).toBe(123456);
    expect(fromDecimalString('12', 'GBP').amountMinor).toBe(1200);
    expect(fromDecimalString('-0.05', 'GBP').amountMinor).toBe(-5);
    expect(fromDecimalString('4200', 'JPY').amountMinor).toBe(4200);
    expect(() => fromDecimalString('1.234', 'GBP')).toThrow(/GBP has 2 minor digits/);
    expect(() => fromDecimalString('1.5', 'JPY')).toThrow(/JPY has 0 minor digits/);
    expect(() => fromDecimalString('twelve', 'GBP')).toThrow(/not a decimal amount/);
  });

  it('compares, picks the larger and sums a list', () => {
    expect(money(100, 'GBP').compare(money(200, 'GBP'))).toBe(-1);
    expect(Money.max(money(100, 'GBP'), money(200, 'GBP')).amountMinor).toBe(200);
    expect(Money.min(money(100, 'GBP'), money(200, 'GBP')).amountMinor).toBe(100);
    expect(Money.sum([money(100, 'GBP'), money(250, 'GBP')], 'GBP').amountMinor).toBe(350);
    expect(Money.sum([], 'GBP').isZero()).toBe(true);
  });

  it('serialises to a shape mongo can store', () => {
    expect(money(1250, 'GBP').toJSON()).toEqual({ amountMinor: 1250, currency: 'GBP' });
    expect(String(money(1250, 'GBP'))).toBe('12.50 GBP');
  });

  it('is immutable', () => {
    const amount = money(100, 'GBP');
    expect(Object.isFrozen(amount)).toBe(true);
    amount.plus(money(100, 'GBP'));
    expect(amount.amountMinor).toBe(100);
  });
});
