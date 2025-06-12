'use strict';

const {
  span,
  spansFromShipments,
  mergeSpans,
  conflicts,
  isFreeBetween,
  nextFreeFrom,
  daysCommitted,
} = require('../../../../src/domain/traffic/availability');

const leg = (overrides = {}) => ({
  publicId: 'shp_A',
  leg: 'outbound',
  status: 'planned',
  plannedDispatchOn: '2025-06-16',
  plannedArrivalOn: '2025-06-18',
  ...overrides,
});

describe('element availability', () => {
  it('takes the planned dates until the real ones are known', () => {
    const [only] = spansFromShipments([leg()]);

    expect(only).toEqual(span('2025-06-16', '2025-06-18', 'outbound leg', 'shp_A'));
  });

  it('prefers the real dates once a leg has moved', () => {
    const [only] = spansFromShipments([
      leg({ status: 'delivered', dispatchedOn: '2025-06-17', arrivedOn: '2025-06-20' }),
    ]);

    expect(only.startsOn).toBe('2025-06-17');
    expect(only.endsOn).toBe('2025-06-20');
  });

  it('ignores a leg that was cancelled or lost', () => {
    expect(spansFromShipments([leg({ status: 'cancelled' }), leg({ status: 'lost' })])).toEqual([]);
  });

  it('merges two spans that touch', () => {
    const merged = mergeSpans([
      span('2025-06-01', '2025-06-10', 'outbound leg'),
      span('2025-06-11', '2025-06-15', 'return leg'),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ startsOn: '2025-06-01', endsOn: '2025-06-15' });
    expect(merged[0].reason).toBe('several commitments');
  });

  it('keeps two spans with a real gap apart', () => {
    const merged = mergeSpans([
      span('2025-06-01', '2025-06-10', 'a'),
      span('2025-06-13', '2025-06-15', 'b'),
    ]);

    expect(merged).toHaveLength(2);
  });

  it('merges a span swallowed by a longer one', () => {
    const merged = mergeSpans([
      span('2025-06-01', '2025-06-30', 'long'),
      span('2025-06-10', '2025-06-12', 'short'),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].endsOn).toBe('2025-06-30');
  });

  it('merges nothing out of nothing', () => {
    expect(mergeSpans([])).toEqual([]);
  });

  it('finds the commitments a candidate would collide with', () => {
    const spans = [span('2025-06-16', '2025-06-25', 'outbound leg', 'shp_A')];

    expect(conflicts(spans, { startsOn: '2025-06-20', endsOn: '2025-06-21' })).toHaveLength(1);
    expect(conflicts(spans, { startsOn: '2025-06-26', endsOn: '2025-06-30' })).toEqual([]);
    expect(conflicts(spans, { startsOn: '2025-06-25', endsOn: '2025-06-30' })).toHaveLength(1);
  });

  it('answers whether a stretch is clear', () => {
    const spans = [span('2025-06-16', '2025-06-25', 'x')];

    expect(isFreeBetween(spans, '2025-07-01', '2025-07-10')).toBe(true);
    expect(isFreeBetween(spans, '2025-06-24', '2025-07-10')).toBe(false);
  });

  it('offers the first date the print is free for long enough', () => {
    const spans = [
      span('2025-06-16', '2025-06-25', 'a'),
      span('2025-06-28', '2025-07-04', 'b'),
    ];

    expect(nextFreeFrom(spans, '2025-06-16', 2)).toBe('2025-06-26');
    expect(nextFreeFrom(spans, '2025-06-16', 5)).toBe('2025-07-05');
    expect(nextFreeFrom([], '2025-06-16', 5)).toBe('2025-06-16');
  });

  it('counts the days a print was spoken for inside a period', () => {
    const spans = [
      span('2025-06-16', '2025-06-20', 'a'),
      span('2025-06-25', '2025-07-05', 'b'),
    ];

    expect(daysCommitted(spans, '2025-06-01', '2025-06-30')).toBe(11);
    expect(daysCommitted(spans, '2025-08-01', '2025-08-31')).toBe(0);
  });

  it('does not double count overlapping commitments', () => {
    const spans = [
      span('2025-06-01', '2025-06-10', 'a'),
      span('2025-06-05', '2025-06-15', 'b'),
    ];

    expect(daysCommitted(spans, '2025-06-01', '2025-06-30')).toBe(15);
  });
});
