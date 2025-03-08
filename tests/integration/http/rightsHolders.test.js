'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { openTestConnection, closeTestConnection, clearCollections } = require('../../helpers/db');
const { registerModels, syncIndexes } = require('../../../src/models');
const { makeRightsHolder, makeTitle } = require('../../helpers/factories');

describe('rights holder endpoints', () => {
  let app;

  const body = (overrides = {}) => ({
    name: 'Park Circus',
    kind: 'distributor',
    territoriesRepresented: ['GB', 'IE', 'EU'],
    contacts: [{ name: 'Bookings', email: 'bookings@parkcircus.test', role: 'bookings' }],
    remittanceCurrency: 'GBP',
    ...overrides,
  });

  beforeAll(async () => {
    const conn = await openTestConnection();
    registerModels(conn);
    await syncIndexes();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('puts a licensor on file with their settlement terms', async () => {
    const res = await request(app).post('/rights-holders').send(body()).expect(201);

    expect(res.body.id).toMatch(/^rh_/);
    expect(res.body.settlementDays).toBe(45);
    expect(res.body.active).toBe(true);
  });

  it('will not take a licensor with nobody to ring', async () => {
    await request(app).post('/rights-holders').send(body({ contacts: [] })).expect(400);
  });

  it('refuses a currency the desk cannot settle', async () => {
    const res = await request(app)
      .post('/rights-holders')
      .send(body({ remittanceCurrency: 'XBT' }))
      .expect(400);

    expect(res.body.error.message).toMatch(/not settled by this desk/);
  });

  it('refuses a territory that is not a code, EU or WORLD', async () => {
    await request(app)
      .post('/rights-holders')
      .send(body({ territoriesRepresented: ['Britain'] }))
      .expect(400);
  });

  it('refuses the same name twice', async () => {
    await request(app).post('/rights-holders').send(body()).expect(201);

    await request(app).post('/rights-holders').send(body()).expect(409);
  });

  it('finds the holders who cover a territory, EU and WORLD included', async () => {
    await makeRightsHolder({ name: 'Local GB', territoriesRepresented: ['GB'] });
    await makeRightsHolder({ name: 'Pan EU', territoriesRepresented: ['EU'] });
    await makeRightsHolder({ name: 'Nordic', territoriesRepresented: ['SE', 'NO'] });

    const res = await request(app).get('/rights-holders?territory=GB').expect(200);

    expect(res.body.items.map((h) => h.name).sort()).toEqual(['Local GB', 'Pan EU']);
  });

  it('edits the contacts but refuses to empty them', async () => {
    const created = await request(app).post('/rights-holders').send(body()).expect(201);

    const res = await request(app)
      .patch(`/rights-holders/${created.body.id}`)
      .send({ contacts: [{ name: 'Accounts', email: 'accounts@parkcircus.test', role: 'accounts' }] })
      .expect(200);
    expect(res.body.contacts).toHaveLength(1);

    await request(app)
      .patch(`/rights-holders/${created.body.id}`)
      .send({ contacts: [] })
      .expect(422);
  });

  it('changes the remittance currency only while nothing is bookable', async () => {
    const holder = await makeRightsHolder({ name: 'Fresh', remittanceCurrency: 'GBP' });

    const changed = await request(app)
      .put(`/rights-holders/${holder.publicId}/remittance-currency`)
      .send({ currency: 'EUR' })
      .expect(200);
    expect(changed.body.remittanceCurrency).toBe('EUR');

    await makeTitle({ rightsHolder: holder._id, status: 'bookable' });

    const refused = await request(app)
      .put(`/rights-holders/${holder.publicId}/remittance-currency`)
      .send({ currency: 'USD' })
      .expect(422);
    expect(refused.body.error.details.bookableTitles).toBe(1);
  });

  it('deactivates a holder only once their titles are withdrawn', async () => {
    const holder = await makeRightsHolder({ name: 'Retiring' });
    const title = await makeTitle({ rightsHolder: holder._id, status: 'bookable' });

    await request(app).delete(`/rights-holders/${holder.publicId}`).expect(422);

    title.status = 'withdrawn';
    title.withdrawnReason = 'licence lapsed';
    await title.save();

    const res = await request(app).delete(`/rights-holders/${holder.publicId}`).expect(200);
    expect(res.body.active).toBe(false);
  });
});
