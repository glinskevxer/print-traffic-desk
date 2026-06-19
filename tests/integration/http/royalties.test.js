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

describe('royalty statement endpoints', () => {
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
    holder = await makeRightsHolder({ name: 'Park Circus', settlementDays: 30 });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable', slug: 'daisies' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE', seats: 288 });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500 },
    });
  });

  async function settledScreening(localDate) {
    await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate,
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    await bookings.confirmBooking(booking.publicId);
    await bookings.reportBoxOffice(booking.publicId, {
      grossMinor: 184000,
      currency: 'GBP',
      admissions: 210,
    });
    await bookings.settleBooking(booking.publicId, '2025-07-01');
    return booking;
  }

  const period = () => ({
    rightsHolderId: holder.publicId,
    periodStartsOn: '2025-06-01',
    periodEndsOn: '2025-06-30',
  });

  it('builds a statement from the settled screenings', async () => {
    await settledScreening('2025-06-20');

    const res = await request(app).post('/royalty-statements').send(period()).expect(201);

    expect(res.body.id).toMatch(/^stmt_/);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.totalMinor).toBe(64400);
  });

  it('refuses a period that ends before it starts', async () => {
    const res = await request(app)
      .post('/royalty-statements')
      .send({ ...period(), periodEndsOn: '2025-05-01' })
      .expect(400);

    expect(res.body.error.details.issues[0].key).toBe('periodEndsOn');
  });

  it('refuses a second statement for the same period', async () => {
    await request(app).post('/royalty-statements').send(period()).expect(201);

    await request(app).post('/royalty-statements').send(period()).expect(409);
  });

  it('issues and then records payment', async () => {
    await settledScreening('2025-06-20');
    const created = await request(app).post('/royalty-statements').send(period()).expect(201);

    const issued = await request(app)
      .put(`/royalty-statements/${created.body.id}/issue`)
      .send({ issuedOn: '2025-07-05' })
      .expect(200);
    expect(issued.body.dueOn).toBe('2025-08-04');

    const paid = await request(app)
      .put(`/royalty-statements/${created.body.id}/payment`)
      .send({ paidOn: '2025-08-01', paymentReference: 'BACS-99213' })
      .expect(200);
    expect(paid.body.status).toBe('paid');
  });

  it('hands a distributor the statement as csv', async () => {
    await settledScreening('2025-06-20');
    const created = await request(app).post('/royalty-statements').send(period()).expect(201);

    const res = await request(app)
      .get(`/royalty-statements/${created.body.id}/export.csv`)
      .expect(200)
      .expect('content-type', 'text/csv; charset=utf-8');

    const [header, first] = res.text.trim().split('\r\n');
    expect(header).toBe('booking,title,venue,date,admissions,gross,royalty,basis');
    expect(first).toContain('daisies,GB-LON-PRINCE,2025-06-20,210,1840.00,644.00');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=/);
  });

  it('voids a statement with a reason', async () => {
    const created = await request(app).post('/royalty-statements').send(period()).expect(201);

    const res = await request(app)
      .delete(`/royalty-statements/${created.body.id}`)
      .send({ reason: 'built against the wrong terms' })
      .expect(200);

    expect(res.body.status).toBe('void');
  });

  it('lists the statements that are overdue', async () => {
    await settledScreening('2025-06-20');
    const created = await request(app).post('/royalty-statements').send(period()).expect(201);
    await request(app)
      .put(`/royalty-statements/${created.body.id}/issue`)
      .send({ issuedOn: '2025-07-05' })
      .expect(200);

    const res = await request(app).get('/royalty-statements?overdueAsOf=2025-09-01').expect(200);

    expect(res.body.items).toHaveLength(1);
  });

  it('answers 404 for a statement that is not there', async () => {
    await request(app).get('/royalty-statements/stmt_0000000000000000').expect(404);
  });
});

describe('correcting a statement that has gone out', () => {
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
    holder = await makeRightsHolder({ name: 'Park Circus', settlementDays: 30 });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable', slug: 'daisies' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE', seats: 288 });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500 },
    });
  });

  async function settledScreening(localDate) {
    await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate,
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    await bookings.confirmBooking(booking.publicId);
    await bookings.reportBoxOffice(booking.publicId, {
      grossMinor: 184000,
      currency: 'GBP',
      admissions: 210,
    });
    await bookings.settleBooking(booking.publicId, '2025-07-01');
    return booking;
  }

  async function issued() {
    const created = await request(app)
      .post('/royalty-statements')
      .send({
        rightsHolderId: holder.publicId,
        periodStartsOn: '2025-06-01',
        periodEndsOn: '2025-06-30',
      })
      .expect(201);
    await request(app)
      .put(`/royalty-statements/${created.body.id}/issue`)
      .send({ issuedOn: '2025-07-05' })
      .expect(200);
    return created.body;
  }

  it('reverses every line into a credit note that adds up', async () => {
    await settledScreening('2025-06-20');
    await settledScreening('2025-06-21');
    const statement = await issued();

    const res = await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({ reason: 'the licence was the wrong one', issuedOn: '2025-07-20' })
      .expect(201);

    expect(res.body.totalMinor).toBe(-128800);
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.lines[0].basis).toMatch(/^credit: /);
    expect(res.body.credits).toBe(statement.id);
    expect(res.body.dueOn).toBe('2025-08-19');
  });

  it('leaves the statement it corrects exactly as it was', async () => {
    await settledScreening('2025-06-20');
    const statement = await issued();

    await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({ reason: 'wrong terms', issuedOn: '2025-07-20' })
      .expect(201);

    const reread = await request(app).get(`/royalty-statements/${statement.id}`).expect(200);
    expect(reread.body.totalMinor).toBe(64400);
    expect(reread.body.status).toBe('credited');
    expect(reread.body.creditedBy).toBeTruthy();
  });

  it('credits only the lines it was asked to', async () => {
    const first = await settledScreening('2025-06-20');
    await settledScreening('2025-06-21');
    const statement = await issued();

    const res = await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({
        reason: 'that night was cancelled and reported anyway',
        issuedOn: '2025-07-20',
        lines: [first.reference],
      })
      .expect(201);

    expect(res.body.lines).toHaveLength(1);
    expect(res.body.totalMinor).toBe(-64400);
  });

  it('refuses to credit lines that are not on the statement', async () => {
    await settledScreening('2025-06-20');
    const statement = await issued();

    const res = await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({ reason: 'wrong', issuedOn: '2025-07-20', lines: ['BK-2099-001-0000'] })
      .expect(422);

    expect(res.body.error.message).toMatch(/none of those bookings/);
  });

  it('refuses a credit note on a draft', async () => {
    const created = await request(app)
      .post('/royalty-statements')
      .send({
        rightsHolderId: holder.publicId,
        periodStartsOn: '2025-06-01',
        periodEndsOn: '2025-06-30',
      })
      .expect(201);

    await request(app)
      .post(`/royalty-statements/${created.body.id}/credit-note`)
      .send({ reason: 'wrong', issuedOn: '2025-07-20' })
      .expect(422);
  });

  it('refuses without a reason', async () => {
    await settledScreening('2025-06-20');
    const statement = await issued();

    await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({ issuedOn: '2025-07-20' })
      .expect(400);
  });

  it('will not credit the same statement twice', async () => {
    await settledScreening('2025-06-20');
    const statement = await issued();
    await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({ reason: 'wrong', issuedOn: '2025-07-20' })
      .expect(201);

    await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({ reason: 'wrong again', issuedOn: '2025-07-21' })
      .expect(409);
  });

  it('will not credit a credit note', async () => {
    await settledScreening('2025-06-20');
    const statement = await issued();
    const note = await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({ reason: 'wrong', issuedOn: '2025-07-20' })
      .expect(201);

    await request(app)
      .post(`/royalty-statements/${note.body.id}/credit-note`)
      .send({ reason: 'and again', issuedOn: '2025-07-21' })
      .expect(422);
  });

  it('lets the period be stated again once the first one is credited', async () => {
    await settledScreening('2025-06-20');
    const statement = await issued();
    await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({ reason: 'wrong terms', issuedOn: '2025-07-20' })
      .expect(201);

    await request(app)
      .post('/royalty-statements')
      .send({
        rightsHolderId: holder.publicId,
        periodStartsOn: '2025-06-01',
        periodEndsOn: '2025-06-30',
      })
      .expect(201);
  });

  it('says what it reversed and why', async () => {
    await settledScreening('2025-06-20');
    const statement = await issued();
    await request(app)
      .post(`/royalty-statements/${statement.id}/credit-note`)
      .send({ reason: 'the box office was restated', issuedOn: '2025-07-20' })
      .expect(201);

    const trail = await request(app)
      .get(`/audit-events/royalty-statement/${statement.id}`)
      .expect(200);

    const credited = trail.body.items.find((event) => event.action === 'statement.credited');
    expect(credited.metadata).toMatchObject({ reversedLines: 1, totalMinor: -64400 });
  });
});
