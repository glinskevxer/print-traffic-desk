'use strict';

const express = require('express');
const request = require('supertest');
const { requestTimeout, limitFor, DEFAULT_MS } = require('../../../src/http/middleware/timeout');
const { errorHandler } = require('../../../src/http/middleware/errorHandler');
const { createLogger } = require('../../../src/lib/logger');

function buildApp({ ms }) {
  const app = express();
  const log = createLogger({ level: 'silent' });
  const seen = [];

  app.use((req, _res, next) => {
    req.log = log;
    req.id = 'req-test';
    next();
  });
  app.use(requestTimeout({ ms }));

  app.get('/quick', (_req, res) => res.json({ ok: true }));
  app.get('/slow', (req, res) => {
    setTimeout(() => {
      seen.push(res.timedOut);
      if (!res.timedOut) res.json({ ok: true });
    }, 120);
  });
  app.use(errorHandler());

  return { app, seen };
}

describe('giving up on a request that will not finish', () => {
  it('answers a quick request normally', async () => {
    const { app } = buildApp({ ms: 500 });

    const res = await request(app).get('/quick').expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('answers a slow one with a 503 the client can retry', async () => {
    const { app } = buildApp({ ms: 30 });

    const res = await request(app).get('/slow').expect(503);

    expect(res.body.error.message).toMatch(/took too long/);
    expect(res.body.error.details.limitMs).toBe(30);
  });

  it('tells the handler it has already been answered', async () => {
    const { app, seen } = buildApp({ ms: 30 });
    await request(app).get('/slow').expect(503);

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(seen).toEqual([true]);
  });

  it('does not answer twice when the handler finishes first', async () => {
    const { app, seen } = buildApp({ ms: 400 });

    await request(app).get('/slow').expect(200);

    expect(seen).toEqual([false]);
  });

  it('gives extraction far longer, because it is waiting on a model', () => {
    expect(limitFor('/extractions/licence-letters', 20000)).toBe(90000);
    expect(limitFor('/royalty-statements', 20000)).toBe(60000);
    expect(limitFor('/bookings', 20000)).toBe(20000);
    expect(limitFor('/titles', DEFAULT_MS)).toBe(DEFAULT_MS);
  });
});
