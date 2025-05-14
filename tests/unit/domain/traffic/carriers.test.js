'use strict';

const {
  SERVICES,
  laneKey,
  laneFor,
  permittedServices,
  estimateTransit,
  fastestPermitted,
} = require('../../../../src/domain/traffic/carriers');
const { ValidationError } = require('../../../../src/lib/errors');

describe('carrier lanes', () => {
  it('groups a territory into the lane it belongs to', () => {
    expect(laneKey('GB')).toBe('GB');
    expect(laneKey('FR')).toBe('EU');
    expect(laneKey('SE')).toBe('EU');
    expect(laneKey('IE')).toBe('IE');
    expect(laneKey('JP')).toBe('OTHER');
  });

  it('falls back to the slowest lane for somewhere it has no table for', () => {
    expect(laneFor('JP', 'BR').transitDays).toBe(8);
  });

  it('puts customs days on a lane that leaves the union', () => {
    expect(laneFor('GB', 'FR').customsDays).toBe(2);
    expect(laneFor('FR', 'DE').customsDays).toBe(0);
    expect(laneFor('GB', 'GB').customsDays).toBe(0);
  });

  it('quotes a transit as working days plus the customs hold', () => {
    const quote = estimateTransit({ fromTerritory: 'GB', toTerritory: 'FR' });

    expect(quote.transitDays).toBe(4);
    expect(quote.customsDays).toBe(2);
    expect(quote.totalDays).toBe(6);
    expect(quote.crossesBorder).toBe(true);
  });

  it('a courier beats road freight on the same lane', () => {
    const road = estimateTransit({ fromTerritory: 'GB', toTerritory: 'GB', service: 'road-freight' });
    const courier = estimateTransit({ fromTerritory: 'GB', toTerritory: 'GB', service: 'courier' });

    expect(courier.totalDays).toBeLessThan(road.totalDays);
  });

  it('a hand carry skips the customs hold because somebody is carrying it', () => {
    const quote = estimateTransit({ fromTerritory: 'GB', toTerritory: 'US', service: 'hand-carry' });

    expect(quote.customsDays).toBe(0);
    expect(quote.totalDays).toBe(1);
  });

  it('refuses a service nobody books', () => {
    expect(() =>
      estimateTransit({ fromTerritory: 'GB', toTerritory: 'GB', service: 'pigeon' }),
    ).toThrow(ValidationError);
  });

  it('allows every service for an ordinary polyester print', () => {
    expect(permittedServices({})).toEqual(SERVICES);
  });

  it('keeps a hand carry only element off freight', () => {
    expect(permittedServices({ restrictions: ['hand-carry-only'] })).toEqual([
      'courier',
      'hand-carry',
    ]);
  });

  it('never flies nitrate', () => {
    expect(permittedServices({ baseStock: 'nitrate' })).not.toContain('air-freight');
  });

  it('leaves a hand carry only nitrate print with a courier or a person', () => {
    expect(permittedServices({ baseStock: 'nitrate', restrictions: ['hand-carry-only'] })).toEqual([
      'courier',
      'hand-carry',
    ]);
  });

  it('picks the quickest service the element is allowed', () => {
    const quickest = fastestPermitted({ fromTerritory: 'GB', toTerritory: 'FR' });

    expect(quickest.service).toBe('hand-carry');
    expect(quickest.totalDays).toBe(1);
  });

  it('picks the quickest freight when a courier is not on', () => {
    const quickest = fastestPermitted({
      fromTerritory: 'GB',
      toTerritory: 'FR',
      restrictions: [],
      baseStock: 'nitrate',
    });

    expect(quickest.service).toBe('hand-carry');
  });
});
