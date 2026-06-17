'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const {
  makeTitle,
  makeVenue,
  makeRightsHolder,
  makePrintElement,
} = require('../../helpers/factories');
const service = require('../../../src/services/searchService');
const { shapeOf, normaliseBarcode } = require('../../../src/services/searchService');

describe('the box at the top of the screen', () => {
  let app;
  let holder;
  let title;
  let venue;
  let element;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    holder = await makeRightsHolder({ name: 'Park Circus' });
    title = await makeTitle({
      rightsHolder: holder._id,
      slug: 'the-red-shoes',
      title: 'The Red Shoes',
      year: 1948,
    });
    venue = await makeVenue({ code: 'GB-LON-PRINCE', name: 'Prince Charles Cinema' });
    element = await makePrintElement({
      title: title._id,
      owner: holder._id,
      barcode: 'PE-004242',
      currentLocation: venue._id,
      custodian: venue._id,
    });
  });

  it('reads the shape of what was typed', () => {
    expect(shapeOf('PE-004242')).toBe('barcode');
    expect(shapeOf('pe4242')).toBe('barcode');
    expect(shapeOf('GB-LON-PRINCE')).toBe('venue-code');
    expect(shapeOf('BK-2025-171-0123')).toBe('booking-reference');
    expect(shapeOf('ttl_0123456789ABCDEF')).toBe('public-id');
    expect(shapeOf('red shoes')).toBe('text');
  });

  it('reads a barcode written any of the ways a person writes it', () => {
    expect(normaliseBarcode('PE-004242')).toBe('PE-004242');
    expect(normaliseBarcode('pe4242')).toBe('PE-004242');
  });

  it('treats bare digits as words, because 1948 is a year far more often', () => {
    expect(shapeOf('4242')).toBe('text');
    expect(shapeOf('1948')).toBe('text');
  });

  it('finds the can from the barcode on it, however it was written', async () => {
    const found = await service.search('pe4242');

    expect(found.shape).toBe('barcode');
    expect(found.results).toEqual([
      { kind: 'print element', id: element.publicId, label: 'PE-004242 35mm' },
    ]);
  });

  it('finds the house from the code on a despatch note', async () => {
    const found = await service.search('GB-LON');

    expect(found.shape).toBe('venue-code');
    expect(found.results[0].label).toBe('GB-LON-PRINCE Prince Charles Cinema');
  });

  it('finds a booking from a reference read down the phone', async () => {
    const { Booking } = models();
    const booking = await Booking.create({
      reference: 'BK-2025-171-0123',
      title: title._id,
      venue: venue._id,
      screeningAt: new Date('2025-06-20T18:30:00Z'),
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
    });

    const found = await service.search('bk-2025-171-0123');

    expect(found.results).toEqual([
      { kind: 'booking', id: booking.publicId, label: 'BK-2025-171-0123 2025-06-20' },
    ]);
  });

  it('finds anything at all from its public id', async () => {
    expect((await service.search(title.publicId)).results[0].label).toBe('The Red Shoes (1948)');
    expect((await service.search(holder.publicId)).results[0].label).toBe('Park Circus');
    expect((await service.search(venue.publicId)).results[0].kind).toBe('venue');
  });

  it('has nothing for a public id with a prefix it does not know', async () => {
    expect((await service.search('zzz_0123456789ABCDEF')).results).toEqual([]);
  });

  it('searches the catalogue and the houses for words', async () => {
    await makeTitle({
      rightsHolder: holder._id,
      slug: 'black-narcissus',
      title: 'Black Narcissus',
      year: 1947,
    });

    const found = await service.search('shoes');

    expect(found.shape).toBe('text');
    expect(found.results.map((each) => each.label)).toContain('The Red Shoes (1948)');
  });

  it('finds a house by part of its name', async () => {
    const found = await service.search('Prince Charles');

    expect(found.results.some((each) => each.kind === 'venue')).toBe(true);
  });

  it('is not fooled by a regular expression typed into it', async () => {
    const found = await service.search('.*');

    expect(found.results).toEqual([]);
  });

  it('says nothing for a term too short to mean anything', async () => {
    const found = await service.search('a');

    expect(found.shape).toBe('too-short');
    expect(found.results).toEqual([]);
  });

  it('has nothing to say for a barcode nobody catalogued', async () => {
    expect((await service.search('PE-999999')).results).toEqual([]);
  });

  it('answers over http and needs only a viewer', async () => {
    const res = await request(app).get('/search?q=pe4242').expect(200);

    expect(res.body.results[0].id).toBe(element.publicId);
  });

  it('refuses an empty search over http', async () => {
    await request(app).get('/search?q=').expect(400);
  });
});
