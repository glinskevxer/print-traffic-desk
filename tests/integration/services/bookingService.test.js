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

describe('moving a booking on', () => {
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
    ...overrides,
  });

  it('writes two legs when a hold is confirmed', async () => {
    const { booking } = await service.requestBooking(ask());

    const result = await service.confirmBooking(booking.publicId);

    expect(result.booking.status).toBe('confirmed');
    expect(result.booking.holdExpiresAt).toBeNull();
    expect(result.shipments.map((leg) => leg.leg)).toEqual(['outbound', 'return']);
  });

  it('confirming twice does nothing the second time', async () => {
    const { booking } = await service.requestBooking(ask());
    await service.confirmBooking(booking.publicId);

    const again = await service.confirmBooking(booking.publicId);

    expect(again.shipments).toEqual([]);
    expect(await models().Shipment.countDocuments()).toBe(2);
  });

  it('will not confirm a hold that has run out', async () => {
    const { booking } = await service.requestBooking(ask({ holdMinutes: 15 }));
    booking.holdExpiresAt = new Date(Date.now() - 1000);
    await booking.save();

    await expect(service.confirmBooking(booking.publicId)).rejects.toThrow(/has run out/);
  });

  it('gives the print and the licence count back when a booking is cancelled', async () => {
    const { booking } = await service.requestBooking(ask());

    await service.cancelBooking(booking.publicId, { reason: 'the season was pulled' });

    const { PrintElement, RightsWindow } = models();
    expect((await PrintElement.findById(element._id)).status).toBe('available');
    expect((await RightsWindow.findOne({ title: title._id })).screeningsUsed).toBe(0);
  });

  it('cancels the legs that had not gone yet', async () => {
    const { booking } = await service.requestBooking(ask());
    await service.confirmBooking(booking.publicId);

    const result = await service.cancelBooking(booking.publicId, { reason: 'print damaged' });

    expect(result.legsCancelled).toBe(2);
    expect(await models().Shipment.countDocuments({ status: 'cancelled' })).toBe(2);
  });

  it('leaves a leg that is already on the road alone', async () => {
    const { booking } = await service.requestBooking(ask());
    const { shipments } = await service.confirmBooking(booking.publicId);
    shipments[0].status = 'in-transit';
    await shipments[0].save();

    const result = await service.cancelBooking(booking.publicId, { reason: 'venue flooded' });

    expect(result.legsCancelled).toBe(1);
  });

  it('refuses a cancellation with no reason', async () => {
    const { booking } = await service.requestBooking(ask());

    await expect(service.cancelBooking(booking.publicId, {})).rejects.toThrow(/needs a reason/);
  });

  it('will not cancel a booking twice', async () => {
    const { booking } = await service.requestBooking(ask());
    await service.cancelBooking(booking.publicId, { reason: 'first' });

    await expect(service.cancelBooking(booking.publicId, { reason: 'second' })).rejects.toThrow(
      /already closed/,
    );
  });

  it('records the cancellation fee when the desk charges one', async () => {
    const { booking } = await service.requestBooking(ask());

    const result = await service.cancelBooking(booking.publicId, {
      reason: 'cancelled inside the notice period',
      feeMinor: 5000,
    });

    expect(result.booking.cancellation.feeMinor).toBe(5000);
  });

  it('sweeps a hold nobody confirmed', async () => {
    const { booking } = await service.requestBooking(ask());
    booking.holdExpiresAt = new Date(Date.now() - 1000);
    await booking.save();

    const lapsed = await service.lapseExpiredHolds();

    expect(lapsed).toEqual([booking.publicId]);
    expect((await service.getBooking(booking.publicId)).status).toBe('lapsed');
    expect((await models().PrintElement.findById(element._id)).status).toBe('available');
  });

  it('leaves a hold that is still running', async () => {
    await service.requestBooking(ask());

    expect(await service.lapseExpiredHolds()).toEqual([]);
  });

  it('never sweeps a confirmed booking', async () => {
    const { booking } = await service.requestBooking(ask());
    await service.confirmBooking(booking.publicId);

    expect(await service.lapseExpiredHolds(new Date('2030-01-01'))).toEqual([]);
  });

  it('frees the print so the next booking can have it', async () => {
    const first = await service.requestBooking(ask());
    await service.cancelBooking(first.booking.publicId, { reason: 'changed the programme' });

    const second = await service.requestBooking(ask({ localDate: '2025-06-21' }));

    expect(String(second.element._id)).toBe(String(element._id));
  });
});

describe('settling a booking', () => {
  let holder;
  let title;
  let venue;
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
    venue = await makeVenue({ code: 'GB-LON-PRINCE', seats: 288, houseNutMinor: 42000 });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500 },
    });
  });

  async function confirmed() {
    const { booking } = await service.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    await service.confirmBooking(booking.publicId);
    return booking;
  }

  const takings = (overrides = {}) => ({
    grossMinor: 184000,
    currency: 'GBP',
    admissions: 210,
    reportedBy: 'boxoffice@prince.test',
    ...overrides,
  });

  it('works the royalty out from the licence terms', async () => {
    const booking = await confirmed();

    const { booking: updated, royalty } = await service.reportBoxOffice(
      booking.publicId,
      takings(),
    );

    expect(royalty.amountMinor).toBe(64400);
    expect(updated.royaltyMinor).toBe(64400);
    expect(updated.royaltyBasis).toBe('35% of the gross');
  });

  it('defaults the house nut to what the house charges', async () => {
    const { RightsWindow } = models();
    await RightsWindow.updateMany(
      {},
      {
        $set: {
          terms: {
            kind: 'split-after-nut',
            currency: 'GBP',
            percentageBps: 5000,
            houseNutDeductible: true,
          },
        },
      },
    );
    const booking = await confirmed();

    const { royalty } = await service.reportBoxOffice(booking.publicId, takings());

    expect(royalty.amountMinor).toBe(71000);
  });

  it('adds a run to the print', async () => {
    const booking = await confirmed();
    await service.reportBoxOffice(booking.publicId, takings());

    const { PrintElement } = models();
    const element = await PrintElement.findById(booking.element);
    expect(element.screeningsSinceInspection).toBe(1);
  });

  it('refuses takings in another currency', async () => {
    const booking = await confirmed();

    await expect(
      service.reportBoxOffice(booking.publicId, takings({ currency: 'EUR' })),
    ).rejects.toThrow(/currency this house sells in/);
  });

  it('refuses more admissions than the house could ever seat', async () => {
    const booking = await confirmed();

    await expect(
      service.reportBoxOffice(booking.publicId, takings({ admissions: 5000 })),
    ).rejects.toThrow(/could seat in a day/);
  });

  it('refuses takings against a booking that is only held', async () => {
    const { booking } = await service.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });

    await expect(service.reportBoxOffice(booking.publicId, takings())).rejects.toThrow(
      /confirmed booking/,
    );
  });

  it('settles once the takings are in', async () => {
    const booking = await confirmed();
    await service.reportBoxOffice(booking.publicId, takings());

    const settled = await service.settleBooking(booking.publicId, '2025-07-01');

    expect(settled.status).toBe('settled');
    expect(settled.settledOn).toBe('2025-07-01');
  });

  it('will not settle before the takings are reported', async () => {
    const booking = await confirmed();

    await expect(service.settleBooking(booking.publicId, '2025-07-01')).rejects.toThrow(
      /have not been reported/,
    );
  });

  it('will not report takings twice against a settled booking', async () => {
    const booking = await confirmed();
    await service.reportBoxOffice(booking.publicId, takings());
    await service.settleBooking(booking.publicId, '2025-07-01');

    await expect(service.reportBoxOffice(booking.publicId, takings())).rejects.toThrow(
      /already settled/,
    );
  });

  it('lists the screenings whose takings nobody has rung through', async () => {
    const booking = await confirmed();

    const waiting = await service.awaitingBoxOffice('2025-06-25');
    expect(waiting.map((each) => each.publicId)).toEqual([booking.publicId]);

    await service.reportBoxOffice(booking.publicId, takings());
    expect(await service.awaitingBoxOffice('2025-06-25')).toHaveLength(0);
  });
});

describe('two desks after the same print', () => {
  let holder;
  let title;
  let venue;
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
    venue = await makeVenue({ code: 'GB-LON-PRINCE' });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
  });

  const ask = (overrides = {}) => ({
    titleId: title.publicId,
    venueId: venue.publicId,
    localDate: '2025-06-20',
    localTime: '19:30',
    exhibitionType: 'repertory',
    today: '2025-05-15',
    ...overrides,
  });

  async function shelve(count) {
    const shelf = [];
    for (let i = 0; i < count; i += 1) {
      shelf.push(
        await makePrintElement({
          title: title._id,
          owner: holder._id,
          currentLocation: vault._id,
          custodian: vault._id,
          status: 'available',
        }),
      );
    }
    return shelf;
  }

  it('takes the second print when the first is taken underneath it', async () => {
    const [first] = await shelve(2);
    const { PrintElement } = models();
    const realUpdate = PrintElement.updateOne.bind(PrintElement);
    let lostOnce = false;

    // The other desk got there first: the conditional update misses and the
    // print is committed by the time this one looks again.
    jest.spyOn(PrintElement, 'updateOne').mockImplementation(async (filter, ...rest) => {
      if (!lostOnce && String(filter._id) === String(first._id)) {
        lostOnce = true;
        await PrintElement.collection.updateOne(
          { _id: first._id },
          { $set: { status: 'committed' } },
        );
        return { matchedCount: 0, modifiedCount: 0 };
      }
      return realUpdate(filter, ...rest);
    });

    const { booking, element } = await service.requestBooking(ask(), { sleep: async () => {} });

    expect(lostOnce).toBe(true);
    expect(booking.status).toBe('held');
    expect(String(element._id)).not.toBe(String(first._id));
  });

  it('tries again with the same print when nothing else took it after all', async () => {
    const [only] = await shelve(1);
    const { PrintElement } = models();
    const realUpdate = PrintElement.updateOne.bind(PrintElement);
    let lostOnce = false;

    jest.spyOn(PrintElement, 'updateOne').mockImplementation((filter, ...rest) => {
      if (!lostOnce) {
        lostOnce = true;
        return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
      }
      return realUpdate(filter, ...rest);
    });

    const { booking, element } = await service.requestBooking(ask(), { sleep: async () => {} });

    expect(booking.status).toBe('held');
    expect(String(element._id)).toBe(String(only._id));
  });

  it('gives up and says so when it loses every time', async () => {
    await shelve(1);
    const { PrintElement } = models();
    jest.spyOn(PrintElement, 'updateOne').mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    await expect(
      service.requestBooking(ask(), { attempts: 2, sleep: async () => {} }),
    ).rejects.toThrow(/committed by somebody else/);
  });

  it('does not retry a refusal that would answer the same way again', async () => {
    await shelve(1);
    const { RightsWindow } = models();
    await RightsWindow.updateMany({}, { $set: { territory: 'FR' } });

    await expect(service.requestBooking(ask(), { sleep: async () => {} })).rejects.toThrow(
      /no licence clears/,
    );
  });
});
