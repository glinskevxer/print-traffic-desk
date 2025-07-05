'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const {
  makeTitle,
  makeVenue,
  makeRightsHolder,
  makePrintElement,
  makeRightsWindow,
} = require('../../helpers/factories');
const service = require('../../../src/services/bookingService');

describe('taking a booking', () => {
  let holder;
  let title;
  let venue;
  let vault;
  let element;

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
    venue = await makeVenue({ code: 'GB-LON-PRINCE' });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    element = await makePrintElement({
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
    venueId: venue.publicId,
    localDate: '2025-06-20',
    localTime: '19:30',
    exhibitionType: 'repertory',
    today: '2025-05-15',
    bookedBy: 'programmer@prince.test',
    ...overrides,
  });

  it('takes a hold with the licence and the print it chose', async () => {
    const { booking, element: chosen } = await service.requestBooking(ask());

    expect(booking.status).toBe('held');
    expect(booking.reference).toMatch(/^BK-2025-171-/);
    expect(booking.clearance.windowId).toMatch(/^rw_/);
    expect(String(chosen._id)).toBe(String(element._id));
    expect(booking.holdExpiresAt).toBeInstanceOf(Date);
  });

  it('commits the print it chose', async () => {
    await service.requestBooking(ask());

    const { PrintElement } = models();
    expect((await PrintElement.findById(element._id)).status).toBe('committed');
  });

  it('counts the hold against the licence allowance straight away', async () => {
    const { RightsWindow } = models();
    await service.requestBooking(ask());

    const [window] = await RightsWindow.find({ title: title._id });
    expect(window.screeningsUsed).toBe(1);
  });

  it('refuses when no licence clears the date', async () => {
    const { RightsWindow } = models();
    await RightsWindow.updateMany({}, { $set: { status: 'suspended', suspendedReason: 'unpaid' } });

    await expect(service.requestBooking(ask())).rejects.toThrow(/no licence clears/);
  });

  it('names the rule that refused it', async () => {
    const { RightsWindow } = models();
    await RightsWindow.updateMany({}, { $set: { territory: 'FR' } });

    let caught;
    try {
      await service.requestBooking(ask());
    } catch (err) {
      caught = err;
    }
    expect(caught.details.refusalCodes).toEqual(['territory']);
  });

  it('refuses a title that is not bookable', async () => {
    title.status = 'draft';
    await title.save();

    await expect(service.requestBooking(ask())).rejects.toThrow(/not bookable/);
  });

  it('refuses a house that is closed to bookings', async () => {
    venue.active = false;
    await venue.save();

    await expect(service.requestBooking(ask())).rejects.toThrow(/not taking bookings/);
  });

  it('refuses when the booth cannot run any print of the title', async () => {
    element.gauge = '70mm';
    await element.save();

    let caught;
    try {
      await service.requestBooking(ask());
    } catch (err) {
      caught = err;
    }
    expect(caught.message).toMatch(/no print of this title can play/);
    expect(caught.details.rejected[0].problems[0].rule).toBe('gauge');
  });

  it('picks the better graded print when there are two', async () => {
    const better = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
      conditionGrade: 'A',
      kind: 'restoration-print',
    });

    const { element: chosen } = await service.requestBooking(ask());

    expect(String(chosen._id)).toBe(String(better._id));
  });

  it('takes the print the venue asked for when it can run it', async () => {
    const other = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
      conditionGrade: 'C',
    });

    const { element: chosen } = await service.requestBooking(ask({ elementId: other.publicId }));

    expect(String(chosen._id)).toBe(String(other._id));
  });

  it('refuses the print the venue asked for when the booth cannot run it', async () => {
    const wrong = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
      gauge: '16mm',
    });

    await expect(service.requestBooking(ask({ elementId: wrong.publicId }))).rejects.toThrow(
      /cannot take this booking/,
    );
  });

  it('refuses a date the print could never reach in time', async () => {
    await expect(
      service.requestBooking(ask({ localDate: '2025-05-16', today: '2025-05-15' })),
    ).rejects.toThrow(/already past/);
  });

  it('stores the span the print is spoken for', async () => {
    const { booking } = await service.requestBooking(ask());

    expect(booking.traffic.committedFrom <= '2025-06-20').toBe(true);
    expect(booking.traffic.committedUntil >= '2025-06-20').toBe(true);
  });

  it('will not hand the same print to two bookings', async () => {
    await service.requestBooking(ask());

    await expect(service.requestBooking(ask({ localDate: '2025-06-21' }))).rejects.toThrow(
      /no print of this title can play/,
    );
  });

  it('respects a per house cap once that house has taken its share', async () => {
    const { RightsWindow } = models();
    await RightsWindow.updateMany({}, { $set: { maxScreeningsPerVenue: 1 } });
    await service.requestBooking(ask());

    const second = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    expect(second.status).toBe('available');

    let caught;
    try {
      await service.requestBooking(ask({ localDate: '2025-06-22' }));
    } catch (err) {
      caught = err;
    }
    expect(caught.details.refusalCodes).toEqual(['venue-cap']);
  });

  it('writes an audit line naming the licence and the print', async () => {
    const { AuditEvent } = models();
    const { booking } = await service.requestBooking(ask());

    const [event] = await AuditEvent.find({ subjectId: booking.publicId });
    expect(event.action).toBe('booking.held');
    expect(event.metadata.venue).toBe(venue.code);
  });

  it('lists and filters bookings', async () => {
    await service.requestBooking(ask());

    const all = await service.listBookings({});
    expect(all.items).toHaveLength(1);

    const byVenue = await service.listBookings({ venueId: venue.publicId });
    expect(byVenue.items).toHaveLength(1);

    const outside = await service.listBookings({ from: '2025-07-01' });
    expect(outside.items).toHaveLength(0);
  });
});
