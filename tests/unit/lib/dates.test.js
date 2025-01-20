'use strict';

const {
  assertIsoDate,
  localDateOf,
  instantOf,
  addDays,
  daysBetween,
  isWithin,
  rangesOverlap,
  eachDate,
  isWeekend,
  addWorkingDays,
  subtractWorkingDays,
  workingDaysBetween,
} = require('../../../src/lib/dates');
const { ValidationError } = require('../../../src/lib/errors');

describe('calendar dates', () => {
  it('accepts only a real ISO calendar date', () => {
    expect(assertIsoDate('2025-04-17')).toBe('2025-04-17');
    expect(() => assertIsoDate('17/04/2025')).toThrow(ValidationError);
    expect(() => assertIsoDate('2025-02-30')).toThrow(/not a real calendar date/);
    expect(() => assertIsoDate(20250417)).toThrow(/ISO calendar date/);
  });

  it('reads the venue local date, not the server date', () => {
    const lateNight = new Date('2025-04-17T23:30:00Z');

    expect(localDateOf(lateNight, 'Europe/London')).toBe('2025-04-18');
    expect(localDateOf(lateNight, 'America/Los_Angeles')).toBe('2025-04-17');
    expect(localDateOf(lateNight, 'Asia/Tokyo')).toBe('2025-04-18');
  });

  it('builds the instant of a local screening time', () => {
    expect(instantOf('2025-04-17', '19:30', 'Europe/London').toISOString()).toBe(
      '2025-04-17T18:30:00.000Z',
    );
    expect(instantOf('2025-01-17', '19:30', 'Europe/London').toISOString()).toBe(
      '2025-01-17T19:30:00.000Z',
    );
  });

  it('refuses a wall clock time the venue never sees', () => {
    expect(() => instantOf('2025-03-30', '01:30', 'Europe/London')).toThrow(/does not exist/);
    expect(() => instantOf('2025-03-30', '7pm', 'Europe/London')).toThrow(/24 hour HH:mm/);
    expect(() => instantOf('2025-03-30', '19:30', 'Mars/Olympus')).toThrow(/IANA time zone/);
  });

  it('adds and measures whole days across a month end', () => {
    expect(addDays('2025-01-31', 1)).toBe('2025-02-01');
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
    expect(daysBetween('2025-01-01', '2025-12-31')).toBe(364);
    expect(daysBetween('2025-12-31', '2025-01-01')).toBe(-364);
  });

  it('counts whole days across a daylight saving change', () => {
    expect(daysBetween('2025-03-28', '2025-04-01')).toBe(4);
  });

  it('treats a licence window as closed on both ends', () => {
    expect(isWithin('2025-04-01', '2025-04-01', '2025-04-30')).toBe(true);
    expect(isWithin('2025-04-30', '2025-04-01', '2025-04-30')).toBe(true);
    expect(isWithin('2025-03-31', '2025-04-01', '2025-04-30')).toBe(false);
    expect(isWithin('2025-05-01', '2025-04-01', '2025-04-30')).toBe(false);
  });

  it('calls two windows that touch on one day an overlap', () => {
    const april = { startsOn: '2025-04-01', endsOn: '2025-04-30' };

    expect(rangesOverlap(april, { startsOn: '2025-04-30', endsOn: '2025-05-10' })).toBe(true);
    expect(rangesOverlap(april, { startsOn: '2025-05-01', endsOn: '2025-05-10' })).toBe(false);
    expect(rangesOverlap(april, { startsOn: '2025-01-01', endsOn: '2026-01-01' })).toBe(true);
  });

  it('lists every date in a window, ends included', () => {
    expect(eachDate('2025-04-01', '2025-04-04')).toEqual([
      '2025-04-01',
      '2025-04-02',
      '2025-04-03',
      '2025-04-04',
    ]);
    expect(eachDate('2025-04-04', '2025-04-01')).toEqual([]);
    expect(eachDate('2025-04-01', '2025-04-01')).toEqual(['2025-04-01']);
  });

  it('knows a weekend from a weekday', () => {
    expect(isWeekend('2025-04-19')).toBe(true);
    expect(isWeekend('2025-04-20')).toBe(true);
    expect(isWeekend('2025-04-18')).toBe(false);
  });

  it('walks working days forward over a weekend', () => {
    expect(addWorkingDays('2025-04-17', 1)).toBe('2025-04-18');
    expect(addWorkingDays('2025-04-17', 2)).toBe('2025-04-21');
    expect(addWorkingDays('2025-04-17', 0)).toBe('2025-04-17');
  });

  it('walks working days backwards to find a dispatch date', () => {
    expect(subtractWorkingDays('2025-04-21', 1)).toBe('2025-04-18');
    expect(subtractWorkingDays('2025-04-21', 2)).toBe('2025-04-17');
  });

  it('honours a carrier calendar that closes on more than weekends', () => {
    const closed = new Set(['2025-04-18', '2025-04-21']);
    const isWorkingDay = (d) => !isWeekend(d) && !closed.has(d);

    expect(addWorkingDays('2025-04-17', 1, isWorkingDay)).toBe('2025-04-22');
    expect(subtractWorkingDays('2025-04-22', 1, isWorkingDay)).toBe('2025-04-17');
  });

  it('counts the working days between two dates, excluding the start', () => {
    expect(workingDaysBetween('2025-04-17', '2025-04-22')).toBe(3);
    expect(workingDaysBetween('2025-04-22', '2025-04-17')).toBe(0);
  });

  it('refuses a negative working day count', () => {
    expect(() => addWorkingDays('2025-04-17', -1)).toThrow(ValidationError);
    expect(() => subtractWorkingDays('2025-04-17', 1.5)).toThrow(ValidationError);
  });

  it('gives up rather than looping when a calendar never opens', () => {
    expect(() => addWorkingDays('2025-04-17', 1, () => false)).toThrow(/within ten years/);
  });
});
