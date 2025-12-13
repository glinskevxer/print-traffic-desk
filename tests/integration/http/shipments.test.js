'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { makePrintElement, makeVenue } = require('../../helpers/factories');

describe('shipment endpoints', () => {
  let app;
  let home;
  let away;
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
    home = await makeVenue({ code: 'GB-LON-VAULT' });
    away = await makeVenue({ code: 'GB-GLA-GFT', city: 'Glasgow' });
    element = await makePrintElement({
      currentLocation: home._id,
      custodian: home._id,
      status: 'available',
    });
  });

  const planBody = (overrides = {}) => ({
    elementId: element.publicId,
    toVenueId: away.publicId,
    screeningLocalDate: '2025-06-20',
    today: '2025-05-15',
    ...overrides,
  });

  it('plans a leg and answers with the dates it worked out', async () => {
    const res = await request(app).post('/shipments').send(planBody()).expect(201);

    expect(res.body.id).toMatch(/^shp_/);
    expect(res.body.status).toBe('planned');
    expect(res.body.plan.arriveBy).toBe('2025-06-18');
    expect(res.body.quote.service).toBe(res.body.service);
  });

  it('refuses a leg the calendar cannot fit', async () => {
    const res = await request(app)
      .post('/shipments')
      .send(planBody({ screeningLocalDate: '2025-05-16', service: 'road-freight' }))
      .expect(422);

    expect(res.body.error.details.reason).toBe('too-late');
  });

  it('walks a leg from despatch to arrival', async () => {
    const created = await request(app).post('/shipments').send(planBody()).expect(201);

    const dispatched = await request(app)
      .put(`/shipments/${created.body.id}/dispatch`)
      .send({ dispatchedOn: '2025-06-16', carrier: 'Film Freight', trackingReference: 'FF-1' })
      .expect(200);
    expect(dispatched.body.element.status).toBe('in-transit');

    const arrived = await request(app)
      .put(`/shipments/${created.body.id}/arrival`)
      .send({
        arrivedOn: '2025-06-18',
        arrivalCheck: { checkedBy: 'A. Novak', cansReceived: 6, sealsIntact: true },
      })
      .expect(200);
    expect(arrived.body.element.status).toBe('on-loan');
  });

  it('refuses an arrival on a leg that has not gone', async () => {
    const created = await request(app).post('/shipments').send(planBody()).expect(201);

    await request(app)
      .put(`/shipments/${created.body.id}/arrival`)
      .send({ arrivedOn: '2025-06-18' })
      .expect(422);
  });

  it('reports a leg lost and retires the print', async () => {
    const created = await request(app).post('/shipments').send(planBody()).expect(201);
    await request(app)
      .put(`/shipments/${created.body.id}/dispatch`)
      .send({ dispatchedOn: '2025-06-16' })
      .expect(200);

    const res = await request(app)
      .put(`/shipments/${created.body.id}/lost`)
      .send({ reportedOn: '2025-06-30', reason: 'consignment untraceable' })
      .expect(200);

    expect(res.body.status).toBe('lost');
    expect(res.body.element.status).toBe('retired');
  });

  it('lists the legs that should have landed', async () => {
    const created = await request(app).post('/shipments').send(planBody()).expect(201);
    await request(app)
      .put(`/shipments/${created.body.id}/dispatch`)
      .send({ dispatchedOn: '2025-06-16' })
      .expect(200);

    const res = await request(app).get('/shipments/overdue?asOf=2025-06-25').expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(created.body.id);
  });

  it('filters the traffic list by element and by open legs', async () => {
    const created = await request(app).post('/shipments').send(planBody()).expect(201);

    const byElement = await request(app)
      .get(`/shipments?elementId=${element.publicId}`)
      .expect(200);
    expect(byElement.body.items).toHaveLength(1);

    const open = await request(app).get('/shipments?openOnly=true').expect(200);
    expect(open.body.items[0].id).toBe(created.body.id);
  });

  it('refuses a service the desk does not book at all', async () => {
    await request(app)
      .post('/shipments')
      .send(planBody({ service: 'pigeon' }))
      .expect(400);
  });

  it('answers 404 for a leg that is not there', async () => {
    await request(app).get('/shipments/shp_0000000000000000').expect(404);
  });
});
