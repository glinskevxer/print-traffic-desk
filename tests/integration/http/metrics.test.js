'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { registry } = require('../../../src/lib/metrics');
const { makePrintElement, makeTitle } = require('../../helpers/factories');

describe('what the desk exports to be scraped', () => {
  let app;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    registry.reset();
  });

  it('answers in the text format a scraper reads', async () => {
    const res = await request(app).get('/metrics').expect(200);

    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-type']).toMatch(/version=0\.0\.4/);
  });

  it('counts the requests it has answered by route and status', async () => {
    await request(app).get('/titles').expect(200);
    await request(app).get('/titles/ttl_0000000000000000').expect(404);

    const res = await request(app).get('/metrics').expect(200);

    expect(res.text).toContain('printdesk_requests_total');
    expect(res.text).toMatch(/route="\/titles\/:id",status="404"/);
  });

  it('groups by the route pattern, not by the id in the path', async () => {
    await makeTitle({ slug: 'daisies' });
    await request(app).get('/titles/ttl_0000000000000001').expect(404);
    await request(app).get('/titles/ttl_0000000000000002').expect(404);

    const res = await request(app).get('/metrics').expect(200);

    expect(res.text).not.toContain('ttl_0000000000000001');
    expect(res.text).toMatch(/route="\/titles\/:id",status="404"\} 2/);
  });

  it('times what it answered', async () => {
    await request(app).get('/titles').expect(200);

    const res = await request(app).get('/metrics').expect(200);

    expect(res.text).toContain('printdesk_request_duration_ms_bucket');
    expect(res.text).toContain('printdesk_request_duration_ms_count');
  });

  it('reads the desk gauges out of the database at scrape time', async () => {
    await makePrintElement({ status: 'quarantined' });

    const res = await request(app).get('/metrics').expect(200);

    expect(res.text).toContain('printdesk_elements_quarantined 1');
    expect(res.text).toContain('printdesk_bookings_held 0');
    expect(res.text).toContain('printdesk_shipments_open 0');
    expect(res.text).toContain('printdesk_extractions_awaiting_review 0');
  });

  it('is open, because a scraper does not sign in', async () => {
    const { app: unauthenticated } = buildTestApp({ operator: null });

    await request(unauthenticated).get('/metrics').expect(200);
  });
});
