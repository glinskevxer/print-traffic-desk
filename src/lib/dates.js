'use strict';

const { DateTime, Interval } = require('luxon');
const { ValidationError } = require('./errors');

/**
 * A screening happens at a wall clock time in the venue's own city. Transit,
 * inspection turnaround and licence windows are all counted in local calendar
 * days, so nothing here is allowed to work in the server's zone.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertIsoDate(value, key = 'date') {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new ValidationError(`${key} must be an ISO calendar date`, [
      { key, problem: 'expected YYYY-MM-DD' },
    ]);
  }
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  if (!parsed.isValid) {
    throw new ValidationError(`${key} is not a real calendar date`, [
      { key, problem: parsed.invalidExplanation || 'invalid date' },
    ]);
  }
  return value;
}

function assertZone(zone) {
  if (!DateTime.local().setZone(zone).isValid) {
    throw new ValidationError(`${zone} is not a known IANA time zone`, [
      { key: 'timezone', problem: 'unknown zone' },
    ]);
  }
  return zone;
}

/** The venue's local calendar date for an instant, which is what rights use. */
function localDateOf(instant, zone) {
  assertZone(zone);
  return DateTime.fromJSDate(instant, { zone }).toISODate();
}

/** Builds the UTC instant of a local date and a local HH:mm in one venue. */
function instantOf(localDate, localTime, zone) {
  assertIsoDate(localDate, 'localDate');
  assertZone(zone);
  if (typeof localTime !== 'string' || !ISO_TIME.test(localTime)) {
    throw new ValidationError('a screening time must be a 24 hour HH:mm', [
      { key: 'localTime', problem: 'expected HH:mm' },
    ]);
  }
  const built = DateTime.fromISO(`${localDate}T${localTime}`, { zone });
  if (!built.isValid) {
    throw new ValidationError(`${localDate} ${localTime} does not exist in ${zone}`, [
      { key: 'localTime', problem: built.invalidExplanation || 'invalid local time' },
    ]);
  }
  // Luxon slides an hour that daylight saving skipped forward instead of
  // failing. A programme cannot be sold for a clock time the city never shows,
  // so read the result back and refuse when it moved.
  if (built.toFormat('yyyy-MM-dd') !== localDate || built.toFormat('HH:mm') !== localTime) {
    throw new ValidationError(`${localDate} ${localTime} does not exist in ${zone}`, [
      { key: 'localTime', problem: 'daylight saving skips this local time' },
    ]);
  }
  return built.toUTC().toJSDate();
}

function addDays(localDate, days) {
  assertIsoDate(localDate);
  return DateTime.fromISO(localDate, { zone: 'utc' }).plus({ days }).toISODate();
}

function daysBetween(fromDate, toDate) {
  assertIsoDate(fromDate, 'fromDate');
  assertIsoDate(toDate, 'toDate');
  const from = DateTime.fromISO(fromDate, { zone: 'utc' });
  const to = DateTime.fromISO(toDate, { zone: 'utc' });
  return Math.round(to.diff(from, 'days').days);
}

function compareDates(a, b) {
  return Math.sign(daysBetween(b, a));
}

function isBefore(a, b) {
  return compareDates(a, b) < 0;
}

function isOnOrAfter(a, b) {
  return compareDates(a, b) >= 0;
}

function isWithin(date, startsOn, endsOn) {
  return isOnOrAfter(date, startsOn) && !isBefore(endsOn, date);
}

/** Half open on neither side: two licence windows touching on a day overlap. */
function rangesOverlap(a, b) {
  return !isBefore(a.endsOn, b.startsOn) && !isBefore(b.endsOn, a.startsOn);
}

function eachDate(startsOn, endsOn) {
  const span = daysBetween(startsOn, endsOn);
  if (span < 0) return [];
  return Array.from({ length: span + 1 }, (_, i) => addDays(startsOn, i));
}

function weekdayOf(localDate) {
  assertIsoDate(localDate);
  return DateTime.fromISO(localDate, { zone: 'utc' }).weekday;
}

function isWeekend(localDate) {
  return weekdayOf(localDate) >= 6;
}

/**
 * Walks forward over working days. The predicate decides what a working day is,
 * because carriers and projection booths keep different calendars.
 */
function addWorkingDays(localDate, count, isWorkingDay = (d) => !isWeekend(d)) {
  if (!Number.isInteger(count) || count < 0) {
    throw new ValidationError('a working day count must be a non negative integer', [
      { key: 'count', problem: 'not a non negative integer' },
    ]);
  }
  let cursor = assertIsoDate(localDate);
  let remaining = count;
  let guard = 0;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (isWorkingDay(cursor)) remaining -= 1;
    guard += 1;
    if (guard > 3650) {
      throw new ValidationError('no working day found within ten years', [
        { key: 'calendar', problem: 'calendar has no working days' },
      ]);
    }
  }
  return cursor;
}

/** Walks backwards, which is how a dispatch date is found from a screening. */
function subtractWorkingDays(localDate, count, isWorkingDay = (d) => !isWeekend(d)) {
  if (!Number.isInteger(count) || count < 0) {
    throw new ValidationError('a working day count must be a non negative integer', [
      { key: 'count', problem: 'not a non negative integer' },
    ]);
  }
  let cursor = assertIsoDate(localDate);
  let remaining = count;
  let guard = 0;
  while (remaining > 0) {
    cursor = addDays(cursor, -1);
    if (isWorkingDay(cursor)) remaining -= 1;
    guard += 1;
    if (guard > 3650) {
      throw new ValidationError('no working day found within ten years', [
        { key: 'calendar', problem: 'calendar has no working days' },
      ]);
    }
  }
  return cursor;
}

function workingDaysBetween(fromDate, toDate, isWorkingDay = (d) => !isWeekend(d)) {
  const span = daysBetween(fromDate, toDate);
  if (span <= 0) return 0;
  let count = 0;
  for (let i = 1; i <= span; i += 1) {
    if (isWorkingDay(addDays(fromDate, i))) count += 1;
  }
  return count;
}

function intervalOf(startsOn, endsOn) {
  return Interval.fromDateTimes(
    DateTime.fromISO(startsOn, { zone: 'utc' }),
    DateTime.fromISO(endsOn, { zone: 'utc' }).endOf('day'),
  );
}

module.exports = {
  ISO_DATE,
  assertIsoDate,
  assertZone,
  localDateOf,
  instantOf,
  addDays,
  daysBetween,
  compareDates,
  isBefore,
  isOnOrAfter,
  isWithin,
  rangesOverlap,
  eachDate,
  weekdayOf,
  isWeekend,
  addWorkingDays,
  subtractWorkingDays,
  workingDaysBetween,
  intervalOf,
};
