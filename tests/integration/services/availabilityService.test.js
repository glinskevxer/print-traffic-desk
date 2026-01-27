'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const {
  makeTitle,
  makeVenue,
  makeRightsHolder,
  makePrintElement,
  makeRightsWindow,
} = require('../../helpers/factories');
const service = require('../../../src/services/availabilityService');
const bookings = require('../../../src/services/bookingService');

describe('where a title could be shown', () => {
  let app;
  let holder;
  let title;
  let prince;
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
    prince = await makeVenue({ code: 'GB-LON-PRINCE' });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
      conditionGrade: 'A',
    });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
  });

  const ask = (overrides = {}) => ({
    titleId: title.publicId,
    localDate: '2025-06-20',
    today: '2025-05-15',
    ...overrides,
  });

  it('says which houses could take it, with the print and the dates', async () => {
    const answer = await service.housesFor(ask());

    const house = answer.houses.find((each) => each.venue.code === 'GB-LON-PRINCE');
    expect(house.available).toBe(true);
    expect(house.print.grade).toBe('A');
    expect(house.dispatchOn < '2025-06-20').toBe(true);
    expect(house.backOn > '2025-06-20').toBe(true);
    expect(answer.printsFree).toBe(1);
  });

  it('says rights when no licence reaches the house', async () => {
    const paris = await makeVenue({
      code: 'FR-PAR-CIN',
      territory: 'FR',
      city: 'Paris',
      timezone: 'Europe/Paris',
      address: { line1: '51 Rue de Bercy', city: 'Paris', postcode: '75012', territory: 'FR' },
    });

    const answer = await service.housesFor(ask());

    const house = answer.houses.find((each) => each.venue.id === paris.publicId);
    expect(house.available).toBe(false);
    expect(house.because).toBe('rights');
    expect(house.refusals[0].detail).toMatch(/does not reach FR/);
  });

  it('says no print when the booth cannot run any of them', async () => {
    const sixteen = await makeVenue({
      code: 'GB-LON-CINE',
      booth: { gauges: ['16mm'], soundFormats: ['optical-mono'] },
    });

    const answer = await service.housesFor(ask());

    const house = answer.houses.find((each) => each.venue.id === sixteen.publicId);
    expect(house.because).toBe('no-print');
    expect(house.refusals[0].rule).toBe('gauge');
  });

  it('says calendar when the print could not get there in time', async () => {
    const answer = await service.housesFor(ask({ localDate: '2025-05-16', today: '2025-05-15' }));

    const house = answer.houses.find((each) => each.venue.code === 'GB-LON-PRINCE');
    expect(house.because).toBe('calendar');
    expect(house.shortfallDays).toBeGreaterThan(0);
  });

  it('stops offering a print that is already spoken for', async () => {
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: prince.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    await bookings.confirmBooking(booking.publicId);

    const answer = await service.housesFor(ask({ localDate: '2025-06-21' }));

    expect(answer.printsFree).toBe(0);
    expect(answer.availableCount).toBe(0);
    expect(answer.houses.every((house) => house.because === 'no-print')).toBe(true);
  });

  it('narrows to one territory when asked', async () => {
    await makeVenue({
      code: 'IE-DUB-IFI',
      territory: 'IE',
      city: 'Dublin',
      timezone: 'Europe/Dublin',
      address: { line1: '6 Eustace Street', city: 'Dublin', postcode: 'D02', territory: 'IE' },
    });

    const answer = await service.housesFor(ask({ territory: 'IE' }));

    expect(answer.houses).toHaveLength(1);
    expect(answer.houses[0].venue.code).toBe('IE-DUB-IFI');
  });

  it('leaves a retired house out altogether', async () => {
    prince.active = false;
    await prince.save();

    const answer = await service.housesFor(ask());

    expect(answer.houses.map((each) => each.venue.code)).not.toContain('GB-LON-PRINCE');
  });

  it('counts how many houses could take it', async () => {
    const answer = await service.housesFor(ask());

    expect(answer.availableCount).toBe(answer.houses.filter((each) => each.available).length);
    expect(answer.title.slug).toBe('daisies');
  });

  it('answers over http', async () => {
    const res = await request(app)
      .get(`/titles/${title.publicId}/availability?localDate=2025-06-20&today=2025-05-15`)
      .expect(200);

    expect(res.body.exhibitionType).toBe('repertory');
    expect(res.body.houses.length).toBeGreaterThan(0);
  });

  it('needs a date to answer at all', async () => {
    await request(app).get(`/titles/${title.publicId}/availability`).expect(400);
  });

  it('answers 404 for a title that is not catalogued', async () => {
    await request(app)
      .get('/titles/ttl_0000000000000000/availability?localDate=2025-06-20')
      .expect(404);
  });

  it('has nothing to offer for a title with no prints at all', async () => {
    await models().PrintElement.deleteMany({});

    const answer = await service.housesFor(ask());

    expect(answer.printsFree).toBe(0);
    expect(answer.houses.every((house) => house.available === false)).toBe(true);
  });
});
