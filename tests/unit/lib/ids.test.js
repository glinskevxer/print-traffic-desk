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
    const ref = bookingReference(new Date('2025-04-17T19:30:00Z'), Buffer.from([0, 1, 2, 3]));

    expect(ref).toBe('BK-2025-107-0123');
    expect(isBookingReference(ref)).toBe(true);
  });

  it('handles the first and last day of the year', () => {
    expect(bookingReference(new Date('2025-01-01T00:05:00Z'), Buffer.from([0, 0, 0, 0]))).toBe(
      'BK-2025-001-0000',
    );
    expect(bookingReference(new Date('2024-12-31T23:00:00Z'), Buffer.from([0, 0, 0, 0]))).toBe(
      'BK-2024-366-0000',
    );
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
