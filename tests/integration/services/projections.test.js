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

describe('what a list leaves out', () => {
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
      provenance: 'bought from a collector in 1974, rewound onto polyester cores in 1998',
    });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
  });

  it('leaves the provenance off a shelf listing and keeps it on the print', async () => {
    const list = await request(app).get('/elements').expect(200);
    expect(list.body.items[0].provenance).toBeUndefined();
    expect(list.body.items[0].barcode).toBe(element.barcode);

    const one = await request(app).get(`/elements/${element.publicId}`).expect(200);
    expect(one.body.provenance).toMatch(/bought from a collector/);
  });

  it('leaves the rule outcomes off a diary and keeps them on the booking', async () => {
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });

    const diary = await request(app).get('/bookings').expect(200);
    expect(diary.body.items[0].clearance.outcomes).toBeUndefined();
    expect(diary.body.items[0].clearance.windowId).toBeTruthy();

    const one = await request(app).get(`/bookings/${booking.publicId}`).expect(200);
    expect(one.body.clearance.outcomes.length).toBeGreaterThan(5);
  });

  it('leaves the findings off a condition history and keeps them on the report', async () => {
    const { report } = await inspections.recordInspection(element.publicId, {
      inspector: 'R. Fitzgerald',
      kind: 'routine',
      findings: [{ reel: 1, code: 'SPLICE-TAPE', severity: 'minor' }],
    });

    const history = await request(app).get(`/elements/${element.publicId}/inspections`).expect(200);
    expect(history.body.items[0].findings).toBeUndefined();
    expect(history.body.items[0].assessment.grade).toBe('A');
    expect(history.body.items[0].assessment.reasons).toBeUndefined();

    const one = await request(app).get(`/inspections/${report.publicId}`).expect(200);
    expect(one.body.findings).toHaveLength(1);
    expect(one.body.assessment.reasons.length).toBeGreaterThan(0);
  });

  it('still pages correctly with a projection on', async () => {
    for (let i = 0; i < 3; i += 1) {
      await makePrintElement({ title: title._id, owner: holder._id });
    }

    const first = await request(app).get('/elements?limit=2').expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.page.hasMore).toBe(true);

    const second = await request(app)
      .get(`/elements?limit=2&cursor=${encodeURIComponent(first.body.page.nextCursor)}`)
      .expect(200);
    expect(second.body.items.length).toBeGreaterThan(0);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  });
});
