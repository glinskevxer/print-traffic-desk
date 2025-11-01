'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { findOperatorKey } = require('../../../src/http/middleware/security');
const { makeRightsHolder } = require('../../helpers/factories');

describe('what the desk lets through the door', () => {
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

  it('sends a policy that allows nothing, because an api loads nothing', async () => {
    const res = await request(app).get('/health/live').expect(200);

    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('refuses to be framed and refuses to be sniffed', async () => {
    const res = await request(app).get('/health/live').expect(200);

    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('asks for https on every later visit', async () => {
    const res = await request(app).get('/health/live').expect(200);

    expect(res.headers['strict-transport-security']).toMatch(/max-age=15552000/);
  });

  it('answers a known origin with the header', async () => {
    const res = await request(app)
      .get('/health/live')
      .set('origin', 'https://desk.archive.test')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('https://desk.archive.test');
  });

  it('refuses an origin it does not know', async () => {
    const res = await request(app)
      .get('/health/live')
      .set('origin', 'https://somewhere.else.test')
      .expect(403);

    expect(res.body.error.message).toMatch(/not an origin this desk answers/);
  });

  it('answers a call with no origin at all, which is every server to server call', async () => {
    const res = await request(app).get('/health/live').expect(200);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a body carrying a query operator', async () => {
    const holder = await makeRightsHolder();

    const res = await request(app)
      .post('/titles')
      .send({ title: { $ne: null }, year: 1966, rightsHolderId: holder.publicId })
      .expect(400);

    expect(res.body.error.details.issues[0].key).toBe('title.$ne');
  });

  it('refuses an operator buried in an array', async () => {
    const res = await request(app)
      .post('/titles')
      .send({ credits: [{ name: { $gt: '' }, role: 'director' }] })
      .expect(400);

    expect(res.body.error.details.issues[0].key).toBe('credits.0.name.$gt');
  });

  it('lets an ordinary body through', async () => {
    const holder = await makeRightsHolder();

    await request(app)
      .post('/titles')
      .send({ title: 'Daisies', year: 1966, rightsHolderId: holder.publicId })
      .expect(201);
  });

  it('finds an operator key wherever it is, and stops at a sensible depth', () => {
    expect(findOperatorKey({ a: { b: { $where: 1 } } }, [], 12)).toBe('a.b.$where');
    expect(findOperatorKey({ a: 1, b: 'two' }, [], 12)).toBeNull();
    expect(findOperatorKey(null, [], 12)).toBeNull();
    expect(findOperatorKey({ a: { b: { c: { $ne: 1 } } } }, [], 1)).toBeNull();
  });

  it('never advertises what it runs on', async () => {
    const res = await request(app).get('/health/live').expect(200);

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers.server).toBeUndefined();
  });
});
