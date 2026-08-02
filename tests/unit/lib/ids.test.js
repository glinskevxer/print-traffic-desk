'use strict';

const {
  ALPHABET,
  newId,
  isId,
  bookingReference,
  isBookingReference,
  newRequestId,
} = require('../../../src/lib/ids');

describe('identifiers', () => {
  it('leaves out the letters that get misread off a fax', () => {
    for (const letter of ['I', 'L', 'O', 'U']) {
      expect(ALPHABET).not.toContain(letter);
    }
  });

  it('mints prefixed ids that pass their own check', () => {
    const id = newId('elem');

    expect(id.startsWith('elem_')).toBe(true);
    expect(isId(id, 'elem')).toBe(true);
    expect(isId(id, 'insp')).toBe(false);
  });

  it('refuses a prefix that is not short lower case letters', () => {
    expect(() => newId('Element')).toThrow(TypeError);
    expect(() => newId('e')).toThrow(TypeError);
    expect(() => newId('')).toThrow(TypeError);
  });

  it('does not repeat itself over a few thousand ids', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i += 1) seen.add(newId('rw'));

    expect(seen.size).toBe(5000);
  });

  it('stamps a booking reference with the screening year and day of year', () => {
    const ref = bookingReference('2025-04-17', Buffer.from([0, 1, 2, 3]));

    expect(ref).toBe('BK-2025-107-0123');
    expect(isBookingReference(ref)).toBe(true);
  });

  it('handles the first and last day of the year', () => {
    expect(bookingReference('2025-01-01', Buffer.from([0, 0, 0, 0]))).toBe('BK-2025-001-0000');
    expect(bookingReference('2024-12-31', Buffer.from([0, 0, 0, 0]))).toBe('BK-2024-366-0000');
  });

  it('reads the date off the venue calendar, not off the instant', () => {
    // A 23:30 screening in Auckland on new year's eve is 10:30 UTC on the
    // first, and the venue is looking at a ticket that says the thirty first.
    expect(bookingReference('2025-12-31', Buffer.from([0, 0, 0, 0]))).toBe('BK-2025-365-0000');
  });

  it('refuses anything that is not a local date', () => {
    expect(() => bookingReference(new Date('2025-04-17T19:30:00Z'))).toThrow(TypeError);
    expect(() => bookingReference('17/04/2025')).toThrow(/venue local date/);
  });

  it('rejects references that do not match the printed shape', () => {
    expect(isBookingReference('BK-2025-107')).toBe(false);
    expect(isBookingReference('bk-2025-107-0123')).toBe(false);
    expect(isBookingReference('BK-2025-107-01I3')).toBe(false);
    expect(isBookingReference(undefined)).toBe(false);
  });

  it('mints a distinct request id every call', () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
