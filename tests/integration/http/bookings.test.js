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
  makeRightsWindow,
} = require('../../helpers/factories');

describe('booking endpoints', () => {
  let app;
  let holder;
  let title;
  let venue;
  let vault;
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
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE', seats: 288 });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    element = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500 },
    });
  });

  const ask = (overrides = {}) => ({
    titleId: title.publicId,
    venueId: venue.publicId,
    localDate: '2025-06-20',
    localTime: '19:30',
    exhibitionType: 'repertory',
    today: '2025-05-15',
    ...overrides,
  });

  it('takes a hold and says which print and licence it used', async () => {
    const res = await request(app).post('/bookings').send(ask()).expect(201);

    expect(res.body.status).toBe('held');
    expect(res.body.element.barcode).toBe(element.barcode);
    expect(res.body.clearedUnder).toMatch(/^rw_/);
    expect(res.body.traffic.outbound.dispatchOn).toBeTruthy();
  });

  it('explains a refusal rule by rule', async () => {
    const { RightsWindow } = models();
    await RightsWindow.updateMany({}, { $set: { endsOn: '2025-05-31' } });

    const res = await request(app).post('/bookings').send(ask()).expect(422);

    expect(res.body.error.details.refusalCodes).toEqual(['window']);
    expect(res.body.error.details.refusals[0].detail).toMatch(/closed on 2025-05-31/);
  });

  it('replays a retry rather than taking a second hold', async () => {
    const key = 'prince-desk-000001';

    const first = await request(app)
      .post('/bookings')
      .set('idempotency-key', key)
      .send(ask())
      .expect(201);
    const second = await request(app)
      .post('/bookings')
      .set('idempotency-key', key)
      .send(ask())
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(await models().Booking.countDocuments()).toBe(1);
  });

  it('walks a booking through to settlement', async () => {
    const created = await request(app).post('/bookings').send(ask()).expect(201);

    const confirmed = await request(app)
      .put(`/bookings/${created.body.id}/confirm`)
      .send({ confirmedBy: 'programmer@prince.test' })
      .expect(200);
    expect(confirmed.body.shipments).toHaveLength(2);

    const reported = await request(app)
      .put(`/bookings/${created.body.id}/box-office`)
      .send({ grossMinor: 184000, currency: 'GBP', admissions: 210 })
      .expect(200);
    expect(reported.body.royalty.amountMinor).toBe(64400);

    const settled = await request(app)
      .put(`/bookings/${created.body.id}/settle`)
      .send({ settledOn: '2025-07-01' })
      .expect(200);
    expect(settled.body.status).toBe('settled');
  });

  it('cancels a booking and says how many legs it stood down', async () => {
    const created = await request(app).post('/bookings').send(ask()).expect(201);
    await request(app).put(`/bookings/${created.body.id}/confirm`).send({}).expect(200);

    const res = await request(app)
      .delete(`/bookings/${created.body.id}`)
      .send({ reason: 'the season was pulled', feeMinor: 5000 })
      .expect(200);

    expect(res.body.status).toBe('cancelled');
    expect(res.body.legsCancelled).toBe(2);
  });

  it('refuses a cancellation with no reason', async () => {
    const created = await request(app).post('/bookings').send(ask()).expect(201);

    await request(app).delete(`/bookings/${created.body.id}`).send({}).expect(400);
  });

  it('refuses takings the house could not have taken', async () => {
    const created = await request(app).post('/bookings').send(ask()).expect(201);
    await request(app).put(`/bookings/${created.body.id}/confirm`).send({}).expect(200);

    await request(app)
      .put(`/bookings/${created.body.id}/box-office`)
      .send({ grossMinor: 184000, currency: 'GBP', admissions: 9000 })
      .expect(422);
  });

  it('lists what is waiting for its takings', async () => {
    const created = await request(app).post('/bookings').send(ask()).expect(201);
    await request(app).put(`/bookings/${created.body.id}/confirm`).send({}).expect(200);

    const res = await request(app).get('/bookings/awaiting-box-office?asOf=2025-06-25').expect(200);

    expect(res.body.items[0].reference).toBe(created.body.reference);
  });

  it('filters the diary by house and by date', async () => {
    await request(app).post('/bookings').send(ask()).expect(201);

    const byVenue = await request(app).get(`/bookings?venueId=${venue.publicId}`).expect(200);
    expect(byVenue.body.items).toHaveLength(1);

    const later = await request(app).get('/bookings?from=2025-07-01').expect(200);
    expect(later.body.items).toHaveLength(0);
  });

  it('answers 404 for a booking that is not there', async () => {
    await request(app).get('/bookings/bkg_0000000000000000').expect(404);
  });
});

describe('booking a run of nights', () => {
  let app;
  let holder;
  let title;
  let venue;
  let vault;
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
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE', seats: 288 });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    element = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
  });

  const run = (overrides = {}) => ({
    titleId: title.publicId,
    venueId: venue.publicId,
    localDates: ['2025-06-20', '2025-06-21', '2025-06-22'],
    localTime: '19:30',
    exhibitionType: 'repertory',
    today: '2025-05-15',
    ...overrides,
  });

  it('holds every night on the same print', async () => {
    const res = await request(app).post('/bookings/runs').send(run()).expect(201);

    expect(res.body.nights).toBe(3);
    expect(res.body.bookings).toHaveLength(3);
    expect(res.body.element.barcode).toBe(element.barcode);
    expect(new Set(res.body.bookings.map((booking) => booking.element)).size).toBe(1);
  });

  it('counts every night against the licence', async () => {
    await request(app).post('/bookings/runs').send(run()).expect(201);

    const window = await models().RightsWindow.findOne({ title: title._id });
    expect(window.screeningsUsed).toBe(3);
  });

  it('sorts the nights and ignores a date given twice', async () => {
    const res = await request(app)
      .post('/bookings/runs')
      .send(run({ localDates: ['2025-06-22', '2025-06-20', '2025-06-20'] }))
      .expect(201);

    expect(res.body.bookings.map((booking) => booking.localDate)).toEqual([
      '2025-06-20',
      '2025-06-22',
    ]);
  });

  it('holds nothing at all when one night cannot be held', async () => {
    const { RightsWindow } = models();
    await RightsWindow.updateMany({}, { $set: { maxScreenings: 2 } });

    const res = await request(app).post('/bookings/runs').send(run()).expect(422);
    expect(res.body.error.details.refusalCodes).toEqual(['screening-cap']);

    const live = await models().Booking.countDocuments({ status: { $in: ['held', 'confirmed'] } });
    expect(live).toBe(0);
  });

  it('gives the print back when a run is stood down', async () => {
    const { RightsWindow } = models();
    await RightsWindow.updateMany({}, { $set: { maxScreenings: 2 } });

    await request(app).post('/bookings/runs').send(run()).expect(422);

    expect((await models().PrintElement.findById(element._id)).status).toBe('available');
    expect((await RightsWindow.findOne({ title: title._id })).screeningsUsed).toBe(0);
  });

  it('refuses a run with no nights in it', async () => {
    await request(app)
      .post('/bookings/runs')
      .send(run({ localDates: [] }))
      .expect(400);
  });

  it('refuses a run longer than a fortnight', async () => {
    const fifteen = Array.from(
      { length: 15 },
      (_, day) => `2025-06-${String(day + 10).padStart(2, '0')}`,
    );

    await request(app)
      .post('/bookings/runs')
      .send(run({ localDates: fifteen }))
      .expect(400);
  });

  it('takes the print the house asked for across the whole run', async () => {
    const other = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
      conditionGrade: 'C',
    });

    const res = await request(app)
      .post('/bookings/runs')
      .send(run({ elementId: other.publicId }))
      .expect(201);

    expect(res.body.element.barcode).toBe(other.barcode);
  });
});
