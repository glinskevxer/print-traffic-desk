'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { openTestConnection, closeTestConnection, clearCollections } = require('../../helpers/db');
const { registerModels, syncIndexes } = require('../../../src/models');
const { makePrintElement } = require('../../helpers/factories');

describe('inspection endpoints', () => {
  let app;

  beforeAll(async () => {
    const conn = await openTestConnection();
    registerModels(conn);
    await syncIndexes();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  const report = (overrides = {}) => ({
    inspector: 'R. Fitzgerald',
    kind: 'routine',
    findings: [],
    ...overrides,
  });

  it('files a report and answers with what it did to the element', async () => {
    const element = await makePrintElement({ conditionGrade: 'C' });

    const res = await request(app)
      .post(`/elements/${element.publicId}/inspections`)
      .send(report({ findings: [{ reel: 1, code: 'SCRATCH-BASE', severity: 'minor' }] }))
      .expect(201);

    expect(res.body.id).toMatch(/^insp_/);
    expect(res.body.assessment.grade).toBe('A');
    expect(res.body.element.grade).toBe('A');
    expect(res.body.reasons[0]).toMatch(/damage density/);
  });

  it('refuses a finding code the vocabulary does not hold', async () => {
    const element = await makePrintElement();

    const res = await request(app)
      .post(`/elements/${element.publicId}/inspections`)
      .send(report({ findings: [{ reel: 1, code: 'LOOKS-ROUGH', severity: 'minor' }] }))
      .expect(400);

    expect(res.body.error.details.issues[0].key).toMatch(/findings\.0\.code/);
  });

  it('refuses a shrinkage reading that is off the scale', async () => {
    const element = await makePrintElement();

    await request(app)
      .post(`/elements/${element.publicId}/inspections`)
      .send(report({ measurements: { shrinkagePercent: 40 } }))
      .expect(400);
  });

  it('previews a verdict without filing anything', async () => {
    const element = await makePrintElement();

    const preview = await request(app)
      .post(`/elements/${element.publicId}/inspections/preview`)
      .send({ measurements: { shrinkagePercent: 1.2 } })
      .expect(200);

    expect(preview.body.verdict).toBe('projectable-with-restrictions');
    expect(preview.body.restrictions).toContain('reduced-speed');

    const history = await request(app)
      .get(`/elements/${element.publicId}/inspections`)
      .expect(200);
    expect(history.body.items).toHaveLength(0);
  });

  it('reads the history of one element newest first', async () => {
    const element = await makePrintElement();
    await request(app)
      .post(`/elements/${element.publicId}/inspections`)
      .send(report({ inspectedAt: '2025-01-05T09:00:00Z' }))
      .expect(201);
    await request(app)
      .post(`/elements/${element.publicId}/inspections`)
      .send(report({ kind: 'pre-despatch', inspectedAt: '2025-02-05T09:00:00Z' }))
      .expect(201);

    const res = await request(app).get(`/elements/${element.publicId}/inspections`).expect(200);

    expect(res.body.items.map((r) => r.kind)).toEqual(['pre-despatch', 'routine']);
  });

  it('finds every quarantine across the collection', async () => {
    const first = await makePrintElement();
    const second = await makePrintElement();
    await request(app)
      .post(`/elements/${first.publicId}/inspections`)
      .send(report({ measurements: { adStripLevel: 2 } }))
      .expect(201);
    await request(app).post(`/elements/${second.publicId}/inspections`).send(report()).expect(201);

    const res = await request(app).get('/inspections?verdict=quarantine').expect(200);

    expect(res.body.items).toHaveLength(1);
  });

  it('lists what is due a look', async () => {
    await makePrintElement({ screeningsSinceInspection: 12, inspectionIntervalScreenings: 6 });
    await makePrintElement({ screeningsSinceInspection: 0, inspectionIntervalScreenings: 6 });

    const res = await request(app).get('/inspections/due').expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].screeningsSinceInspection).toBe(12);
  });

  it('reads one report back by its own id', async () => {
    const element = await makePrintElement();
    const created = await request(app)
      .post(`/elements/${element.publicId}/inspections`)
      .send(report())
      .expect(201);

    const res = await request(app).get(`/inspections/${created.body.id}`).expect(200);

    expect(res.body.inspector).toBe('R. Fitzgerald');
  });

  it('answers 404 for a report that is not there', async () => {
    await request(app).get('/inspections/insp_0000000000000000').expect(404);
  });
});
