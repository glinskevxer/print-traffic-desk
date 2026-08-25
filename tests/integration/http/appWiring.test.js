'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { routesOf } = require('../../../src/http/routeTable');

/**
 * The middleware stack, checked from outside.
 *
 * Every one of these is a line in createApp that would go unnoticed if it were
 * deleted: the suite would stay green and the desk would quietly stop refusing
 * something. So each is asserted on a real request rather than by reading the
 * file.
 */
describe('the desk answers with everything in front of it', () => {
  let app;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp({ allowedOrigins: ['https://desk.archive.test'] }));
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('answers a request with an id, and echoes one it was given', async () => {
    const minted = await request(app).get('/titles').expect(200);
    expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const echoed = await request(app).get('/titles').set('x-request-id', 'desk-000042');
    expect(echoed.headers['x-request-id']).toBe('desk-000042');
  });

  it('answers an unknown route as not found rather than as a crash', async () => {
    const res = await request(app).get('/nothing/like/this').expect(404);

    expect(res.body.error.code).toBe('not_found');
    expect(res.body.error.details.identifier).toBe('GET /nothing/like/this');
  });

  it('refuses a body bigger than the desk takes', async () => {
    const { app: small } = buildTestApp({ bodyLimit: '1kb' });

    const res = await request(small)
      .post('/titles')
      .send({ blob: 'x'.repeat(4000) })
      .expect(413);

    expect(res.body.error.message).toMatch(/larger than the desk accepts/);
  });

  it('refuses a body that is not json', async () => {
    const res = await request(app)
      .post('/titles')
      .set('content-type', 'application/json')
      .send('{ not json')
      .expect(400);

    expect(res.body.error.code).toBe('validation_failed');
  });

  it('keeps the security headers on an error as well as an answer', async () => {
    const res = await request(app).get('/titles/ttl_0000000000000000').expect(404);

    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('mounts every router the table declares', () => {
    const paths = routesOf(app).map((route) => route.path);

    for (const prefix of [
      '/titles',
      '/venues',
      '/rights-holders',
      '/elements',
      '/inspections',
      '/rights-windows',
      '/shipments',
      '/bookings',
      '/royalty-statements',
      '/extractions',
      '/audit-events',
      '/reports',
      '/search',
      '/health',
      '/metrics',
      '/auth',
    ]) {
      expect(paths.some((path) => path.startsWith(prefix))).toBe(true);
    }
  });

  it('does not answer with an etag, because nothing here is cacheable', async () => {
    const res = await request(app).get('/titles').expect(200);

    expect(res.headers.etag).toBeUndefined();
  });

  it('answers a refusal with the shape every client learns once', async () => {
    const res = await request(app).get('/titles?limit=5000').expect(400);

    expect(Object.keys(res.body)).toEqual(['error']);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'details', 'message']);
  });
});
