'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { fakeClient, LICENCE_ANSWER } = require('../../helpers/fakeOpenAi');
const { resetConfigForTests } = require('../../../src/config/env');
const extraction = require('../../../src/services/extractionService');
const { parseCsv } = require('../../../src/lib/csv');

/**
 * One season, end to end, over http only.
 *
 * Every other integration file tests one service. This one is the walk a
 * programmer actually does: catalogue the film, read the licence letter,
 * shelve a print, ask where it can play, book it, ship it, take the money and
 * send the statement. It is slow and it has caught three defects the focused
 * tests could not, all of them at a seam between two services.
 */
describe('a season from catalogue to statement', () => {
  let app;
  let client;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
    extraction.useClient(null);
    resetConfigForTests();
  });

  beforeEach(async () => {
    await clearCollections();
    process.env.EXTRACTION_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-test-0000000000000000000';
    resetConfigForTests();
    client = fakeClient();
    extraction.useClient(client);
  });

  const LETTER = [
    'We confirm the licence of DAISIES for repertory exhibition in the United',
    'Kingdom from 1 January 2025 to 31 December 2025 at 35% of the gross.',
  ].join(' ');

  it('walks the whole desk', async () => {
    // The licensor and the film.
    const holder = await request(app)
      .post('/rights-holders')
      .send({
        name: 'Park Circus',
        kind: 'distributor',
        territoriesRepresented: ['GB'],
        contacts: [{ name: 'Bookings', email: 'bookings@parkcircus.test' }],
        remittanceCurrency: 'GBP',
        settlementDays: 30,
      })
      .expect(201);

    const title = await request(app)
      .post('/titles')
      .send({
        title: 'Daisies',
        year: 1966,
        countries: ['CZ'],
        runtimeMinutes: 74,
        credits: [{ name: 'Vera Chytilova', role: 'director' }],
        rightsHolderId: holder.body.id,
      })
      .expect(201);

    await request(app)
      .put(`/titles/${title.body.id}/status`)
      .send({ status: 'bookable' })
      .expect(200);

    // The houses, taken from the spreadsheet the archive keeps.
    await request(app)
      .post('/venues/import')
      .send({
        csv:
          'code,name,territory,city,timezone,line1,postcode,seats,currency,gauges,soundFormats\n' +
          'GB-LON-PRINCE,Prince Charles Cinema,GB,London,Europe/London,7 Leicester Place,WC2H 7BY,288,GBP,35mm,optical-mono\n' +
          'GB-BER-VAULT,Berkhamsted Film Store,GB,Berkhamsted,Europe/London,1 Vault Way,HP4 1AA,1,GBP,35mm,optical-mono\n',
      })
      .expect(201);

    const venues = await request(app).get('/venues').expect(200);
    const prince = venues.body.items.find((venue) => venue.code === 'GB-LON-PRINCE');
    const vault = venues.body.items.find((venue) => venue.code === 'GB-BER-VAULT');

    // The licence, read off the letter and then activated by a person.
    client.answerWith({ ...LICENCE_ANSWER, confidence: 0.94 });
    const reading = await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.body.id, contractText: LETTER })
      .expect(201);
    expect(reading.body.needsHumanReview).toBe(false);

    const applied = await request(app)
      .put(`/extractions/${reading.body.id}/apply`)
      .send({ reviewedBy: 'rights@archive.test' })
      .expect(200);
    expect(applied.body.rightsWindow.status).toBe('draft');

    await request(app).put(`/rights-windows/${applied.body.rightsWindow.id}/activate`).expect(200);

    // The print, catalogued and inspected into circulation.
    const element = await request(app)
      .post('/elements')
      .send({
        barcode: 'PE-770001',
        titleId: title.body.id,
        ownerId: holder.body.id,
        custodianId: vault.id,
        kind: 'release-print',
        gauge: '35mm',
        baseStock: 'polyester',
        aspectRatio: '1.37:1',
        soundFormat: 'optical-mono',
        footage: 6660,
        reelCount: 4,
      })
      .expect(201);
    expect(element.body.status).toBe('intake');

    const inspected = await request(app)
      .post(`/elements/${element.body.id}/inspections`)
      .send({
        inspector: 'R. Fitzgerald',
        kind: 'intake',
        findings: [{ reel: 2, code: 'SPLICE-TAPE', severity: 'minor' }],
      })
      .expect(201);
    expect(inspected.body.element.status).toBe('available');
    expect(inspected.body.assessment.grade).toBe('A');

    // Where could it play.
    const availability = await request(app)
      .get(`/titles/${title.body.id}/availability?localDate=2025-06-20&today=2025-05-15`)
      .expect(200);
    const offer = availability.body.houses.find((house) => house.venue.code === 'GB-LON-PRINCE');
    expect(offer.available).toBe(true);
    expect(offer.print.barcode).toBe('PE-770001');

    // Book it, confirm it, ship it.
    const booking = await request(app)
      .post('/bookings')
      .set('idempotency-key', 'prince-desk-000042')
      .send({
        titleId: title.body.id,
        venueId: prince.id,
        localDate: '2025-06-20',
        localTime: '19:30',
        exhibitionType: 'repertory',
        today: '2025-05-15',
      })
      .expect(201);
    expect(booking.body.status).toBe('held');

    const confirmed = await request(app)
      .put(`/bookings/${booking.body.id}/confirm`)
      .send({ confirmedBy: 'programmer@prince.test' })
      .expect(200);
    const outbound = confirmed.body.shipments.find((leg) => leg.leg === 'outbound');

    await request(app)
      .put(`/shipments/${outbound.id}/dispatch`)
      .send({ dispatchedOn: '2025-06-17', carrier: 'Film Freight', trackingReference: 'FF-7712' })
      .expect(200);

    const landed = await request(app)
      .put(`/shipments/${outbound.id}/arrival`)
      .send({
        arrivedOn: '2025-06-19',
        arrivalCheck: { checkedBy: 'A. Novak', cansReceived: 4, sealsIntact: true },
      })
      .expect(200);
    expect(landed.body.element.status).toBe('on-loan');

    // The takings, the royalty and the statement.
    const reported = await request(app)
      .put(`/bookings/${booking.body.id}/box-office`)
      .send({ grossMinor: 184000, currency: 'GBP', admissions: 210 })
      .expect(200);
    expect(reported.body.royalty.amountMinor).toBe(64400);
    expect(reported.body.royalty.basis).toBe('35% of the gross');

    await request(app)
      .put(`/bookings/${booking.body.id}/settle`)
      .send({ settledOn: '2025-07-01' })
      .expect(200);

    const statement = await request(app)
      .post('/royalty-statements')
      .send({
        rightsHolderId: holder.body.id,
        periodStartsOn: '2025-06-01',
        periodEndsOn: '2025-06-30',
      })
      .expect(201);
    expect(statement.body.totalMinor).toBe(64400);

    const issued = await request(app)
      .put(`/royalty-statements/${statement.body.id}/issue`)
      .send({ issuedOn: '2025-07-05' })
      .expect(200);
    expect(issued.body.dueOn).toBe('2025-08-04');

    const csv = await request(app)
      .get(`/royalty-statements/${statement.body.id}/export.csv`)
      .expect(200);
    const { rows } = parseCsv(csv.text);
    expect(rows[0]).toMatchObject({
      title: 'daisies-1966',
      venue: 'GB-LON-PRINCE',
      admissions: '210',
      royalty: '644.00',
    });

    // What the print did, and what the desk owes.
    const provenance = await request(app)
      .get(`/elements/${element.body.id}/provenance`)
      .expect(200);
    expect(provenance.body.totals).toMatchObject({ screenings: 1, inspections: 1, legs: 2 });

    const shelf = await request(app).get('/reports/shelf').expect(200);
    expect(shelf.body.total).toBe(1);

    const utilisation = await request(app)
      .get('/reports/licence-utilisation?asOf=2025-07-01')
      .expect(200);
    expect(utilisation.body.windows[0].used).toBe(1);
  });
});
