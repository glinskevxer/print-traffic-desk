'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { openTestConnection, closeTestConnection } = require('../../helpers/db');

describe('health endpoints', () => {
  afterEach(async () => {
    await closeTestConnection();
  });

  it('is live before the database is connected', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/health/live').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('is not ready until the database is connected', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/health/ready').expect(503);

    expect(res.body).toEqual({ status: 'not-ready', checks: { mongo: 'disconnected' } });
  });

  it('is ready once the database answers a ping', async () => {
    await openTestConnection();
    const { app } = buildTestApp();

    const res = await request(app).get('/health/ready').expect(200);

    expect(res.body.status).toBe('ready');
    expect(res.body.checks.mongo).toBe('ok');
    expect(typeof res.body.roundTripMs).toBe('number');
  });

  it('reports the version and the node it runs on', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/health/version').expect(200);

    expect(res.body.service).toBe('printdesk');
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(res.body.node).toBe(process.version);
  });

  it('echoes a request id back and logs against it', async () => {
    const { app, lines } = buildTestApp();

    const res = await request(app).get('/health/live').set('x-request-id', 'venue-desk-0042');

    expect(res.headers['x-request-id']).toBe('venue-desk-0042');
    const finished = lines.find((line) => line.msg === 'request finished');
    expect(finished.requestId).toBe('venue-desk-0042');
    expect(finished.status).toBe(200);
  });

  it('mints its own request id when the caller sends nonsense', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/health/live').set('x-request-id', 'x');

    expect(res.headers['x-request-id']).not.toBe('x');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers an unknown route with the desk not found shape', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/health/nothing-here').expect(404);

    expect(res.body.error.code).toBe('not_found');
    expect(res.body.error.details.resource).toBe('route');
    expect(res.body.error.details.identifier).toBe('GET /health/nothing-here');
  });

  it('refuses a body that is not json', async () => {
    const { app } = buildTestApp();

    const res = await request(app)
      .post('/health/live')
      .set('content-type', 'application/json')
      .send('{ not json')
      .expect(400);

    expect(res.body.error.code).toBe('validation_failed');
  });

  it('refuses a body bigger than the desk accepts', async () => {
    const { app } = buildTestApp({ bodyLimit: '1kb' });

    const res = await request(app)
      .post('/health/live')
      .send({ blob: 'x'.repeat(4000) })
      .expect(413);

    expect(res.body.error.message).toMatch(/larger than the desk accepts/);
  });

  it('never advertises express', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/health/live');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('the published description of the api', () => {
  it('is readable without a token', async () => {
    const { app } = buildTestApp({ operator: null });

    const res = await request(app).get('/health/openapi.json').expect(200);

    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.paths['/bookings']).toBeDefined();
  });

  it('names the host it was fetched from as the server', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/health/openapi.json').expect(200);

    expect(res.body.servers[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
