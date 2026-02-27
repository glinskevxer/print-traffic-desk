'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { createLogger } = require('../../../src/lib/logger');
const outbox = require('../../../src/lib/outbox');
const { drain } = require('../../../src/workers/outboxWorker');
const { webhookDeliverer, deliverers } = require('../../../src/workers/delivery');
const { UpstreamError } = require('../../../src/lib/errors');

const log = createLogger({ level: 'silent' });

function fakeFetch(answers) {
  const calls = [];
  return {
    calls,
    impl: async (url, options) => {
      calls.push({ url, options });
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { ok: next.status < 400, status: next.status };
    },
  };
}

describe('sending what the desk owes', () => {
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
    channel: 'log',
    payload: { reference: 'BK-2025-171-0123' },
    ...overrides,
  });

  it('does nothing when there is nothing to send', async () => {
    const results = await drain({ log });

    expect(results).toMatchObject({ claimed: 0, sent: 0, failed: 0 });
  });

  it('sends what is due and marks it sent', async () => {
    await outbox.enqueue(message());
    await outbox.enqueue(message({ subjectId: 'bkg_SECOND00000000' }));

    const results = await drain({ log });

    expect(results).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('stops at the limit it was given', async () => {
    for (let i = 0; i < 5; i += 1) {
      await outbox.enqueue(message({ subjectId: `bkg_${String(i).padStart(16, '0')}` }));
    }

    const results = await drain({ log, limit: 2 });

    expect(results.claimed).toBe(2);
    expect(await outbox.pendingCount()).toBe(3);
  });

  it('posts to the endpoint when one is configured', async () => {
    await outbox.enqueue(message({ channel: 'email' }));
    const fetcher = fakeFetch([{ status: 202 }]);

    const results = await drain({
      log,
      webhookUrl: 'https://office.archive.test/hooks/printdesk',
      fetchImpl: fetcher.impl,
    });

    expect(results.sent).toBe(1);
    expect(fetcher.calls[0].url).toBe('https://office.archive.test/hooks/printdesk');
    expect(JSON.parse(fetcher.calls[0].options.body).kind).toBe('booking.confirmed');
    expect(fetcher.calls[0].options.headers['x-printdesk-kind']).toBe('booking.confirmed');
  });

  it('puts a message back when the endpoint is having a bad day', async () => {
    await outbox.enqueue(message({ channel: 'email' }));
    const fetcher = fakeFetch([{ status: 503 }]);

    const results = await drain({
      log,
      webhookUrl: 'https://office.archive.test/hooks',
      fetchImpl: fetcher.impl,
    });

    expect(results).toMatchObject({ sent: 0, failed: 1 });
    const [stored] = (await outbox.listMessages({})).items;
    expect(stored.status).toBe('pending');
    expect(stored.lastError).toMatch(/answered 503/);
    expect(stored.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('writes an email to the log when no endpoint is configured', async () => {
    await outbox.enqueue(message({ channel: 'email' }));

    const results = await drain({ log });

    expect(results.sent).toBe(1);
    const [stored] = (await outbox.listMessages({})).items;
    expect(stored.attempts[0].detail).toBe('written to the log');
  });

  it('only takes the kinds it was asked for', async () => {
    await outbox.enqueue(message({ kind: 'statement.issued' }));

    const skipped = await drain({ log, kinds: ['booking.confirmed'] });
    expect(skipped.claimed).toBe(0);

    const taken = await drain({ log, kinds: ['statement.issued'] });
    expect(taken.sent).toBe(1);
  });

  it('calls a 4xx a failure that will never come good', async () => {
    const deliver = webhookDeliverer({
      url: 'https://office.archive.test/hooks',
      fetchImpl: fakeFetch([{ status: 422 }]).impl,
    });

    let caught;
    try {
      await deliver({ publicId: 'out_1', kind: 'booking.confirmed', payload: {} });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UpstreamError);
    expect(caught.retryable).toBe(false);
  });

  it('calls a 429 worth trying again', async () => {
    const deliver = webhookDeliverer({
      url: 'https://office.archive.test/hooks',
      fetchImpl: fakeFetch([{ status: 429 }]).impl,
    });

    await expect(
      deliver({ publicId: 'out_1', kind: 'booking.confirmed', payload: {} }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('falls back to the log for a channel it has no courier for', () => {
    const couriers = deliverers({ log });

    expect(couriers.webhook).toBe(couriers.log);
    expect(couriers.email).toBe(couriers.log);
  });
});
