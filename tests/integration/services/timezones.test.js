'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const {
  makeTitle,
  makeVenue,
  makeRightsHolder,
  makePrintElement,
  makeRightsWindow,
} = require('../../helpers/factories');
const bookings = require('../../../src/services/bookingService');
const rights = require('../../../src/services/rightsService');
const venues = require('../../../src/services/venueService');

/**
 * A screening happens at a wall clock time in one city. Everything the desk
 * decides about it is decided in that city's calendar: which licence covers
 * it, what the reference says, which night it appears on in the diary.
 *
 * These are the cases where the server's own zone would give a different
 * answer, and they have all been wrong at least once.
 */
describe('a screening happens in the venue city, not on the server', () => {
  let holder;
  let title;
  let vault;

  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    holder = await makeRightsHolder({ name: 'Park Circus' });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable' });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
  });

  async function houseIn(zone, code, territory = 'GB') {
    return makeVenue({
      code,
      territory,
      city: code.split('-')[1],
      timezone: zone,
      address: { line1: '1 Street', city: 'Somewhere', postcode: 'AA1 1AA', territory },
    });
  }

  async function shelve() {
    return makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
  }

  it('books a late screening against the night the venue calls it', async () => {
    const venue = await houseIn('Pacific/Auckland', 'NZ-AKL-CIV', 'NZ');
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      territory: 'NZ',
      startsOn: '2025-12-01',
      endsOn: '2025-12-31',
    });
    await shelve();

    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-12-31',
      localTime: '23:30',
      exhibitionType: 'repertory',
      today: '2025-11-01',
    });

    // 23:30 on the thirty first in Auckland is 10:30 UTC on the first.
    expect(booking.screeningAt.toISOString()).toBe('2025-12-31T10:30:00.000Z');
    expect(booking.localDate).toBe('2025-12-31');
    expect(booking.reference).toMatch(/^BK-2025-365-/);
  });

  it('clears a screening against the venue local date, not the utc one', async () => {
    const venue = await houseIn('America/Los_Angeles', 'US-LAX-EGY', 'US');
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      territory: 'US',
      startsOn: '2025-06-20',
      endsOn: '2025-06-20',
    });

    const cleared = await rights.clearScreeningAt({
      titleId: title.publicId,
      venue,
      // Twenty past three in the morning UTC on the twenty first is still the
      // twentieth in Los Angeles, and the licence covers only the twentieth.
      instant: new Date('2025-06-21T03:20:00Z'),
      exhibitionType: 'repertory',
    });

    expect(cleared.request.localDate).toBe('2025-06-20');
    expect(cleared.cleared).toBe(true);
  });

  it('refuses a wall clock time the city never shows', async () => {
    const venue = await houseIn('Europe/London', 'GB-LON-PRINCE');
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
    await shelve();

    await expect(
      bookings.requestBooking({
        titleId: title.publicId,
        venueId: venue.publicId,
        // The clocks go forward at one in the morning on this date.
        localDate: '2025-03-30',
        localTime: '01:30',
        exhibitionType: 'repertory',
        today: '2025-01-02',
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it('books either side of the clocks going back, an hour apart in real time', async () => {
    const venue = await houseIn('Europe/London', 'GB-LON-PRINCE');
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
    await shelve();
    await shelve();

    const early = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-10-25',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-09-01',
    });
    const late = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-10-26',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-09-01',
    });

    const hours = (late.booking.screeningAt - early.booking.screeningAt) / 3600000;
    expect(hours).toBe(25);
  });

  it('shows a night in the diary on the date the venue calls it', async () => {
    const venue = await houseIn('Pacific/Auckland', 'NZ-AKL-CIV', 'NZ');
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      territory: 'NZ',
      startsOn: '2025-12-01',
      endsOn: '2025-12-31',
    });
    await shelve();
    await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-12-31',
      localTime: '23:30',
      exhibitionType: 'repertory',
      today: '2025-11-01',
    });

    const december = await venues.diaryFor(venue.publicId, {
      from: '2025-12-01',
      to: '2025-12-31',
    });
    const january = await venues.diaryFor(venue.publicId, {
      from: '2026-01-01',
      to: '2026-01-31',
    });

    expect(december.nights).toHaveLength(1);
    expect(january.nights).toEqual([]);
  });
});
