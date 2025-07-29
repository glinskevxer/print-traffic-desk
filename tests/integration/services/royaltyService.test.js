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
const bookings = require('../../../src/services/bookingService');
const service = require('../../../src/services/royaltyService');

describe('royalty statements', () => {
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
    holder = await makeRightsHolder({ name: 'Park Circus', settlementDays: 45 });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable', slug: 'the-red-shoes' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE', seats: 288 });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500 },
    });
  });

  async function settledScreening(localDate, grossMinor = 184000) {
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
      grossMinor,
      currency: 'GBP',
      admissions: 210,
    });
    await bookings.settleBooking(booking.publicId, '2025-07-01');
    return booking;
  }

  it('builds an empty statement for a quiet period', async () => {
    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });

    expect(statement.status).toBe('draft');
    expect(statement.lines).toEqual([]);
    expect(statement.totalMinor).toBe(0);
    expect(statement.currency).toBe('GBP');
  });

  it('puts every settled screening in the period on the statement', async () => {
    await settledScreening('2025-06-20');
    await settledScreening('2025-06-21', 90000);

    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });

    expect(statement.lines).toHaveLength(2);
    expect(statement.totalMinor).toBe(64400 + 31500);
    expect(statement.screeningCount).toBe(2);
    expect(statement.admissionsTotal).toBe(420);
    expect(statement.lines[0].titleSlug).toBe('the-red-shoes');
    expect(statement.lines[0].venueCode).toBe('GB-LON-PRINCE');
  });

  it('leaves out screenings from another period', async () => {
    await settledScreening('2025-06-20');

    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-07-01',
      periodEndsOn: '2025-07-31',
    });

    expect(statement.lines).toEqual([]);
  });

  it('leaves out bookings that have not settled', async () => {
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
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    await bookings.confirmBooking(booking.publicId);

    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });

    expect(statement.lines).toEqual([]);
  });

  it('refuses a second statement for the same period', async () => {
    await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });

    await expect(
      service.buildStatement({
        rightsHolderId: holder.publicId,
        periodStartsOn: '2025-06-01',
        periodEndsOn: '2025-06-30',
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('lets a period be rebuilt once the first one is void', async () => {
    const first = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });
    await service.voidStatement(first.publicId, 'built against the wrong terms');

    const second = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });

    expect(second.publicId).not.toBe(first.publicId);
  });

  it('issues a statement and dates it from the holder terms', async () => {
    await settledScreening('2025-06-20');
    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });

    const issued = await service.issueStatement(statement.publicId, '2025-07-05');

    expect(issued.status).toBe('issued');
    expect(issued.dueOn).toBe('2025-08-19');
  });

  it('will not issue a statement with nothing on it', async () => {
    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });

    await expect(service.issueStatement(statement.publicId, '2025-07-05')).rejects.toThrow(
      /nothing on this statement/,
    );
  });

  it('records a payment against an issued statement', async () => {
    await settledScreening('2025-06-20');
    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });
    await service.issueStatement(statement.publicId, '2025-07-05');

    const paid = await service.recordPayment(statement.publicId, {
      paidOn: '2025-08-01',
      paymentReference: 'BACS-99213',
    });

    expect(paid.status).toBe('paid');
    expect(paid.paymentReference).toBe('BACS-99213');
  });

  it('will not pay a statement that was never issued', async () => {
    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });

    await expect(
      service.recordPayment(statement.publicId, { paidOn: '2025-08-01' }),
    ).rejects.toThrow(/only an issued statement/);
  });

  it('will not void a statement that has been paid', async () => {
    await settledScreening('2025-06-20');
    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });
    await service.issueStatement(statement.publicId, '2025-07-05');
    await service.recordPayment(statement.publicId, { paidOn: '2025-08-01' });

    await expect(service.voidStatement(statement.publicId, 'wrong')).rejects.toThrow(
      /raise a credit/,
    );
  });

  it('finds the statements that are past their due date', async () => {
    await settledScreening('2025-06-20');
    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });
    await service.issueStatement(statement.publicId, '2025-07-05');

    const overdue = await service.listStatements({ overdueAsOf: '2025-09-01' });
    expect(overdue.items).toHaveLength(1);

    const notYet = await service.listStatements({ overdueAsOf: '2025-08-01' });
    expect(notYet.items).toHaveLength(0);
  });

  it('freezes the lines once the statement is issued', async () => {
    await settledScreening('2025-06-20');
    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });
    const issued = await service.issueStatement(statement.publicId, '2025-07-05');
    await settledScreening('2025-06-25');

    const reread = await service.getStatement(issued.publicId);
    expect(reread.lines).toHaveLength(1);
    expect(reread.isFrozen()).toBe(true);
  });

  it('writes an audit line for every step', async () => {
    const { AuditEvent } = models();
    await settledScreening('2025-06-20');
    const statement = await service.buildStatement({
      rightsHolderId: holder.publicId,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
    });
    await service.issueStatement(statement.publicId, '2025-07-05');

    const trail = await AuditEvent.find({ subjectId: statement.publicId }).sort({ at: 1 });
    expect(trail.map((each) => each.action)).toEqual(['statement.built', 'statement.issued']);
  });
});
