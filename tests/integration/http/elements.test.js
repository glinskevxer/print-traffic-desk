'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const {
  makeTitle,
  makeVenue,
  makeRightsHolder,
  makePrintElement,
  makeRightsWindow,
} = require('../../helpers/factories');
const bookings = require('../../../src/services/bookingService');
const inspections = require('../../../src/services/inspectionService');

describe('print element endpoints', () => {
  let app;
  let title;
  let venue;
  let owner;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    owner = await makeRightsHolder({ name: 'BFI National Archive', kind: 'archive' });
    title = await makeTitle({ rightsHolder: owner._id });
    venue = await makeVenue({ code: 'GB-LON-PRINCE' });
  });

  const body = (overrides = {}) => ({
    barcode: 'PE-100001',
    titleId: title.publicId,
    ownerId: owner.publicId,
    custodianId: venue.publicId,
    kind: 'release-print',
    gauge: '35mm',
    baseStock: 'polyester',
    aspectRatio: '1.37:1',
    soundFormat: 'optical-mono',
    footage: 12150,
    reelCount: 6,
    ...overrides,
  });

  it('catalogues a print into intake, where it stays until inspected', async () => {
    const res = await request(app).post('/elements').send(body()).expect(201);

    expect(res.body.id).toMatch(/^elem_/);
    expect(res.body.status).toBe('intake');
    expect(res.body.projectionSpeed).toBe(24);
  });

  it('refuses nitrate into a house with no certificate', async () => {
    const res = await request(app)
      .post('/elements')
      .send(body({ baseStock: 'nitrate' }))
      .expect(422);

    expect(res.body.error.message).toMatch(/without a certificate/);
  });

  it('accepts nitrate into a certified house', async () => {
    const vault = await makeVenue({
      code: 'GB-BER-VAULT',
      booth: { gauges: ['35mm'], nitrateCertified: true },
    });

    await request(app)
      .post('/elements')
      .send(body({ baseStock: 'nitrate', custodianId: vault.publicId }))
      .expect(201);
  });

  it('refuses a duplicate barcode', async () => {
    await request(app).post('/elements').send(body()).expect(201);

    const res = await request(app).post('/elements').send(body()).expect(409);
    expect(res.body.error.message).toMatch(/already catalogued/);
  });

  it('refuses a title, owner or custodian that does not exist', async () => {
    await request(app)
      .post('/elements')
      .send(body({ titleId: 'ttl_0000000000000000' }))
      .expect(404);
    await request(app)
      .post('/elements')
      .send(body({ ownerId: 'rh_0000000000000000' }))
      .expect(404);
    await request(app)
      .post('/elements')
      .send(body({ custodianId: 'ven_0000000000000000' }))
      .expect(404);
  });

  it('filters the shelf by title, status, gauge and grade', async () => {
    await makePrintElement({ title: title._id, gauge: '35mm', conditionGrade: 'A' });
    await makePrintElement({ title: title._id, gauge: '16mm', conditionGrade: 'C' });

    const byGauge = await request(app).get('/elements?gauge=16mm').expect(200);
    expect(byGauge.body.items).toHaveLength(1);

    const byGrade = await request(app).get('/elements?grade=A').expect(200);
    expect(byGrade.body.items).toHaveLength(1);

    const byTitle = await request(app).get(`/elements?titleId=${title.publicId}`).expect(200);
    expect(byTitle.body.items).toHaveLength(2);
  });

  it('finds the prints that are overdue an inspection', async () => {
    await makePrintElement({ screeningsSinceInspection: 8, inspectionIntervalScreenings: 6 });
    await makePrintElement({ screeningsSinceInspection: 2, inspectionIntervalScreenings: 6 });

    const res = await request(app).get('/elements?needsInspection=true').expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].screeningsSinceInspection).toBe(8);
  });

  it('moves a print to another shelf', async () => {
    const element = await makePrintElement({ currentLocation: venue._id, status: 'available' });
    const other = await makeVenue({ code: 'GB-LON-BFI' });

    const res = await request(app)
      .put(`/elements/${element.publicId}/location`)
      .send({ venueId: other.publicId, reason: 'returned to the archive vault' })
      .expect(200);

    expect(res.body.provenance).toMatch(/returned to the archive vault/);
  });

  it('will not move a print that is committed', async () => {
    const element = await makePrintElement({ status: 'committed' });
    const other = await makeVenue({ code: 'GB-LON-ICA' });

    const res = await request(app)
      .put(`/elements/${element.publicId}/location`)
      .send({ venueId: other.publicId })
      .expect(422);

    expect(res.body.error.message).toMatch(/cancel the booking/);
  });

  it('walks the status machine and refuses an illegal move', async () => {
    const element = await makePrintElement({ status: 'intake' });

    await request(app)
      .put(`/elements/${element.publicId}/status`)
      .send({ status: 'available' })
      .expect(200);

    const bad = await request(app)
      .put(`/elements/${element.publicId}/status`)
      .send({ status: 'on-loan' })
      .expect(422);
    expect(bad.body.error.details.allowed).toContain('committed');
  });

  it('will not retire a print without a reason', async () => {
    const element = await makePrintElement({ status: 'available' });

    await request(app)
      .put(`/elements/${element.publicId}/status`)
      .send({ status: 'retired' })
      .expect(422);

    await request(app)
      .put(`/elements/${element.publicId}/status`)
      .send({ status: 'retired', reason: 'shrunk beyond use' })
      .expect(200);
  });

  it('answers whether a booth can run a given print', async () => {
    const element = await makePrintElement({
      gauge: '70mm',
      soundFormat: 'magnetic-6track',
      reelCount: 12,
      currentLocation: venue._id,
    });

    const res = await request(app)
      .get(`/elements/${element.publicId}/compatibility/${venue.publicId}`)
      .expect(200);

    expect(res.body.compatible).toBe(false);
    expect(res.body.problems.map((p) => p.rule).sort()).toEqual(['gauge', 'reels', 'sound']);
  });

  it('says a booth is compatible when it really is', async () => {
    const element = await makePrintElement({ currentLocation: venue._id });

    const res = await request(app)
      .get(`/elements/${element.publicId}/compatibility/${venue.publicId}`)
      .expect(200);

    expect(res.body.compatible).toBe(true);
    expect(res.body.playableSound).toBe('optical-mono');
  });
});

describe('where a print has been', () => {
  let app;
  let holder;
  let title;
  let venue;
  let vault;
  let element;

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
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE' });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    element = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
  });

  it('is empty for a print that has never left the shelf', async () => {
    const res = await request(app).get(`/elements/${element.publicId}/provenance`).expect(200);

    expect(res.body.events).toEqual([]);
    expect(res.body.totals).toEqual({ screenings: 0, inspections: 0, legs: 0 });
    expect(res.body.element.home).toBe('GB-BER-VAULT');
  });

  it('lists an inspection with what it graded', async () => {
    await inspections.recordInspection(element.publicId, {
      inspector: 'R. Fitzgerald',
      kind: 'routine',
      inspectedAt: new Date('2025-03-04T10:00:00Z'),
      findings: [{ reel: 1, code: 'PERF-TEAR', severity: 'severe' }],
    });

    const res = await request(app).get(`/elements/${element.publicId}/provenance`).expect(200);

    expect(res.body.totals.inspections).toBe(1);
    expect(res.body.events[0]).toMatchObject({
      at: '2025-03-04',
      kind: 'inspected',
      status: 'projectable-with-restrictions',
    });
    expect(res.body.events[0].detail).toMatch(/graded C/);
  });

  it('lists a leg with where it went', async () => {
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    await bookings.confirmBooking(booking.publicId);

    const res = await request(app).get(`/elements/${element.publicId}/provenance`).expect(200);

    expect(res.body.totals.legs).toBe(2);
    const travelled = res.body.events.find((event) => event.kind === 'travelled');
    expect(travelled.detail).toMatch(/GB-BER-VAULT to GB-LON-PRINCE/);
  });

  it('lists a screening once it is confirmed', async () => {
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    await bookings.confirmBooking(booking.publicId);

    const res = await request(app).get(`/elements/${element.publicId}/provenance`).expect(200);

    const screened = res.body.events.find((event) => event.kind === 'screened');
    expect(screened.reference).toBe(booking.reference);
    expect(screened.detail).toBe('at GB-LON-PRINCE');
  });

  it('leaves a hold nobody confirmed out of the history', async () => {
    await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });

    const res = await request(app).get(`/elements/${element.publicId}/provenance`).expect(200);

    expect(res.body.totals.screenings).toBe(0);
  });

  it('puts the events in the order they happened', async () => {
    await inspections.recordInspection(element.publicId, {
      inspector: 'R. Fitzgerald',
      kind: 'intake',
      inspectedAt: new Date('2025-01-04T10:00:00Z'),
    });
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    await bookings.confirmBooking(booking.publicId);

    const res = await request(app).get(`/elements/${element.publicId}/provenance`).expect(200);

    const dates = res.body.events.map((event) => event.at);
    expect(dates).toEqual([...dates].sort());
    expect(res.body.events[0].kind).toBe('inspected');
  });

  it('answers 404 for a print that is not catalogued', async () => {
    await request(app).get('/elements/elem_0000000000000000/provenance').expect(404);
  });
});
