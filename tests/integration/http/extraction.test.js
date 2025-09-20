'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { fakeClient, LICENCE_ANSWER, NOTE_ANSWER } = require('../../helpers/fakeOpenAi');
const {
  makeTitle,
  makeRightsHolder,
  makeVenue,
  makePrintElement,
} = require('../../helpers/factories');
const { resetConfigForTests } = require('../../../src/config/env');
const service = require('../../../src/services/extractionService');

const LETTER = [
  'We confirm the licence of THE RED SHOES for repertory exhibition in the',
  'United Kingdom from 1 January 2025 to 31 December 2025 at 35% of the gross.',
].join(' ');

describe('extraction endpoints', () => {
  let app;
  let title;
  let element;
  let client;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
    service.useClient(null);
    resetConfigForTests();
  });

  beforeEach(async () => {
    await clearCollections();
    process.env.EXTRACTION_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-test-0000000000000000000';
    resetConfigForTests();

    const holder = await makeRightsHolder({ name: 'Park Circus' });
    title = await makeTitle({ rightsHolder: holder._id });
    const vault = await makeVenue({ code: 'GB-BER-VAULT' });
    element = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
    });

    client = fakeClient();
    service.useClient(client);
  });

  it('reads a letter and answers with the job and its cost', async () => {
    client.answerWith(LICENCE_ANSWER);

    const res = await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: LETTER })
      .expect(201);

    expect(res.body.id).toMatch(/^exj_/);
    expect(res.body.status).toBe('succeeded');
    expect(res.body.costUsd).toMatch(/^\d+\.\d{4}$/);
    expect(res.body.result.territory).toBe('GB');
    expect(res.body.reused).toBe(false);
  });

  it('answers 200 and reused for a letter it has already read', async () => {
    client.answerWith(LICENCE_ANSWER);
    await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: LETTER })
      .expect(201);

    const res = await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: LETTER })
      .expect(200);

    expect(res.body.reused).toBe(true);
    expect(client.calls).toHaveLength(1);
  });

  it('refuses a scrap of text before it calls anything', async () => {
    await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: 'ok' })
      .expect(400);

    expect(client.calls).toHaveLength(0);
  });

  it('applies a reading as a draft licence', async () => {
    client.answerWith(LICENCE_ANSWER);
    const created = await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: LETTER })
      .expect(201);

    const res = await request(app)
      .put(`/extractions/${created.body.id}/apply`)
      .send({ reviewedBy: 'rights@archive.test' })
      .expect(200);

    expect(res.body.status).toBe('applied');
    expect(res.body.rightsWindow.status).toBe('draft');
    expect(res.body.rightsWindow.terms.percentageBps).toBe(3500);
  });

  it('reads a bench note and files it when applied', async () => {
    client.answerWith(NOTE_ANSWER);
    const created = await request(app)
      .post('/extractions/bench-notes')
      .send({ elementId: element.publicId, noteText: 'r2 sprockets chewed at 340ft, bad' })
      .expect(201);

    const res = await request(app)
      .put(`/extractions/${created.body.id}/apply`)
      .send({ reviewedBy: 'bench@archive.test', inspector: 'R. Fitzgerald' })
      .expect(200);

    expect(res.body.inspectionReport.findings[0].code).toBe('PERF-TEAR');
  });

  it('rejects a reading with a reason', async () => {
    client.answerWith(LICENCE_ANSWER);
    const created = await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: LETTER })
      .expect(201);

    const res = await request(app)
      .put(`/extractions/${created.body.id}/reject`)
      .send({ reviewedBy: 'rights@archive.test', reason: 'this is the draft letter' })
      .expect(200);

    expect(res.body.status).toBe('rejected');
  });

  it('will not reject without a reviewer and a reason', async () => {
    client.answerWith(LICENCE_ANSWER);
    const created = await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: LETTER })
      .expect(201);

    await request(app).put(`/extractions/${created.body.id}/reject`).send({}).expect(400);
  });

  it('lists the readings waiting for a human', async () => {
    client.answerWith({ ...LICENCE_ANSWER, confidence: 0.2 });
    await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: LETTER })
      .expect(201);

    const res = await request(app).get('/extractions?needsHumanReview=true').expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].result).toBeUndefined();
  });

  it('reports what extraction has cost', async () => {
    client.answerWith(LICENCE_ANSWER);
    await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: LETTER })
      .expect(201);

    const res = await request(app).get('/extractions/spend?hours=24').expect(200);

    expect(res.body.jobs).toBe(1);
    expect(res.body.tokens).toBe(920);
  });

  it('answers 422 when extraction is switched off', async () => {
    service.useClient(null);
    process.env.EXTRACTION_ENABLED = 'false';
    resetConfigForTests();

    const res = await request(app)
      .post('/extractions/licence-letters')
      .send({ titleId: title.publicId, contractText: LETTER })
      .expect(422);

    expect(res.body.error.message).toMatch(/switched off/);
  });
});
