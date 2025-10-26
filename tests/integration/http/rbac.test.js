'use strict';

const request = require('supertest');
const { buildTestApp, stubOperator } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { makeTitle, makeRightsHolder, makeVenue } = require('../../helpers/factories');

describe('what each role may do', () => {
  let holder;
  let title;
  let venue;

  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    holder = await makeRightsHolder({ name: 'Park Circus' });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE' });
  });

  function appAs(role) {
    return buildTestApp({ operator: stubOperator({ role }) }).app;
  }

  it('lets a viewer read the catalogue', async () => {
    const res = await request(appAs('viewer')).get('/titles').expect(200);

    expect(res.body.items).toHaveLength(1);
  });

  it('will not let a viewer add a title', async () => {
    const res = await request(appAs('viewer'))
      .post('/titles')
      .send({ title: 'Daisies', year: 1966, rightsHolderId: holder.publicId })
      .expect(403);

    expect(res.body.error.details.allowed).toEqual(['programmer']);
  });

  it('lets a programmer add a title', async () => {
    await request(appAs('programmer'))
      .post('/titles')
      .send({ title: 'Daisies', year: 1966, rightsHolderId: holder.publicId })
      .expect(201);
  });

  it('will not let a programmer add a house', async () => {
    await request(appAs('programmer'))
      .post('/venues')
      .send({ code: 'GB-LON-ICA' })
      .expect(403);
  });

  it('lets an archivist catalogue a print but not activate a licence', async () => {
    const archivist = appAs('archivist');

    await request(archivist)
      .post('/elements')
      .send({ barcode: 'PE-000001' })
      .expect(400);

    await request(archivist)
      .put('/rights-windows/rw_0000000000000000/activate')
      .expect(403);
  });

  it('lets traffic move a print', async () => {
    const res = await request(appAs('traffic'))
      .post('/shipments')
      .send({ elementId: 'elem_0000000000000000', toVenueId: venue.publicId, screeningLocalDate: '2025-06-20' })
      .expect(404);

    expect(res.body.error.code).toBe('not_found');
  });

  it('will not let traffic write a licence', async () => {
    await request(appAs('traffic'))
      .post('/rights-windows')
      .send({ titleId: title.publicId })
      .expect(403);
  });

  it('lets an admin do anything the others can', async () => {
    const admin = appAs('admin');

    await request(admin)
      .post('/titles')
      .send({ title: 'Daisies', year: 1966, rightsHolderId: holder.publicId })
      .expect(201);
    await request(admin).get('/venues').expect(200);
  });

  it('turns a request with no operator away', async () => {
    const { app } = buildTestApp({ operator: null });

    const res = await request(app).get('/titles').expect(401);

    expect(res.body.error.code).toBe('not_authenticated');
  });

  it('leaves health open to everybody', async () => {
    const { app } = buildTestApp({ operator: null });

    await request(app).get('/health/live').expect(200);
  });
});
