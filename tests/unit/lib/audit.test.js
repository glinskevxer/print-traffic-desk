'use strict';

const { diffFields, normalise } = require('../../../src/lib/audit');

describe('audit change lists', () => {
  it('lists only the fields that moved', () => {
    const changes = diffFields(
      { status: 'available', grade: 'B' },
      { status: 'quarantined', grade: 'B' },
    );

    expect(changes).toEqual([{ field: 'status', before: 'available', after: 'quarantined' }]);
  });

  it('is empty when nothing moved', () => {
    expect(diffFields({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('narrows to the fields worth auditing when told which', () => {
    const changes = diffFields(
      { status: 'a', updatedAt: 1 },
      { status: 'b', updatedAt: 2 },
      ['status'],
    );

    expect(changes).toHaveLength(1);
  });

  it('treats an absent field and a null field the same', () => {
    expect(diffFields({}, { grade: null })).toEqual([]);
    expect(diffFields({ grade: undefined }, { grade: null })).toEqual([]);
  });

  it('notices a change inside an array', () => {
    const changes = diffFields(
      { restrictions: ['no-platter'] },
      { restrictions: ['no-platter', 'nitrate-booth'] },
    );

    expect(changes[0].after).toEqual(['no-platter', 'nitrate-booth']);
  });

  it('writes a date down as an instant', () => {
    expect(normalise(new Date('2025-04-17T18:30:00Z'))).toBe('2025-04-17T18:30:00.000Z');
  });

  it('leaves plain values alone', () => {
    expect(normalise(42)).toBe(42);
    expect(normalise('available')).toBe('available');
    expect(normalise(undefined)).toBeNull();
  });
});
