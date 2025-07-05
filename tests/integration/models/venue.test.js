'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');

let Venue;

const prince = {
  code: 'GB-LON-PRINCE',
  name: 'Prince Charles Cinema',
  territory: 'GB',
  city: 'London',
  timezone: 'Europe/London',
  address: {
    line1: '7 Leicester Place',
    city: 'London',
    postcode: 'WC2H 7BY',
    territory: 'GB',
  },
  booth: {
    gauges: ['35mm', '70mm'],
    soundFormats: ['optical-mono', 'dolby-a', 'dolby-sr', 'dolby-digital'],
    speeds: [24, 25],
    platterEquipped: false,
    changeoverCapable: true,
    nitrateCertified: false,
    reelCapacity: 8,
  },
  seats: 288,
  boxOfficeCurrency: 'GBP',
  houseNutMinor: 42000,
  inboundLeadDays: 3,
  outboundLeadDays: 1,
};

describe('venue model', () => {
  beforeAll(async () => {
    ({ Venue } = await useDatabase());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  afterEach(async () => {
    await clearCollections();
  });

  it('stores a house with its booth', async () => {
    const venue = await Venue.create(prince);

    expect(venue.publicId).toMatch(/^ven_/);
    expect(venue.booth.gauges).toEqual(['35mm', '70mm']);
    expect(venue.active).toBe(true);
  });

  it('upper cases the house code and enforces its shape', async () => {
    const venue = await Venue.create({ ...prince, code: 'gb-lon-prince' });
    expect(venue.code).toBe('GB-LON-PRINCE');

    await expect(Venue.create({ ...prince, code: 'PRINCE' })).rejects.toThrow(
      /TERRITORY-CITY-HOUSE/,
    );
  });

  it('refuses a booth that runs no gauge at all', async () => {
    await expect(Venue.create({ ...prince, booth: { ...prince.booth, gauges: [] } })).rejects.toThrow(
      /at least one gauge/,
    );
  });

  it('refuses a gauge outside the vocabulary', async () => {
    await expect(
      Venue.create({ ...prince, booth: { ...prince.booth, gauges: ['32mm'] } }),
    ).rejects.toThrow(/32mm/);
  });

  it('answers what the booth can run', async () => {
    const venue = await Venue.create(prince);

    expect(venue.runsGauge('35mm')).toBe(true);
    expect(venue.runsGauge('16mm')).toBe(false);
    expect(venue.bestSoundFor('dts')).toBe('dolby-sr');
    expect(venue.bestSoundFor('magnetic-4track')).toBeNull();
    expect(venue.runsSpeed(24)).toBe(true);
    expect(venue.runsSpeed(18)).toBe(false);
  });

  it('defaults the lead days and the nitrate certificate', async () => {
    const venue = await Venue.create({
      ...prince,
      code: 'GB-LON-BFI',
      name: 'BFI Southbank',
      inboundLeadDays: undefined,
      outboundLeadDays: undefined,
      booth: { gauges: ['35mm'] },
    });

    expect(venue.inboundLeadDays).toBe(2);
    expect(venue.outboundLeadDays).toBe(1);
    expect(venue.booth.nitrateCertified).toBe(false);
    expect(venue.booth.speeds).toEqual([24]);
  });

  it('keeps house codes unique', async () => {
    await Venue.create(prince);

    await expect(Venue.create({ ...prince, name: 'Another house' })).rejects.toThrow(
      /duplicate key/,
    );
  });
});
