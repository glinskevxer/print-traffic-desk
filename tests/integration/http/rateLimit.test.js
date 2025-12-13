'use strict';

const request = require('supertest');
const { buildTestApp, stubOperator } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { windowStart, countRequest } = require('../../../src/http/middleware/rateLimit');

const limits = { windowMs: 60000, max: 3, signInMax: 2 };

describe('holding a caller to a rate', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('buckets a moment into its window', () => {
    expect(windowStart(Date.parse('2025-06-20T10:00:30Z'), 60000).toISOString()).toBe(
      '2025-06-20T10:00:00.000Z',
    );
    expect(windowStart(Date.parse('2025-06-20T10:00:59Z'), 60000).toISOString()).toBe(
      '2025-06-20T10:00:00.000Z',
    );
  });

  it('counts one caller across processes, not per process', async () => {
    const now = Date.now();

    await countRequest({ key: 'op:one', now, windowMs: 60000 });
    const second = await countRequest({ key: 'op:one', now, windowMs: 60000 });

    expect(second.count).toBe(2);
    expect(await models().RateCounter.countDocuments()).toBe(1);
  });

  it('starts again in the next window', async () => {
    const now = Date.now();
    await countRequest({ key: 'op:one', now, windowMs: 60000 });

    const next = await countRequest({ key: 'op:one', now: now + 60000, windowMs: 60000 });

    expect(next.count).toBe(1);
  });

  it('tells every answer how much is left', async () => {
    const { app } = buildTestApp({ limits });

    const res = await request(app).get('/titles').expect(200);

    expect(res.headers['ratelimit-limit']).toBe('3');
    expect(res.headers['ratelimit-remaining']).toBe('2');
    expect(Number(res.headers['ratelimit-reset'])).toBeGreaterThan(0);
  });

  it('refuses once the window is used up and says when to come back', async () => {
    const { app } = buildTestApp({ limits });

    for (let call = 0; call < 3; call += 1) {
      await request(app).get('/titles').expect(200);
    }

    const res = await request(app).get('/titles').expect(429);

    expect(res.body.error.code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts two operators separately', async () => {
    const one = buildTestApp({ limits, operator: stubOperator({ role: 'admin' }) }).app;
    const two = buildTestApp({
      limits,
      operator: { ...stubOperator({ role: 'admin' }), publicId: 'op_SECONDOPERATOR' },
    }).app;

    for (let call = 0; call < 3; call += 1) {
      await request(one).get('/titles').expect(200);
    }

    await request(two).get('/titles').expect(200);
  });

  it('holds sign in to a tighter limit of its own', async () => {
    const { app } = buildTestApp({ limits });

    await request(app).post('/auth/sign-in').send({ email: 'a@b.test', password: 'x' });
    await request(app).post('/auth/sign-in').send({ email: 'a@b.test', password: 'x' });

    const res = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'a@b.test', password: 'x' })
      .expect(429);

    expect(res.body.error.code).toBe('rate_limited');
  });

  it('leaves health alone whatever the caller is doing', async () => {
    const { app } = buildTestApp({ limits });

    for (let call = 0; call < 6; call += 1) {
      await request(app).get('/health/live').expect(200);
    }
  });

  it('does not run at all when no limits are configured', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/titles').expect(200);

    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });
});
