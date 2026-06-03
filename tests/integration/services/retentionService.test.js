'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const service = require('../../../src/services/retentionService');
const outbox = require('../../../src/lib/outbox');
const { makeTitle } = require('../../helpers/factories');

const YEARS_AGO = new Date('2020-01-01T00:00:00Z');

describe('what the desk throws away', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  async function oldAudit(action) {
    const { AuditEvent } = models();
    const [event] = await AuditEvent.create([
      { action, subjectType: 'title', subjectId: 'ttl_0000000000000000' },
    ]);
    await AuditEvent.updateOne({ _id: event._id }, { $set: { at: YEARS_AGO } });
    return event;
  }

  it('knows which audit lines are kept whatever their age', () => {
    expect(service.keepForever('booking.held')).toBe(true);
    expect(service.keepForever('statement.issued')).toBe(true);
    expect(service.keepForever('element.inspected')).toBe(true);
    expect(service.keepForever('element.relocated')).toBe(false);
    expect(service.keepForever('shipment.planned')).toBe(false);
  });

  it('throws away an old operational line and keeps an old money one', async () => {
    await oldAudit('element.relocated');
    await oldAudit('booking.held');

    const outcome = await service.prune({ only: 'auditEvents' });

    expect(outcome.auditEvents).toMatchObject({ examined: 2, deleted: 1 });
    const left = await models().AuditEvent.find({});
    expect(left.map((event) => event.action)).toEqual(['booking.held']);
  });

  it('keeps a recent operational line', async () => {
    const { AuditEvent } = models();
    await AuditEvent.create({
      action: 'element.relocated',
      subjectType: 'print-element',
      subjectId: 'elem_0000000000000000',
    });

    const outcome = await service.prune({ only: 'auditEvents' });

    expect(outcome.auditEvents.deleted).toBe(0);
    expect(await AuditEvent.countDocuments()).toBe(1);
  });

  it('throws away a message that was sent a long time ago', async () => {
    const message = await outbox.enqueue({
      kind: 'booking.confirmed',
      subjectType: 'booking',
      subjectId: 'bkg_0000000000000000',
      to: 'GB-LON-PRINCE',
      payload: {},
    });
    await models().OutboxMessage.updateOne(
      { _id: message._id },
      { $set: { status: 'sent', sentAt: YEARS_AGO } },
    );

    const outcome = await service.prune({ only: 'outboxMessages' });

    expect(outcome.outboxMessages.deleted).toBe(1);
  });

  it('keeps a message that is still waiting to go, however old', async () => {
    const message = await outbox.enqueue({
      kind: 'booking.confirmed',
      subjectType: 'booking',
      subjectId: 'bkg_0000000000000000',
      to: 'GB-LON-PRINCE',
      payload: {},
    });
    await models().OutboxMessage.updateOne(
      { _id: message._id },
      { $set: { createdAt: YEARS_AGO } },
    );

    const outcome = await service.prune({ only: 'outboxMessages' });

    expect(outcome.outboxMessages.deleted).toBe(0);
  });

  it('throws away a stale idempotency key', async () => {
    const { IdempotencyRecord } = models();
    await IdempotencyRecord.collection.insertOne({
      key: 'prince-desk-000001',
      route: 'POST /bookings',
      requestHash: 'x',
      state: 'completed',
      createdAt: YEARS_AGO,
      updatedAt: YEARS_AGO,
    });

    const outcome = await service.prune({ only: 'idempotencyRecords' });

    expect(outcome.idempotencyRecords.deleted).toBe(1);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
  });

  it('throws away a rejected reading and keeps an applied one', async () => {
    const { ExtractionJob } = models();
    const title = await makeTitle();
    const base = {
      kind: 'licence-terms',
      subjectType: 'title',
      subject: title._id,
      subjectPublicId: title.publicId,
      inputHash: 'a'.repeat(64),
      inputPreview: 'a letter',
      inputLength: 100,
      model: 'gpt-4o-mini',
      promptVersion: 'licence-terms/3',
    };
    const rejected = await ExtractionJob.create({ ...base, status: 'rejected' });
    const applied = await ExtractionJob.create({ ...base, status: 'applied' });
    // Mongoose makes createdAt immutable once timestamps are on, so an aged
    // fixture has to go in through the driver.
    await ExtractionJob.collection.updateMany(
      { _id: { $in: [rejected._id, applied._id] } },
      { $set: { createdAt: YEARS_AGO } },
    );

    const outcome = await service.prune({ only: 'extractionJobs' });

    expect(outcome.extractionJobs.deleted).toBe(1);
    expect((await ExtractionJob.findOne({})).status).toBe('applied');
  });

  it('prunes every collection when told nothing in particular', async () => {
    const outcome = await service.prune();

    expect(Object.keys(outcome).sort()).toEqual([
      'auditEvents',
      'extractionJobs',
      'idempotencyRecords',
      'outboxMessages',
    ]);
  });

  it('takes a retention the desk was told rather than the default', async () => {
    const { AuditEvent } = models();
    const [event] = await AuditEvent.create([
      { action: 'element.relocated', subjectType: 'print-element', subjectId: 'elem_x' },
    ]);
    await AuditEvent.updateOne(
      { _id: event._id },
      { $set: { at: new Date(Date.now() - 5 * 86400000) } },
    );

    expect((await service.prune({ only: 'auditEvents' })).auditEvents.deleted).toBe(0);
    expect(
      (await service.prune({ only: 'auditEvents', days: { auditEvents: 1 } })).auditEvents.deleted,
    ).toBe(1);
  });

  it('stops at the batch size it was given', async () => {
    for (let i = 0; i < 5; i += 1) {
      await oldAudit('element.relocated');
    }

    const outcome = await service.prune({ only: 'auditEvents', limit: 2 });

    expect(outcome.auditEvents).toMatchObject({ examined: 2, deleted: 2 });
    expect(await models().AuditEvent.countDocuments()).toBe(3);
  });

  it('refuses to prune something it does not know about', async () => {
    await expect(service.prune({ only: 'everything' })).rejects.toThrow(/not something the desk/);
  });
});
