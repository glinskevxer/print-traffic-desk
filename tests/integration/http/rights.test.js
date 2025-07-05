'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { makeTitle, makeRightsHolder, makeVenue } = require('../../helpers/factories');

describe('rights window endpoints', () => {
  let app;
  let title;
  let holder;
  let prince;

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
    prince = await makeVenue({ code: 'GB-LON-PRINCE', city: 'London' });
  });

  const body = (overrides = {}) => ({
    titleId: title.publicId,
    rightsHolderId: holder.publicId,
    territory: 'GB',
    exhibitionTypes: ['repertory'],
    startsOn: '2025-01-01',
    endsOn: '2025-12-31',
    terms: { kind: 'flat', currency: 'GBP', flatFeeMinor: 25000 },
    ...overrides,
  });

  it('writes a licence and leaves it as a draft', async () => {
    const res = await request(app).post('/rights-windows').send(body()).expect(201);

    expect(res.body.id).toMatch(/^rw_/);
    expect(res.body.status).toBe('draft');
  });

  it('refuses a window that ends before it starts', async () => {
    const res = await request(app)
      .post('/rights-windows')
      .send(body({ startsOn: '2025-06-01', endsOn: '2025-01-01' }))
      .expect(400);

    expect(res.body.error.details.issues[0].key).toBe('endsOn');
  });

  it('refuses an exclusive with no house named', async () => {
    await request(app)
      .post('/rights-windows')
      .send(body({ exclusivity: { scope: 'city' } }))
      .expect(400);
  });

  it('activates and then suspends a licence', async () => {
    const created = await request(app).post('/rights-windows').send(body()).expect(201);

    const active = await request(app)
      .put(`/rights-windows/${created.body.id}/activate`)
      .expect(200);
    expect(active.body.status).toBe('active');

    const suspended = await request(app)
      .put(`/rights-windows/${created.body.id}/suspend`)
      .send({ reason: 'invoice unpaid' })
      .expect(200);
    expect(suspended.body.status).toBe('suspended');
  });

  it('refuses a suspension with no reason', async () => {
    const created = await request(app).post('/rights-windows').send(body()).expect(201);

    await request(app).put(`/rights-windows/${created.body.id}/suspend`).send({}).expect(400);
  });

  it('lists the licences on a title', async () => {
    await request(app).post('/rights-windows').send(body()).expect(201);
    await request(app)
      .post('/rights-windows')
      .send(body({ territory: 'IE', startsOn: '2026-01-01', endsOn: '2026-12-31' }))
      .expect(201);

    const res = await request(app).get(`/rights-windows?titleId=${title.publicId}`).expect(200);

    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].startsOn).toBe('2025-01-01');
  });

  it('clears a screening and names the licence it cleared under', async () => {
    const created = await request(app).post('/rights-windows').send(body()).expect(201);
    await request(app).put(`/rights-windows/${created.body.id}/activate`).expect(200);

    const res = await request(app)
      .get('/clearance')
      .query({ titleId: title.publicId, venueId: prince.publicId, localDate: '2025-04-17' })
      .expect(200);

    expect(res.body.cleared).toBe(true);
    expect(res.body.windowId).toBe(created.body.id);
    expect(res.body.refusals).toEqual([]);
  });

  it('will not clear under a licence that is still a draft', async () => {
    await request(app).post('/rights-windows').send(body()).expect(201);

    const res = await request(app)
      .get('/clearance')
      .query({ titleId: title.publicId, venueId: prince.publicId, localDate: '2025-04-17' })
      .expect(200);

    expect(res.body.cleared).toBe(false);
    expect(res.body.refusalCodes).toEqual(['status']);
    expect(res.body.refusals[0].detail).toMatch(/still a draft/);
  });

  it('explains a refusal rule by rule', async () => {
    const created = await request(app)
      .post('/rights-windows')
      .send(body({ blackouts: [{ startsOn: '2025-04-01', endsOn: '2025-04-30', reason: 'Cannes' }] }))
      .expect(201);
    await request(app).put(`/rights-windows/${created.body.id}/activate`).expect(200);

    const res = await request(app)
      .get('/clearance')
      .query({ titleId: title.publicId, venueId: prince.publicId, localDate: '2025-04-17' })
      .expect(200);

    expect(res.body.cleared).toBe(false);
    expect(res.body.evaluated[0].outcomes.find((o) => o.code === 'blackout').detail).toMatch(
      /for Cannes/,
    );
  });

  it('turns a local time into the instant of the screening', async () => {
    const created = await request(app).post('/rights-windows').send(body()).expect(201);
    await request(app).put(`/rights-windows/${created.body.id}/activate`).expect(200);

    const res = await request(app)
      .get('/clearance')
      .query({
        titleId: title.publicId,
        venueId: prince.publicId,
        localDate: '2025-04-17',
        localTime: '19:30',
      })
      .expect(200);

    expect(res.body.request.screeningAt).toBe('2025-04-17T18:30:00.000Z');
  });

  it('needs a date to answer a clearance question at all', async () => {
    await request(app)
      .get('/clearance')
      .query({ titleId: title.publicId, venueId: prince.publicId })
      .expect(400);
  });
});
