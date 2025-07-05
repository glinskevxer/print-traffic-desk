'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { makePrintElement, makeVenue } = require('../../helpers/factories');
const { runWithContext } = require('../../../src/lib/context');
const audit = require('../../../src/lib/audit');
const elementService = require('../../../src/services/elementService');
const inspectionService = require('../../../src/services/inspectionService');

describe('the audit trail', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('stamps the actor and the request from the ambient context', async () => {
    const element = await makePrintElement({ status: 'available' });

    await runWithContext(
      { actor: 'traffic@archive.test', requestId: 'req-99', source: 'http' },
      async () => {
        await elementService.setStatus(element.publicId, 'quarantined', 'smells of vinegar');
      },
    );

    const [event] = await audit.trailFor('print-element', element.publicId);
    expect(event.actor).toBe('traffic@archive.test');
    expect(event.requestId).toBe('req-99');
    expect(event.source).toBe('http');
    expect(event.action).toBe('element.status-changed');
    expect(event.changes).toHaveLength(1);
    expect(event.changes[0]).toMatchObject({ field: 'status', before: 'available', after: 'quarantined' });
  });

  it('writes nothing when a status is set to what it already was', async () => {
    const element = await makePrintElement({ status: 'available' });

    await elementService.setStatus(element.publicId, 'available');

    expect(await audit.trailFor('print-element', element.publicId)).toHaveLength(0);
  });

  it('records a relocation with the venue it went to', async () => {
    const element = await makePrintElement({ status: 'available' });
    const destination = await makeVenue({ code: 'GB-LON-BFI' });

    await elementService.relocate(element.publicId, destination.publicId, 'returned from loan');

    const [event] = await audit.trailFor('print-element', element.publicId);
    expect(event.action).toBe('element.relocated');
    expect(event.metadata.venueCode).toBe(destination.code);
    expect(event.metadata.reason).toBe('returned from loan');
  });

  it('records what an inspection did to the element', async () => {
    const element = await makePrintElement({ status: 'available', conditionGrade: 'A' });

    await inspectionService.recordInspection(element.publicId, {
      inspector: 'R. Fitzgerald',
      kind: 'routine',
      measurements: { adStripLevel: 2 },
    });

    const [event] = await audit.trailFor('print-element', element.publicId);
    expect(event.action).toBe('element.inspected');
    expect(event.metadata.verdict).toBe('quarantine');
    expect(event.changes.map((c) => c.field).sort()).toEqual(['conditionGrade', 'status']);
  });

  it('rolls the audit back with the change it describes', async () => {
    const { AuditEvent } = models();
    const element = await makePrintElement({ status: 'retired' });

    await expect(
      inspectionService.recordInspection(element.publicId, {
        inspector: 'R. Fitzgerald',
        kind: 'routine',
      }),
    ).rejects.toThrow(/not inspected again/);

    expect(await AuditEvent.countDocuments()).toBe(0);
  });

  it('reads a trail newest first', async () => {
    const element = await makePrintElement({ status: 'available' });
    await elementService.setStatus(element.publicId, 'quarantined', 'damage reported');
    await elementService.setStatus(element.publicId, 'retired', 'beyond repair');

    const trail = await audit.trailFor('print-element', element.publicId);

    expect(trail).toHaveLength(2);
    expect(trail[0].changes[0].after).toBe('retired');
  });

  it('leaves the actor null for a change nobody signed for', async () => {
    const element = await makePrintElement({ status: 'available' });

    await elementService.setStatus(element.publicId, 'quarantined', 'found on the floor');

    const [event] = await audit.trailFor('print-element', element.publicId);
    expect(event.actor).toBeNull();
    expect(event.source).toBe('system');
  });
});
