'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const outbox = require('../../../src/lib/outbox');
const { MAX_ATTEMPTS } = require('../../../src/models/outboxMessage');
const {
  makeTitle,
  makeVenue,
  makeRightsHolder,
  makePrintElement,
  makeRightsWindow,
} = require('../../helpers/factories');
const bookings = require('../../../src/services/bookingService');

describe('what the desk owes the outside world', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  const message = (overrides = {}) => ({
    kind: 'booking.confirmed',
    subjectType: 'booking',
    subjectId: 'bkg_0123456789ABCDEF',
    to: 'GB-LON-PRINCE',
    channel: 'email',
    payload: { reference: 'BK-2025-171-0123' },
    ...overrides,
  });

  it('writes a message pending and due now', async () => {
    const written = await outbox.enqueue(message());

    expect(written.status).toBe('pending');
    expect(written.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await outbox.pendingCount()).toBe(1);
  });

  it('claims a message once, so two workers cannot send it twice', async () => {
    await outbox.enqueue(message());

    const first = await outbox.claimNext();
    const second = await outbox.claimNext();

    expect(first.status).toBe('sending');
    expect(second).toBeNull();
  });

  it('claims the one that has been waiting longest', async () => {
    const older = await outbox.enqueue(message({ subjectId: 'bkg_OLDER0000000000' }));
    await models().OutboxMessage.updateOne(
      { _id: older._id },
      { $set: { availableAt: new Date(Date.now() - 60000) } },
    );
    await outbox.enqueue(message({ subjectId: 'bkg_NEWER0000000000' }));

    const claimed = await outbox.claimNext();

    expect(claimed.subjectId).toBe('bkg_OLDER0000000000');
  });

  it('leaves a message that is not due yet', async () => {
    const written = await outbox.enqueue(message());
    await models().OutboxMessage.updateOne(
      { _id: written._id },
      { $set: { availableAt: new Date(Date.now() + 60000) } },
    );

    expect(await outbox.claimNext()).toBeNull();
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('narrows a claim to the kinds a worker handles', async () => {
    await outbox.enqueue(message({ kind: 'statement.issued' }));

    expect(await outbox.claimNext({ kinds: ['booking.confirmed'] })).toBeNull();
    expect(await outbox.claimNext({ kinds: ['statement.issued'] })).not.toBeNull();
  });

  it('records a delivery and stops offering it', async () => {
    await outbox.enqueue(message());
    const claimed = await outbox.claimNext();

    const sent = await outbox.markSent(claimed, { elapsedMs: 40 });

    expect(sent.status).toBe('sent');
    expect(sent.sentAt).toBeInstanceOf(Date);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('puts a failure back with a longer wait each time', async () => {
    await outbox.enqueue(message());
    let claimed = await outbox.claimNext();

    const first = await outbox.markFailed(claimed, new Error('connection refused'));
    const firstWait = first.availableAt.getTime() - Date.now();
    expect(first.status).toBe('pending');
    expect(first.lastError).toBe('connection refused');

    first.status = 'sending';
    claimed = first;
    const second = await outbox.markFailed(claimed, new Error('connection refused'));
    const secondWait = second.availableAt.getTime() - Date.now();

    expect(secondWait).toBeGreaterThan(firstWait);
  });

  it('gives up after enough failures and waits for a person', async () => {
    await outbox.enqueue(message());
    let claimed = await outbox.claimNext();

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      claimed = await outbox.markFailed(claimed, new Error('still refused'));
    }

    expect(claimed.status).toBe('abandoned');
    expect(claimed.failureCount()).toBe(MAX_ATTEMPTS);
  });

  it('puts an abandoned message back once somebody fixed the endpoint', async () => {
    const written = await outbox.enqueue(message());
    await models().OutboxMessage.updateOne(
      { _id: written._id },
      { $set: { status: 'abandoned', lastError: 'connection refused' } },
    );

    const requeued = await outbox.requeue(written.publicId);

    expect(requeued.status).toBe('pending');
    expect(requeued.attempts).toEqual([]);
    expect(requeued.lastError).toBeNull();
  });

  it('has nothing to requeue for a message that does not exist', async () => {
    expect(await outbox.requeue('out_0000000000000000')).toBeNull();
  });

  it('lists by status and by kind', async () => {
    await outbox.enqueue(message());
    await outbox.enqueue(message({ kind: 'statement.issued' }));

    expect((await outbox.listMessages({ kind: 'statement.issued' })).items).toHaveLength(1);
    expect((await outbox.listMessages({ status: 'pending' })).items).toHaveLength(2);
    expect((await outbox.listMessages({ status: 'sent' })).items).toHaveLength(0);
  });
});

describe('messages the desk writes for itself', () => {
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
    await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
  });

  async function held() {
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    return booking;
  }

  it('writes a despatch note when a booking is confirmed', async () => {
    const booking = await held();

    await bookings.confirmBooking(booking.publicId);

    const [note] = (await outbox.listMessages({ kind: 'booking.confirmed' })).items;
    expect(note.to).toBe('GB-LON-PRINCE');
    expect(note.payload.reference).toBe(booking.reference);
    expect(note.payload.dispatchOn).toBeTruthy();
  });

  it('writes nothing for a hold nobody confirmed', async () => {
    await held();

    expect((await outbox.listMessages({})).items).toEqual([]);
  });

  it('writes a cancellation note with the reason', async () => {
    const booking = await held();
    await bookings.confirmBooking(booking.publicId);

    await bookings.cancelBooking(booking.publicId, { reason: 'the season was pulled' });

    const [note] = (await outbox.listMessages({ kind: 'booking.cancelled' })).items;
    expect(note.payload.reason).toBe('the season was pulled');
  });

  it('writes nothing at all when the booking rolled back', async () => {
    const booking = await held();
    await expect(
      bookings
        .confirmBooking(booking.publicId)
        .then(() => bookings.confirmBooking(booking.publicId)),
    ).resolves.toBeTruthy();

    expect((await outbox.listMessages({ kind: 'booking.confirmed' })).items).toHaveLength(1);
  });
});
