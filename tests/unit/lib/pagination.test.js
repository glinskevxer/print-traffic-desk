'use strict';

const {
  encodeCursor,
  decodeCursor,
  cursorFilter,
  normaliseLimit,
  MAX_LIMIT,
} = require('../../../src/lib/pagination');
const { ValidationError } = require('../../../src/lib/errors');

describe('cursor paging', () => {
  it('round trips a position through a cursor', () => {
    const cursor = encodeCursor({ sortValue: 'the-red-shoes', id: 'abc123' });

    expect(decodeCursor(cursor)).toEqual({ sortValue: 'the-red-shoes', id: 'abc123' });
  });

  it('carries a date position as an instant', () => {
    const when = new Date('2025-04-17T18:30:00Z');

    expect(decodeCursor(encodeCursor({ sortValue: when, id: 'x' })).sortValue).toBe(
      '2025-04-17T18:30:00.000Z',
    );
  });

  it('does not put the position in the clear', () => {
    const cursor = encodeCursor({ sortValue: 'peeping-tom', id: 'x' });

    expect(cursor).not.toContain('peeping-tom');
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('refuses a cursor it did not issue', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(ValidationError);
    expect(() => decodeCursor(Buffer.from('{}').toString('base64url'))).toThrow(
      /missing its position/,
    );
  });

  it('builds a filter that walks forward past ties', () => {
    const cursor = encodeCursor({ sortValue: 'a', id: '1' });

    expect(cursorFilter({ cursor, sortField: 'slug', order: 'asc' })).toEqual({
      $or: [{ slug: { $gt: 'a' } }, { slug: 'a', _id: { $gt: '1' } }],
    });
  });

  it('flips both comparators when walking backwards', () => {
    const cursor = encodeCursor({ sortValue: 'a', id: '1' });

    expect(cursorFilter({ cursor, sortField: 'slug', order: 'desc' })).toEqual({
      $or: [{ slug: { $lt: 'a' } }, { slug: 'a', _id: { $lt: '1' } }],
    });
  });

  it('is an empty filter on the first page', () => {
    expect(cursorFilter({ sortField: 'slug', order: 'asc' })).toEqual({});
  });

  it('holds the page size inside the range', () => {
    expect(normaliseLimit(undefined)).toBe(50);
    expect(normaliseLimit(1)).toBe(1);
    expect(normaliseLimit(MAX_LIMIT)).toBe(MAX_LIMIT);
    expect(() => normaliseLimit(0)).toThrow(ValidationError);
    expect(() => normaliseLimit(MAX_LIMIT + 1)).toThrow(/between 1 and 200/);
    expect(() => normaliseLimit(2.5)).toThrow(ValidationError);
  });
});
