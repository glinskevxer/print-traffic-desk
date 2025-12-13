'use strict';

const express = require('express');
const request = require('supertest');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { idempotency } = require('../../../src/http/middleware/idempotency');
const { errorHandler } = require('../../../src/http/middleware/errorHandler');
const { createLogger } = require('../../../src/lib/logger');

function buildApp({ required = false } = {}) {
  const app = express();
  const log = createLogger({ level: 'silent' });
  let calls = 0;

  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = log;
    req.id = 'req-test';
    next();
  });
  app.post('/things', idempotency({ required }), (req, res) => {
    calls += 1;
    res.status(201).json({ created: calls, echo: req.body });
  });
  app.post('/failures', idempotency(), (_req, res) => {
    calls += 1;
    res.status(422).json({ error: { code: 'unprocessable', message: 'no' } });
  });
  app.use(errorHandler());

  return { app, handlerCalls: () => calls };
}

describe('idempotent writes', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('lets a request through when no key is offered', async () => {
    const { app, handlerCalls } = buildApp();

    await request(app).post('/things').send({ a: 1 }).expect(201);
    await request(app).post('/things').send({ a: 1 }).expect(201);

    expect(handlerCalls()).toBe(2);
  });

  it('insists on a key where the endpoint demands one', async () => {
    const { app } = buildApp({ required: true });

    const res = await request(app).post('/things').send({ a: 1 }).expect(400);

    expect(res.body.error.details.issues[0].key).toBe('idempotency-key');
  });

  it('refuses a key that is not url safe or long enough', async () => {
    const { app } = buildApp();

    await request(app).post('/things').set('idempotency-key', 'short').send({}).expect(400);
    await request(app)
      .post('/things')
      .set('idempotency-key', 'has spaces here')
      .send({})
      .expect(400);
  });

  it('replays the first answer instead of doing the work twice', async () => {
    const { app, handlerCalls } = buildApp();
    const key = 'venue-desk-000001';

    const first = await request(app).post('/things').set('idempotency-key', key).send({ a: 1 });
    const second = await request(app).post('/things').set('idempotency-key', key).send({ a: 1 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(handlerCalls()).toBe(1);
  });

  it('refuses the same key used for a different request', async () => {
    const { app } = buildApp();
    const key = 'venue-desk-000002';
    await request(app).post('/things').set('idempotency-key', key).send({ a: 1 }).expect(201);

    const res = await request(app)
      .post('/things')
      .set('idempotency-key', key)
      .send({ a: 2 })
      .expect(409);

    expect(res.body.error.message).toMatch(/different request/);
  });

  it('keeps two keys apart', async () => {
    const { app, handlerCalls } = buildApp();

    await request(app).post('/things').set('idempotency-key', 'key-aaaaaaaa').send({}).expect(201);
    await request(app).post('/things').set('idempotency-key', 'key-bbbbbbbb').send({}).expect(201);

    expect(handlerCalls()).toBe(2);
  });

  it('does not remember a refusal, so the caller can fix it and retry', async () => {
    const { app, handlerCalls } = buildApp();
    const key = 'venue-desk-000003';

    await request(app).post('/failures').set('idempotency-key', key).send({}).expect(422);
    await request(app).post('/failures').set('idempotency-key', key).send({}).expect(422);

    expect(handlerCalls()).toBe(2);
  });

  it('stores the answer it will replay', async () => {
    const { app } = buildApp();
    const { IdempotencyRecord } = models();

    await request(app).post('/things').set('idempotency-key', 'venue-desk-000004').send({ a: 9 });

    const record = await IdempotencyRecord.findOne({ key: 'venue-desk-000004' });
    expect(record.state).toBe('completed');
    expect(record.status).toBe(201);
    expect(record.body.echo).toEqual({ a: 9 });
  });

  it('refuses a retry while the first one is still running', async () => {
    const { app } = buildApp();
    const { IdempotencyRecord } = models();
    await IdempotencyRecord.collection.insertOne({
      key: 'venue-desk-000005',
      route: 'POST /things',
      requestHash: 'nomatch',
      state: 'in-flight',
      createdAt: new Date(Date.now() - 5000),
      updatedAt: new Date(Date.now() - 5000),
    });

    const res = await request(app)
      .post('/things')
      .set('idempotency-key', 'venue-desk-000005')
      .send({ a: 1 })
      .expect(409);

    expect(res.body.error.message).toMatch(/different request|already being processed/);
  });
});
