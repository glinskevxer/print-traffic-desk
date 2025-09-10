'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { makeTitle } = require('../../helpers/factories');

describe('extraction job model', () => {
  let ExtractionJob;

  beforeAll(async () => {
    ({ ExtractionJob } = await useDatabase());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  afterEach(async () => {
    await clearCollections();
  });

  async function job(overrides = {}) {
    const title = await makeTitle();
    return ExtractionJob.create({
      kind: 'licence-terms',
      subjectType: 'title',
      subject: title._id,
      subjectPublicId: title.publicId,
      inputHash: 'a'.repeat(64),
      inputPreview: 'We confirm the licence of THE RED SHOES',
      inputLength: 420,
      model: 'gpt-4o-mini',
      promptVersion: 'licence-terms/3',
      ...overrides,
    });
  }

  it('opens a job queued and needing a human', async () => {
    const created = await job();

    expect(created.publicId).toMatch(/^exj_/);
    expect(created.status).toBe('queued');
    expect(created.needsHumanReview).toBe(true);
    expect(created.totalTokens).toBe(0);
  });

  it('refuses a kind the desk does not extract', async () => {
    await expect(job({ kind: 'screenplay' })).rejects.toThrow(/kind/);
  });

  it('keeps only a preview of the document, never the whole thing', async () => {
    const created = await job({ inputPreview: 'x'.repeat(500) });

    expect(created.inputPreview.length).toBeLessThanOrEqual(240);
  });

  it('adds the tokens up', async () => {
    const created = await job({
      usage: { promptTokens: 800, completionTokens: 120, costHundredthCents: 19 },
    });

    expect(created.totalTokens).toBe(920);
  });

  it('counts the attempts that failed', async () => {
    const created = await job({
      attempts: [
        { outcome: 'failed', errorCode: 'upstream_failed' },
        { outcome: 'failed', errorCode: 'rate_limited' },
        { outcome: 'succeeded' },
      ],
    });

    expect(created.failureCount()).toBe(2);
  });

  it('knows which jobs an answer can be reused from', async () => {
    expect((await job({ status: 'succeeded' })).isReusable()).toBe(true);
    expect((await job({ status: 'applied' })).isReusable()).toBe(true);
    expect((await job({ status: 'failed' })).isReusable()).toBe(false);
    expect((await job({ status: 'queued' })).isReusable()).toBe(false);
  });

  it('refuses a confidence outside nought to one', async () => {
    await expect(job({ confidence: 1.5 })).rejects.toThrow(/confidence/);
  });
});
