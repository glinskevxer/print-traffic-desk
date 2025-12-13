'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { makeVenue, makePrintElement, makeTitle } = require('../../helpers/factories');

describe('venue endpoints', () => {
  let app;

  const body = (overrides = {}) => ({
    code: 'GB-LON-PRINCE',
    name: 'Prince Charles Cinema',
    territory: 'GB',
    city: 'London',
    timezone: 'Europe/London',
    address: { line1: '7 Leicester Place', city: 'London', postcode: 'WC2H 7BY', territory: 'GB' },
    booth: { gauges: ['35mm', '70mm'], soundFormats: ['dolby-sr'], reelCapacity: 8 },
    seats: 288,
    boxOfficeCurrency: 'GBP',
    houseNutMinor: 42000,
    ...overrides,
  });

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('puts a house on file with its booth and its defaults', async () => {
    const res = await request(app).post('/venues').send(body()).expect(201);

    expect(res.body.id).toMatch(/^ven_/);
    expect(res.body.booth.speeds).toEqual([24]);
    expect(res.body.inboundLeadDays).toBe(2);
    expect(res.body.active).toBe(true);
  });

  it('refuses a time zone that is not real', async () => {
    const res = await request(app)
      .post('/venues')
      .send(body({ timezone: 'Europe/Londonderry-ish' }))
      .expect(400);

    expect(res.body.error.message).toMatch(/IANA time zone/);
  });

  it('refuses a shipping address in another territory', async () => {
    const res = await request(app)
      .post('/venues')
      .send(
        body({ address: { line1: '1 Rue', city: 'Paris', postcode: '75001', territory: 'FR' } }),
      )
      .expect(422);

    expect(res.body.error.message).toMatch(/must sit in the venue territory/);
  });

  it('refuses a booth with no gauge at all', async () => {
    await request(app)
      .post('/venues')
      .send(body({ booth: { gauges: [] } }))
      .expect(400);
  });

  it('refuses a second house on the same code', async () => {
    await request(app).post('/venues').send(body()).expect(201);

    const res = await request(app)
      .post('/venues')
      .send(body({ name: 'Other' }))
      .expect(409);

    expect(res.body.error.message).toMatch(/already on file/);
  });

  it('filters the list by territory, gauge and nitrate certificate', async () => {
    await makeVenue({ code: 'GB-LON-BFI', booth: { gauges: ['35mm'], nitrateCertified: true } });
    await makeVenue({
      code: 'FR-PAR-CIN',
      territory: 'FR',
      city: 'Paris',
      address: { line1: '51 Rue de Bercy', city: 'Paris', postcode: '75012', territory: 'FR' },
      timezone: 'Europe/Paris',
      booth: { gauges: ['16mm'] },
    });

    const gb = await request(app).get('/venues?territory=GB').expect(200);
    expect(gb.body.items).toHaveLength(1);

    const sixteen = await request(app).get('/venues?gauge=16mm').expect(200);
    expect(sixteen.body.items[0].code).toBe('FR-PAR-CIN');

    const nitrate = await request(app).get('/venues?nitrateCertified=true').expect(200);
    expect(nitrate.body.items[0].code).toBe('GB-LON-BFI');
  });

  it('edits the address and the lead days', async () => {
    const created = await request(app).post('/venues').send(body()).expect(201);

    const res = await request(app)
      .patch(`/venues/${created.body.id}`)
      .send({ inboundLeadDays: 5, seats: 290 })
      .expect(200);

    expect(res.body.inboundLeadDays).toBe(5);
    expect(res.body.seats).toBe(290);
  });

  it('will not move a house to another territory', async () => {
    const created = await request(app).post('/venues').send(body()).expect(201);

    const res = await request(app)
      .patch(`/venues/${created.body.id}`)
      .send({ address: { line1: '1 Rue', city: 'Paris', postcode: '75001', territory: 'FR' } })
      .expect(422);

    expect(res.body.error.message).toMatch(/retire it instead/);
  });

  it('reports how many prints a booth change strands', async () => {
    const created = await request(app).post('/venues').send(body()).expect(201);
    const venue = await models().Venue.byPublicId(created.body.id);
    const title = await makeTitle();
    await makePrintElement({ title: title._id, gauge: '70mm', currentLocation: venue._id });

    const res = await request(app)
      .put(`/venues/${created.body.id}/booth`)
      .send({ gauges: ['35mm'] })
      .expect(200);

    expect(res.body.booth.gauges).toEqual(['35mm']);
    expect(res.body.strandedElements).toBe(1);
  });

  it('will not retire a house that still holds a committed print', async () => {
    const venue = await makeVenue({ code: 'GB-LON-CLOSE' });
    await makePrintElement({ currentLocation: venue._id, status: 'committed' });

    const res = await request(app)
      .put(`/venues/${venue.publicId}/active`)
      .send({ active: false })
      .expect(422);

    expect(res.body.error.details.holding).toBe(1);
  });

  it('retires a house that holds nothing committed', async () => {
    const venue = await makeVenue({ code: 'GB-LON-QUIET' });

    const res = await request(app)
      .put(`/venues/${venue.publicId}/active`)
      .send({ active: false })
      .expect(200);

    expect(res.body.active).toBe(false);
  });
});
