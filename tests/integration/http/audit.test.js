'use strict';

const request = require('supertest');
const { buildTestApp, stubOperator } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { makePrintElement, makeVenue } = require('../../helpers/factories');
const elementService = require('../../../src/services/elementService');
const { runWithContext } = require('../../../src/lib/context');

describe('reading the audit trail', () => {
  let app;
  let element;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    element = await makePrintElement({ status: 'available' });
  });

  async function asOperator(actor, work) {
    return runWithContext({ actor, source: 'http', requestId: 'req-1' }, work);
  }

  it('answers a subject trail newest first', async () => {
    await asOperator('one@archive.test', () =>
      elementService.setStatus(element.publicId, 'quarantined', 'smells of vinegar'),
    );
    await asOperator('two@archive.test', () =>
      elementService.setStatus(element.publicId, 'retired', 'beyond repair'),
    );

    const res = await request(app)
      .get(`/audit-events/print-element/${element.publicId}`)
      .expect(200);

    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].changes[0].after).toBe('retired');
    expect(res.body.items[0].actor).toBe('two@archive.test');
  });

  it('filters the whole trail by actor, action and source', async () => {
    await asOperator('one@archive.test', () =>
      elementService.setStatus(element.publicId, 'quarantined', 'damage'),
    );

    const byActor = await request(app).get('/audit-events?actor=one@archive.test').expect(200);
    expect(byActor.body.items).toHaveLength(1);

    const byAction = await request(app)
      .get('/audit-events?action=element.status-changed')
      .expect(200);
    expect(byAction.body.items).toHaveLength(1);

    const bySource = await request(app).get('/audit-events?source=cli').expect(200);
    expect(bySource.body.items).toHaveLength(0);
  });

  it('filters by when it happened', async () => {
    await asOperator('one@archive.test', () =>
      elementService.setStatus(element.publicId, 'quarantined', 'damage'),
    );

    const inside = await request(app)
      .get(`/audit-events?from=${new Date(Date.now() - 60000).toISOString()}`)
      .expect(200);
    expect(inside.body.items).toHaveLength(1);

    const after = await request(app)
      .get(`/audit-events?from=${new Date(Date.now() + 60000).toISOString()}`)
      .expect(200);
    expect(after.body.items).toHaveLength(0);
  });

  it('pages the trail with a cursor', async () => {
    const other = await makeVenue({ code: 'GB-LON-BFI' });
    await asOperator('one@archive.test', () =>
      elementService.relocate(element.publicId, other.publicId, 'moved'),
    );
    await asOperator('one@archive.test', () =>
      elementService.setStatus(element.publicId, 'quarantined', 'damage'),
    );

    const first = await request(app).get('/audit-events?limit=1').expect(200);
    expect(first.body.page.hasMore).toBe(true);

    const second = await request(app)
      .get(`/audit-events?limit=1&cursor=${encodeURIComponent(first.body.page.nextCursor)}`)
      .expect(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
  });

  it('says who has touched a record and how often', async () => {
    await asOperator('one@archive.test', () =>
      elementService.setStatus(element.publicId, 'quarantined', 'damage'),
    );
    await asOperator('one@archive.test', () =>
      elementService.setStatus(element.publicId, 'available', 'cleared'),
    );
    await asOperator('two@archive.test', () =>
      elementService.setStatus(element.publicId, 'retired', 'beyond repair'),
    );

    const res = await request(app)
      .get(`/audit-events/print-element/${element.publicId}/actors`)
      .expect(200);

    expect(res.body.items[0]).toMatchObject({ actor: 'one@archive.test', changes: 2 });
    expect(res.body.items[1]).toMatchObject({ actor: 'two@archive.test', changes: 1 });
  });

  it('refuses a subject type it does not audit', async () => {
    await request(app).get('/audit-events/pigeon/abc').expect(400);
  });

  it('only an admin reads the whole trail', async () => {
    const { app: archivist } = buildTestApp({ operator: stubOperator({ role: 'archivist' }) });

    await request(archivist).get('/audit-events').expect(403);
    await request(archivist).get(`/audit-events/print-element/${element.publicId}`).expect(200);
  });

  it('a viewer reads none of it', async () => {
    const { app: viewer } = buildTestApp({ operator: stubOperator({ role: 'viewer' }) });

    await request(viewer).get('/audit-events').expect(403);
    await request(viewer).get(`/audit-events/print-element/${element.publicId}`).expect(403);
  });
});
