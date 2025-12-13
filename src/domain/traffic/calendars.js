'use strict';

const { isWeekend } = require('../../lib/dates');

/**
 * Carriers do not collect on a public holiday and archives are shut. The desk
 * only needs the handful of territories it actually ships to, and a date the
 * table does not know is treated as a working day rather than guessed at.
 */

const HOLIDAYS = Object.freeze({
  GB: Object.freeze([
    '2025-01-01',
    '2025-04-18',
    '2025-04-21',
    '2025-05-05',
    '2025-05-26',
    '2025-08-25',
    '2025-12-25',
    '2025-12-26',
    '2026-01-01',
    '2026-04-03',
    '2026-04-06',
    '2026-05-04',
    '2026-05-25',
    '2026-08-31',
    '2026-12-25',
    '2026-12-28',
  ]),
  IE: Object.freeze([
    '2025-01-01',
    '2025-02-03',
    '2025-03-17',
    '2025-04-21',
    '2025-05-05',
    '2025-06-02',
    '2025-08-04',
    '2025-10-27',
    '2025-12-25',
    '2025-12-26',
  ]),
  FR: Object.freeze([
    '2025-01-01',
    '2025-04-21',
    '2025-05-01',
    '2025-05-08',
    '2025-05-29',
    '2025-06-09',
    '2025-07-14',
    '2025-08-15',
    '2025-11-01',
    '2025-11-11',
    '2025-12-25',
  ]),
  DE: Object.freeze([
    '2025-01-01',
    '2025-04-18',
    '2025-04-21',
    '2025-05-01',
    '2025-05-29',
    '2025-06-09',
    '2025-10-03',
    '2025-12-25',
    '2025-12-26',
  ]),
  IT: Object.freeze([
    '2025-01-01',
    '2025-01-06',
    '2025-04-21',
    '2025-04-25',
    '2025-05-01',
    '2025-06-02',
    '2025-08-15',
    '2025-11-01',
    '2025-12-08',
    '2025-12-25',
    '2025-12-26',
  ]),
  US: Object.freeze([
    '2025-01-01',
    '2025-01-20',
    '2025-05-26',
    '2025-07-04',
    '2025-09-01',
    '2025-11-27',
    '2025-12-25',
  ]),
});

const KNOWN_TERRITORIES = Object.freeze(Object.keys(HOLIDAYS));

function holidaysFor(territory) {
  return HOLIDAYS[territory] || [];
}

function isPublicHoliday(localDate, territory) {
  return holidaysFor(territory).includes(localDate);
}

/**
 * A carrier working day in one territory. Freight lanes that cross a border
 * have to satisfy both ends, which the routing planner composes itself.
 */
function workingDayIn(territory) {
  const holidays = new Set(holidaysFor(territory));
  return (localDate) => !isWeekend(localDate) && !holidays.has(localDate);
}

/** Both ends of a lane have to be open for a leg to move that day. */
function workingDayAcross(territories) {
  const predicates = territories.map((territory) => workingDayIn(territory));
  return (localDate) => predicates.every((isOpen) => isOpen(localDate));
}

/** Whether the desk actually holds a calendar, so a caller can say so. */
function hasCalendar(territory) {
  return KNOWN_TERRITORIES.includes(territory);
}

module.exports = {
  HOLIDAYS,
  KNOWN_TERRITORIES,
  holidaysFor,
  isPublicHoliday,
  workingDayIn,
  workingDayAcross,
  hasCalendar,
};
