'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { registry } = require('../../../src/lib/metrics');
const {
  makePrintElement,
  makeTitle,
  makeVenue,
  makeRightsHolder,
  makeRightsWindow,
} = require('../../helpers/factories');
const { models } = require('../../../src/models');
const bookings = require('../../../src/services/bookingService');

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

describe('the booking funnel', () => {
  let app;
  let holder;
  let title;
  let venue;
  let vault;

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
    holder = await makeRightsHolder({ name: 'Park Circus' });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE' });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
  });

  async function shelve() {
    return makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
  }

  const ask = (overrides = {}) => ({
    titleId: title.publicId,
    venueId: venue.publicId,
    localDate: '2025-06-20',
    localTime: '19:30',
    exhibitionType: 'repertory',
    today: '2025-05-15',
    ...overrides,
  });

  it('counts a hold and then a confirmation, by house', async () => {
    await shelve();
    const { booking } = await bookings.requestBooking(ask());
    await bookings.confirmBooking(booking.publicId);

    const res = await request(app).get('/metrics').expect(200);

    expect(res.text).toContain('printdesk_bookings_held_total{venue="GB-LON-PRINCE"} 1');
    expect(res.text).toContain('printdesk_bookings_confirmed_total{venue="GB-LON-PRINCE"} 1');
  });

  it('counts a refusal against the rule that refused it', async () => {
    await shelve();
    await models().RightsWindow.updateMany({}, { $set: { territory: 'FR' } });

    await bookings.requestBooking(ask()).catch(() => {});

    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toContain('printdesk_bookings_refused_total{rule="territory"} 1');
  });

  it('counts a refusal for having no print anybody can run', async () => {
    await bookings.requestBooking(ask()).catch(() => {});

    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toContain('printdesk_bookings_refused_total{rule="no-print"} 1');
  });

  it('counts a hold that lapsed', async () => {
    await shelve();
    const { booking } = await bookings.requestBooking(ask());
    booking.holdExpiresAt = new Date(Date.now() - 1000);
    await booking.save();

    await bookings.lapseExpiredHolds();

    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toContain('printdesk_bookings_lapsed_total 1');
  });

  it('exports the counters even before anything has happened', async () => {
    const res = await request(app).get('/metrics').expect(200);

    expect(res.text).toContain('# TYPE printdesk_bookings_held_total counter');
    expect(res.text).toContain('# TYPE printdesk_extraction_tokens_total counter');
  });
});
