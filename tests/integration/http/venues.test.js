'use strict';

const request = require('supertest');
const { buildTestApp, stubOperator } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const {
  makeVenue,
  makePrintElement,
  makeTitle,
  makeRightsHolder,
  makeRightsWindow,
} = require('../../helpers/factories');
const bookings = require('../../../src/services/bookingService');

describe('venue endpoints', () => {
  let app;

  const body = (overrides = {}) => ({
    code: 'GB-LON-PRINCE',
    name: 'Prince Charles Cinema',
    territory: 'GB',
    city: 'London',
    timezone: 'Europe/London',
    address: { line1: '7 Leicester Place', city: 'London', postcode: 'WC2H 7BY', territory: 'GB' },
    booth: { gauges: ['35mm', '70mm'], soundFormats: ['dolby-sr'], reelCapacity: 8 },
    seats: 288,
    boxOfficeCurrency: 'GBP',
    houseNutMinor: 42000,
    ...overrides,
  });

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('puts a house on file with its booth and its defaults', async () => {
    const res = await request(app).post('/venues').send(body()).expect(201);

    expect(res.body.id).toMatch(/^ven_/);
    expect(res.body.booth.speeds).toEqual([24]);
    expect(res.body.inboundLeadDays).toBe(2);
    expect(res.body.active).toBe(true);
  });

  it('refuses a time zone that is not real', async () => {
    const res = await request(app)
      .post('/venues')
      .send(body({ timezone: 'Europe/Londonderry-ish' }))
      .expect(400);

    expect(res.body.error.message).toMatch(/IANA time zone/);
  });

  it('refuses a shipping address in another territory', async () => {
    const res = await request(app)
      .post('/venues')
      .send(
        body({ address: { line1: '1 Rue', city: 'Paris', postcode: '75001', territory: 'FR' } }),
      )
      .expect(422);

    expect(res.body.error.message).toMatch(/must sit in the venue territory/);
  });

  it('refuses a booth with no gauge at all', async () => {
    await request(app)
      .post('/venues')
      .send(body({ booth: { gauges: [] } }))
      .expect(400);
  });

  it('refuses a second house on the same code', async () => {
    await request(app).post('/venues').send(body()).expect(201);

    const res = await request(app)
      .post('/venues')
      .send(body({ name: 'Other' }))
      .expect(409);

    expect(res.body.error.message).toMatch(/already on file/);
  });

  it('filters the list by territory, gauge and nitrate certificate', async () => {
    await makeVenue({ code: 'GB-LON-BFI', booth: { gauges: ['35mm'], nitrateCertified: true } });
    await makeVenue({
      code: 'FR-PAR-CIN',
      territory: 'FR',
      city: 'Paris',
      address: { line1: '51 Rue de Bercy', city: 'Paris', postcode: '75012', territory: 'FR' },
      timezone: 'Europe/Paris',
      booth: { gauges: ['16mm'] },
    });

    const gb = await request(app).get('/venues?territory=GB').expect(200);
    expect(gb.body.items).toHaveLength(1);

    const sixteen = await request(app).get('/venues?gauge=16mm').expect(200);
    expect(sixteen.body.items[0].code).toBe('FR-PAR-CIN');

    const nitrate = await request(app).get('/venues?nitrateCertified=true').expect(200);
    expect(nitrate.body.items[0].code).toBe('GB-LON-BFI');
  });

  it('edits the address and the lead days', async () => {
    const created = await request(app).post('/venues').send(body()).expect(201);

    const res = await request(app)
      .patch(`/venues/${created.body.id}`)
      .send({ inboundLeadDays: 5, seats: 290 })
      .expect(200);

    expect(res.body.inboundLeadDays).toBe(5);
    expect(res.body.seats).toBe(290);
  });

  it('will not move a house to another territory', async () => {
    const created = await request(app).post('/venues').send(body()).expect(201);

    const res = await request(app)
      .patch(`/venues/${created.body.id}`)
      .send({ address: { line1: '1 Rue', city: 'Paris', postcode: '75001', territory: 'FR' } })
      .expect(422);

    expect(res.body.error.message).toMatch(/retire it instead/);
  });

  it('reports how many prints a booth change strands', async () => {
    const created = await request(app).post('/venues').send(body()).expect(201);
    const venue = await models().Venue.byPublicId(created.body.id);
    const title = await makeTitle();
    await makePrintElement({ title: title._id, gauge: '70mm', currentLocation: venue._id });

    const res = await request(app)
      .put(`/venues/${created.body.id}/booth`)
      .send({ gauges: ['35mm'] })
      .expect(200);

    expect(res.body.booth.gauges).toEqual(['35mm']);
    expect(res.body.strandedElements).toBe(1);
  });

  it('will not retire a house that still holds a committed print', async () => {
    const venue = await makeVenue({ code: 'GB-LON-CLOSE' });
    await makePrintElement({ currentLocation: venue._id, status: 'committed' });

    const res = await request(app)
      .put(`/venues/${venue.publicId}/active`)
      .send({ active: false })
      .expect(422);

    expect(res.body.error.details.holding).toBe(1);
  });

  it('retires a house that holds nothing committed', async () => {
    const venue = await makeVenue({ code: 'GB-LON-QUIET' });

    const res = await request(app)
      .put(`/venues/${venue.publicId}/active`)
      .send({ active: false })
      .expect(200);

    expect(res.body.active).toBe(false);
  });
});

describe('what a house has on', () => {
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
    holder = await makeRightsHolder({ name: 'Park Circus' });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable', slug: 'daisies' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE' });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
      conditionGrade: 'B',
    });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
  });

  async function book(localDate) {
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate,
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    return booking;
  }

  it('is empty for a quiet fortnight', async () => {
    const res = await request(app)
      .get(`/venues/${venue.publicId}/diary?from=2025-06-01&to=2025-06-14`)
      .expect(200);

    expect(res.body.nights).toEqual([]);
    expect(res.body.venue.code).toBe('GB-LON-PRINCE');
  });

  it('lists the night with the title and the print on it', async () => {
    const booking = await book('2025-06-20');

    const res = await request(app)
      .get(`/venues/${venue.publicId}/diary?from=2025-06-01&to=2025-06-30`)
      .expect(200);

    expect(res.body.nights).toHaveLength(1);
    expect(res.body.nights[0].reference).toBe(booking.reference);
    expect(res.body.nights[0].title.slug).toBe('daisies');
    expect(res.body.nights[0].print.grade).toBe('B');
    expect(res.body.nights[0].print.status).toBe('committed');
  });

  it('says whether the leg carrying the print has left', async () => {
    const booking = await book('2025-06-20');
    await bookings.confirmBooking(booking.publicId);

    const res = await request(app)
      .get(`/venues/${venue.publicId}/diary?from=2025-06-01&to=2025-06-30`)
      .expect(200);

    expect(res.body.nights[0].arrival.status).toBe('planned');
    expect(res.body.nights[0].arrival.expected).toBe('2025-06-20');
  });

  it('leaves a cancelled night out', async () => {
    const booking = await book('2025-06-20');
    await bookings.cancelBooking(booking.publicId, { reason: 'programme changed' });

    const res = await request(app)
      .get(`/venues/${venue.publicId}/diary?from=2025-06-01&to=2025-06-30`)
      .expect(200);

    expect(res.body.nights).toEqual([]);
  });

  it('leaves out a night outside the range asked for', async () => {
    await book('2025-06-20');

    const res = await request(app)
      .get(`/venues/${venue.publicId}/diary?from=2025-07-01&to=2025-07-31`)
      .expect(200);

    expect(res.body.nights).toEqual([]);
  });

  it('refuses a range that ends before it starts', async () => {
    const res = await request(app)
      .get(`/venues/${venue.publicId}/diary?from=2025-07-01&to=2025-06-01`)
      .expect(400);

    expect(res.body.error.details.issues[0].key).toBe('to');
  });

  it('needs both ends of the range', async () => {
    await request(app).get(`/venues/${venue.publicId}/diary?from=2025-07-01`).expect(400);
  });
});

describe('taking a spreadsheet of houses', () => {
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
  });

  const HEADER =
    'code,name,territory,city,timezone,line1,postcode,seats,currency,gauges,soundFormats,nitrateCertified\n';

  const PRINCE =
    'GB-LON-PRINCE,Prince Charles Cinema,GB,London,Europe/London,7 Leicester Place,WC2H 7BY,288,GBP,35mm|70mm,dolby-sr,no\n';
  const GFT =
    'GB-GLA-GFT,"Glasgow Film Theatre, Rose Street",GB,Glasgow,Europe/London,12 Rose Street,G3 6RB,404,GBP,35mm|16mm,optical-mono,no\n';

  function post(csv, dryRun = false) {
    return request(app).post('/venues/import').send({ csv, dryRun });
  }

  it('puts every row on file', async () => {
    const res = await post(HEADER + PRINCE + GFT).expect(201);

    expect(res.body).toMatchObject({ read: 2, added: 2, skipped: [] });
    expect(await models().Venue.countDocuments()).toBe(2);
  });

  it('reads a quoted name with a comma in it', async () => {
    await post(HEADER + GFT).expect(201);

    const venue = await models().Venue.findOne({ code: 'GB-GLA-GFT' });
    expect(venue.name).toBe('Glasgow Film Theatre, Rose Street');
    expect(venue.booth.gauges).toEqual(['35mm', '16mm']);
  });

  it('skips a house that is already on file', async () => {
    await post(HEADER + PRINCE).expect(201);

    const res = await post(HEADER + PRINCE + GFT).expect(201);

    expect(res.body).toMatchObject({ read: 2, added: 1, skipped: ['GB-LON-PRINCE'] });
  });

  it('changes nothing on a dry run', async () => {
    const res = await post(HEADER + PRINCE + GFT, true).expect(200);

    expect(res.body).toMatchObject({ read: 2, added: 0, wouldAdd: 2, dryRun: true });
    expect(await models().Venue.countDocuments()).toBe(0);
  });

  it('refuses a file missing a column the desk needs', async () => {
    const res = await post('code,name\nGB-LON-X,Somewhere\n').expect(422);

    expect(res.body.error.details.missing).toEqual(
      expect.arrayContaining(['territory', 'city', 'line1', 'postcode', 'seats']),
    );
  });

  it('names the line of every row it cannot read, and writes none of them', async () => {
    const broken = HEADER + PRINCE + 'GB-GLA-GFT,,GB,Glasgow,,12 Rose Street,G3 6RB,notanumber\n';

    const res = await post(broken).expect(422);

    expect(res.body.error.details.rows[0].line).toBe(3);
    expect(res.body.error.details.rows[0].problems).toEqual(
      expect.arrayContaining(['name is missing', 'seats is not a number']),
    );
    expect(await models().Venue.countDocuments()).toBe(0);
  });

  it('refuses a file with the same house twice', async () => {
    const res = await post(HEADER + PRINCE + PRINCE).expect(422);

    expect(JSON.stringify(res.body.error.details.rows)).toMatch(/GB-LON-PRINCE appears twice/);
  });

  it('fills in the defaults a spreadsheet leaves out', async () => {
    const minimal =
      'code,name,territory,city,line1,postcode,seats\nGB-LON-ICA,ICA,GB,London,The Mall,SW1Y 5AH,185\n';

    await post(minimal).expect(201);

    const venue = await models().Venue.findOne({ code: 'GB-LON-ICA' });
    expect(venue.timezone).toBe('Europe/London');
    expect(venue.boxOfficeCurrency).toBe('GBP');
    expect(venue.booth.gauges).toEqual(['35mm']);
    expect(venue.inboundLeadDays).toBe(2);
  });

  it('reads a nitrate certificate written as yes', async () => {
    const nitrate = HEADER + PRINCE.replace(',dolby-sr,no', ',dolby-sr,yes');

    await post(nitrate).expect(201);

    expect((await models().Venue.findOne({ code: 'GB-LON-PRINCE' })).booth.nitrateCertified).toBe(
      true,
    );
  });

  it('only an admin imports houses', async () => {
    const { app: programmer } = buildTestApp({ operator: stubOperator({ role: 'programmer' }) });

    await request(programmer)
      .post('/venues/import')
      .send({ csv: HEADER + PRINCE })
      .expect(403);
  });
});

describe('shutting a house for a while', () => {
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
    holder = await makeRightsHolder({ name: 'Park Circus' });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE' });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
  });

  const closure = (overrides = {}) => ({
    startsOn: '2025-06-01',
    endsOn: '2025-06-30',
    reason: 'the roof is being replaced',
    ...overrides,
  });

  function book(localDate) {
    return bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate,
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-01',
    });
  }

  it('puts a closure on file', async () => {
    const res = await request(app)
      .post(`/venues/${venue.publicId}/closures`)
      .send(closure())
      .expect(201);

    expect(res.body.closures).toHaveLength(1);
    expect(res.body.closures[0].reason).toBe('the roof is being replaced');
    expect(res.body.bookingsInside).toEqual([]);
  });

  it('refuses a booking inside the closure, and says why', async () => {
    await request(app).post(`/venues/${venue.publicId}/closures`).send(closure()).expect(201);

    let caught;
    try {
      await book('2025-06-20');
    } catch (err) {
      caught = err;
    }

    expect(caught.message).toMatch(/this house is shut: the roof is being replaced/);
    expect(caught.details.closure).toEqual({ startsOn: '2025-06-01', endsOn: '2025-06-30' });
  });

  it('takes a booking on the day after the house reopens', async () => {
    await request(app).post(`/venues/${venue.publicId}/closures`).send(closure()).expect(201);

    const { booking } = await book('2025-07-01');

    expect(booking.status).toBe('held');
  });

  it('refuses on the first and the last day of the closure', async () => {
    await request(app).post(`/venues/${venue.publicId}/closures`).send(closure()).expect(201);

    await expect(book('2025-06-01')).rejects.toThrow(/this house is shut/);
    await expect(book('2025-06-30')).rejects.toThrow(/this house is shut/);
  });

  it('says what is already booked inside a new closure without touching it', async () => {
    const { booking } = await book('2025-06-20');

    const res = await request(app)
      .post(`/venues/${venue.publicId}/closures`)
      .send(closure())
      .expect(201);

    expect(res.body.bookingsInside).toHaveLength(1);
    expect(res.body.bookingsInside[0].reference).toBe(booking.reference);
    expect((await bookings.getBooking(booking.publicId)).status).toBe('held');
  });

  it('refuses a closure that ends before it starts', async () => {
    await request(app)
      .post(`/venues/${venue.publicId}/closures`)
      .send(closure({ startsOn: '2025-07-01', endsOn: '2025-06-01' }))
      .expect(422);
  });

  it('refuses the same closure twice', async () => {
    await request(app).post(`/venues/${venue.publicId}/closures`).send(closure()).expect(201);

    await request(app).post(`/venues/${venue.publicId}/closures`).send(closure()).expect(422);
  });

  it('reopens the house again', async () => {
    await request(app).post(`/venues/${venue.publicId}/closures`).send(closure()).expect(201);

    const res = await request(app)
      .delete(`/venues/${venue.publicId}/closures/2025-06-01`)
      .expect(200);

    expect(res.body.closures).toEqual([]);
    await expect(book('2025-06-20')).resolves.toBeTruthy();
  });

  it('says so when there is no such closure to remove', async () => {
    await request(app).delete(`/venues/${venue.publicId}/closures/2025-06-01`).expect(404);
  });

  it('records the closure and the reopening', async () => {
    await request(app).post(`/venues/${venue.publicId}/closures`).send(closure()).expect(201);
    await request(app).delete(`/venues/${venue.publicId}/closures/2025-06-01`).expect(200);

    const trail = await request(app).get(`/audit-events/venue/${venue.publicId}`).expect(200);
    expect(trail.body.items.map((each) => each.action)).toEqual(['venue.reopened', 'venue.closed']);
  });

  it('only an admin shuts a house', async () => {
    const { app: programmer } = buildTestApp({ operator: stubOperator({ role: 'programmer' }) });

    await request(programmer)
      .post(`/venues/${venue.publicId}/closures`)
      .send(closure())
      .expect(403);
  });
});
