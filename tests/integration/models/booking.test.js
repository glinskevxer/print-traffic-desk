'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { makeTitle, makeVenue, makePrintElement } = require('../../helpers/factories');
const { bookingReference } = require('../../../src/lib/ids');

describe('booking model', () => {
  let Booking;

  beforeAll(async () => {
    ({ Booking } = await useDatabase());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  afterEach(async () => {
    await clearCollections();
  });

  async function makeBooking(overrides = {}) {
    const title = overrides.title || (await makeTitle())._id;
    const venue = overrides.venue || (await makeVenue())._id;
    return Booking.create({
      reference: bookingReference('2025-06-20'),
      screeningAt: new Date('2025-06-20T18:30:00Z'),
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      ...overrides,
      title,
      venue,
    });
  }

  it('opens a booking as a hold', async () => {
    const booking = await makeBooking();

    expect(booking.publicId).toMatch(/^bkg_/);
    expect(booking.status).toBe('held');
    expect(booking.isLive()).toBe(true);
    expect(booking.countsAgainstLicence()).toBe(true);
  });

  it('refuses a reference that is not the printed shape', async () => {
    await expect(makeBooking({ reference: 'BOOKING-1' })).rejects.toThrow(/BK-YYYY-DDD-XXXX/);
  });

  it('refuses a local time that is not a 24 hour clock', async () => {
    await expect(makeBooking({ localTime: '7.30pm' })).rejects.toThrow(/HH:mm/);
  });

  it('keeps references unique', async () => {
    const first = await makeBooking();

    await expect(makeBooking({ reference: first.reference })).rejects.toThrow(/duplicate key/);
  });

  it('keeps an idempotency key unique but lets many bookings have none', async () => {
    await makeBooking({ idempotencyKey: 'venue-desk-1' });
    await makeBooking();
    await makeBooking();

    await expect(makeBooking({ idempotencyKey: 'venue-desk-1' })).rejects.toThrow(/duplicate key/);
  });

  it('counts against the licence only once it is cleared', async () => {
    const booking = await makeBooking({ status: 'cleared' });
    expect(booking.countsAgainstLicence()).toBe(true);

    booking.status = 'cancelled';
    expect(booking.countsAgainstLicence()).toBe(false);
    expect(booking.isLive()).toBe(false);
  });

  it('knows when a hold has run out', async () => {
    const booking = await makeBooking({ holdExpiresAt: new Date('2025-06-01T00:00:00Z') });

    expect(booking.hasLapsed(new Date('2025-06-02T00:00:00Z'))).toBe(true);
    expect(booking.hasLapsed(new Date('2025-05-30T00:00:00Z'))).toBe(false);
  });

  it('never calls a confirmed booking lapsed', async () => {
    const booking = await makeBooking({
      status: 'confirmed',
      holdExpiresAt: new Date('2025-06-01T00:00:00Z'),
    });

    expect(booking.hasLapsed(new Date('2026-01-01T00:00:00Z'))).toBe(false);
  });

  it('stores the box office against the screening', async () => {
    const booking = await makeBooking({
      status: 'confirmed',
      boxOffice: { grossMinor: 184000, currency: 'GBP', admissions: 210, houseNutMinor: 42000 },
    });

    expect(booking.boxOffice.grossMinor).toBe(184000);
    expect(booking.boxOffice.reportedAt).toBeInstanceOf(Date);
  });

  it('holds the traffic plan it was cleared against', async () => {
    const element = await makePrintElement();
    const booking = await makeBooking({
      element: element._id,
      traffic: {
        committedFrom: '2025-06-16',
        committedUntil: '2025-06-26',
        service: 'road-freight',
      },
    });

    expect(booking.traffic.committedFrom).toBe('2025-06-16');
    expect(booking.element).toBeTruthy();
  });

  it('keeps the rule outcomes it cleared on', async () => {
    const booking = await makeBooking({
      status: 'cleared',
      clearance: {
        windowId: 'rw_A00000000000000',
        clearedAt: new Date(),
        outcomes: [{ code: 'territory', ok: true, detail: 'GB covers GB' }],
      },
    });

    expect(booking.clearance.outcomes[0].code).toBe('territory');
  });
});
