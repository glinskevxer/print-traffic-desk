'use strict';

const {
  KNOWN_TERRITORIES,
  holidaysFor,
  isPublicHoliday,
  workingDayIn,
  workingDayAcross,
  hasCalendar,
} = require('../../../../src/domain/traffic/calendars');

describe('shipping calendars', () => {
  it('holds a calendar for the territories the desk ships to', () => {
    expect(KNOWN_TERRITORIES).toEqual(expect.arrayContaining(['GB', 'IE', 'FR', 'DE', 'US']));
    expect(hasCalendar('GB')).toBe(true);
    expect(hasCalendar('JP')).toBe(false);
  });

  it('treats an unknown territory as always open rather than guessing', () => {
    expect(holidaysFor('JP')).toEqual([]);
    expect(workingDayIn('JP')('2025-12-25')).toBe(true);
    expect(workingDayIn('JP')('2025-12-27')).toBe(false);
  });

  it('knows a public holiday from an ordinary weekday', () => {
    expect(isPublicHoliday('2025-12-25', 'GB')).toBe(true);
    expect(isPublicHoliday('2025-12-25', 'FR')).toBe(true);
    expect(isPublicHoliday('2025-12-26', 'FR')).toBe(false);
    expect(isPublicHoliday('2025-04-17', 'GB')).toBe(false);
  });

  it('shuts a carrier on both weekends and holidays', () => {
    const gb = workingDayIn('GB');

    expect(gb('2025-04-17')).toBe(true);
    expect(gb('2025-04-18')).toBe(false);
    expect(gb('2025-04-19')).toBe(false);
    expect(gb('2025-04-21')).toBe(false);
    expect(gb('2025-04-22')).toBe(true);
  });

  it('needs both ends of a lane open for the leg to move', () => {
    const lane = workingDayAcross(['GB', 'FR']);

    expect(lane('2025-05-01')).toBe(false);
    expect(lane('2025-05-05')).toBe(false);
    expect(lane('2025-05-02')).toBe(true);
  });

  it('a domestic lane is just the one calendar', () => {
    expect(workingDayAcross(['GB'])('2025-08-25')).toBe(false);
    expect(workingDayAcross(['GB'])('2025-08-26')).toBe(true);
  });
});
