'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { makeRightsHolder, makeTitle } = require('../../helpers/factories');

describe('title endpoints', () => {
  let app;
  let holder;

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
  });

  const body = () => ({
    title: 'Céline and Julie Go Boating',
    year: 1974,
    countries: ['FR'],
    originalLanguages: ['fr'],
    runtimeMinutes: 193,
    credits: [{ name: 'Jacques Rivette', role: 'director' }],
    rightsHolderId: holder.publicId,
  });

  it('creates a title and slugs it from the name and the year', async () => {
    const res = await request(app).post('/titles').send(body()).expect(201);

    expect(res.body.id).toMatch(/^ttl_/);
    expect(res.body.slug).toBe('celine-and-julie-go-boating-1974');
    expect(res.body.status).toBe('draft');
    expect(res.body._id).toBeUndefined();
  });

  it('adds a suffix rather than colliding on a slug', async () => {
    await request(app).post('/titles').send(body()).expect(201);

    const second = await request(app).post('/titles').send(body()).expect(201);

    expect(second.body.slug).toBe('celine-and-julie-go-boating-1974-2');
  });

  it('takes a slug the cataloguer supplied', async () => {
    const res = await request(app)
      .post('/titles')
      .send({ ...body(), slug: 'celine-et-julie' })
      .expect(201);

    expect(res.body.slug).toBe('celine-et-julie');
  });

  it('refuses a body that is missing the rights holder', async () => {
    const { rightsHolderId: _dropped, ...withoutHolder } = body();

    const res = await request(app).post('/titles').send(withoutHolder).expect(400);

    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details.issues[0].key).toBe('rightsHolderId');
  });

  it('refuses a rights holder that does not exist', async () => {
    const res = await request(app)
      .post('/titles')
      .send({ ...body(), rightsHolderId: 'rh_0000000000000000' })
      .expect(404);

    expect(res.body.error.details.resource).toBe('rights holder');
  });

  it('refuses a rights holder that has stopped trading', async () => {
    holder.active = false;
    await holder.save();

    const res = await request(app).post('/titles').send(body()).expect(422);

    expect(res.body.error.message).toMatch(/no longer trading/);
  });

  it('reads one title back by its public id', async () => {
    const created = await request(app).post('/titles').send(body()).expect(201);

    const res = await request(app).get(`/titles/${created.body.id}`).expect(200);

    expect(res.body.title).toBe('Céline and Julie Go Boating');
    expect(res.body.directors).toEqual(['Jacques Rivette']);
  });

  it('answers 404 for a title id that is well formed but unknown', async () => {
    await request(app).get('/titles/ttl_0000000000000000').expect(404);
  });

  it('answers 400 for an id shaped like another record', async () => {
    const res = await request(app).get('/titles/ven_0000000000000000').expect(400);

    expect(res.body.error.details.issues[0].source).toBe('path');
  });

  it('lists and filters the catalogue', async () => {
    await makeTitle({ slug: 'daisies', title: 'Daisies', year: 1966, rightsHolder: holder._id });
    await makeTitle({ slug: 'el-sur', title: 'El Sur', year: 1983, rightsHolder: holder._id });

    const all = await request(app).get('/titles').expect(200);
    expect(all.body.items.map((t) => t.slug)).toEqual(['daisies', 'el-sur']);
    expect(all.body.page.hasMore).toBe(false);

    const byYear = await request(app).get('/titles?year=1966').expect(200);
    expect(byYear.body.items).toHaveLength(1);

    const bySearch = await request(app).get('/titles?search=sur').expect(200);
    expect(bySearch.body.items[0].slug).toBe('el-sur');
  });

  it('pages the catalogue with a cursor', async () => {
    for (const slug of ['a-one', 'b-two', 'c-three']) {
       
      await makeTitle({ slug, rightsHolder: holder._id });
    }

    const first = await request(app).get('/titles?limit=2').expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.page.hasMore).toBe(true);

    const second = await request(app)
      .get(`/titles?limit=2&cursor=${encodeURIComponent(first.body.page.nextCursor)}`)
      .expect(200);
    expect(second.body.items.map((t) => t.slug)).toEqual(['c-three']);
  });

  it('edits the descriptive fields only', async () => {
    const created = await request(app).post('/titles').send(body()).expect(201);

    const res = await request(app)
      .patch(`/titles/${created.body.id}`)
      .send({ runtimeMinutes: 192, synopsis: 'Two women, one house, one sweet.' })
      .expect(200);

    expect(res.body.runtimeMinutes).toBe(192);
    expect(res.body.slug).toBe('celine-and-julie-go-boating-1974');
  });

  it('refuses an empty patch', async () => {
    const created = await request(app).post('/titles').send(body()).expect(201);

    await request(app).patch(`/titles/${created.body.id}`).send({}).expect(400);
  });

  it('moves a title to bookable and then withdraws it with a reason', async () => {
    const created = await request(app).post('/titles').send(body()).expect(201);

    const bookable = await request(app)
      .put(`/titles/${created.body.id}/status`)
      .send({ status: 'bookable' })
      .expect(200);
    expect(bookable.body.status).toBe('bookable');

    const withdrawn = await request(app)
      .put(`/titles/${created.body.id}/status`)
      .send({ status: 'withdrawn', reason: 'licence lapsed' })
      .expect(200);
    expect(withdrawn.body.withdrawnReason).toBe('licence lapsed');
  });

  it('will not withdraw without a reason, or go back to draft', async () => {
    const created = await request(app).post('/titles').send(body()).expect(201);
    await request(app)
      .put(`/titles/${created.body.id}/status`)
      .send({ status: 'bookable' })
      .expect(200);

    await request(app)
      .put(`/titles/${created.body.id}/status`)
      .send({ status: 'withdrawn' })
      .expect(422);

    const back = await request(app)
      .put(`/titles/${created.body.id}/status`)
      .send({ status: 'draft' })
      .expect(422);
    expect(back.body.error.message).toMatch(/withdraw it instead/);
  });

  it('will not edit a withdrawn title', async () => {
    const created = await request(app).post('/titles').send(body()).expect(201);
    await request(app)
      .put(`/titles/${created.body.id}/status`)
      .send({ status: 'withdrawn', reason: 'lost' })
      .expect(200);

    await request(app).patch(`/titles/${created.body.id}`).send({ runtimeMinutes: 10 }).expect(422);
  });
});
