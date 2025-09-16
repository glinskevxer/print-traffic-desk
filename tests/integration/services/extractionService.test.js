'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
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

const NOTE = 'r2 sprockets chewed around 340ft, bad. shrinkage reads 0.8pc';

describe('extraction as the desk runs it', () => {
  let holder;
  let title;
  let element;
  let client;

  beforeAll(async () => {
    await useDatabase();
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

    holder = await makeRightsHolder({ name: 'Park Circus' });
    title = await makeTitle({ rightsHolder: holder._id, slug: 'the-red-shoes' });
    const vault = await makeVenue({ code: 'GB-BER-VAULT' });
    element = await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      reelCount: 6,
    });

    client = fakeClient();
    service.useClient(client);
  });

  it('reads a letter and files the job with its cost', async () => {
    client.answerWith(LICENCE_ANSWER);

    const { job, reused } = await service.readLicenceLetter({
      titleId: title.publicId,
      contractText: LETTER,
      requestedBy: 'rights@archive.test',
    });

    expect(reused).toBe(false);
    expect(job.status).toBe('succeeded');
    expect(job.confidence).toBe(0.9);
    expect(job.usage.promptTokens).toBe(800);
    expect(job.usage.costHundredthCents).toBeGreaterThan(0);
    expect(job.needsHumanReview).toBe(false);
  });

  it('keeps a preview of the letter and not the letter', async () => {
    client.answerWith(LICENCE_ANSWER);

    const { job } = await service.readLicenceLetter({
      titleId: title.publicId,
      contractText: `${LETTER} ${'x'.repeat(1000)}`,
    });

    expect(job.inputPreview.length).toBeLessThanOrEqual(240);
    expect(job.inputHash).toHaveLength(64);
  });

  it('reuses an identical letter rather than paying twice', async () => {
    client.answerWith(LICENCE_ANSWER);
    const first = await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });

    const second = await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });

    expect(second.reused).toBe(true);
    expect(second.job.publicId).toBe(first.job.publicId);
    expect(client.calls).toHaveLength(1);
  });

  it('flags a reading the model was not sure about', async () => {
    client.answerWith({ ...LICENCE_ANSWER, confidence: 0.4 });

    const { job } = await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });

    expect(job.needsHumanReview).toBe(true);
  });

  it('flags a reading with anything unclear on it', async () => {
    client.answerWith({
      ...LICENCE_ANSWER,
      confidence: 0.99,
      unclear: [{ field: 'maxScreenings', why: 'the letter says a reasonable number' }],
    });

    const { job } = await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });

    expect(job.needsHumanReview).toBe(true);
  });

  it('records a failed reading rather than losing it', async () => {
    client.answerWith({ territory: 'Scandinavia' });

    await expect(
      service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER }),
    ).rejects.toThrow(/cannot use/);

    const { ExtractionJob } = models();
    const [job] = await ExtractionJob.find({});
    expect(job.status).toBe('failed');
    expect(job.attempts[0].errorCode).toBe('validation_failed');
  });

  it('will not run at all when extraction is switched off', async () => {
    service.useClient(null);
    process.env.EXTRACTION_ENABLED = 'false';
    resetConfigForTests();

    await expect(
      service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER }),
    ).rejects.toThrow(/switched off/);
  });

  it('stops once the budget for the day is spent', async () => {
    process.env.EXTRACTION_DAILY_TOKEN_BUDGET = '100';
    resetConfigForTests();
    client.answerWith(LICENCE_ANSWER);
    await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });

    client.answerWith(LICENCE_ANSWER);
    await expect(
      service.readLicenceLetter({ titleId: title.publicId, contractText: `${LETTER} second` }),
    ).rejects.toThrow(/budget for today is spent/);

    delete process.env.EXTRACTION_DAILY_TOKEN_BUDGET;
    resetConfigForTests();
  });

  it('turns an applied reading into a draft licence, never a live one', async () => {
    client.answerWith(LICENCE_ANSWER);
    const { job } = await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });

    const { window } = await service.applyLicenceExtraction(job.publicId, {
      reviewedBy: 'rights@archive.test',
    });

    expect(window.status).toBe('draft');
    expect(window.terms.percentageBps).toBe(3500);
    expect(window.sourceDocument.reviewedBy).toBe('rights@archive.test');
    expect(String(window.sourceDocument.extractionJob)).toBe(String(job._id));
  });

  it('will not apply the same reading twice', async () => {
    client.answerWith(LICENCE_ANSWER);
    const { job } = await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });
    await service.applyLicenceExtraction(job.publicId, { reviewedBy: 'a@b.test' });

    await expect(
      service.applyLicenceExtraction(job.publicId, { reviewedBy: 'a@b.test' }),
    ).rejects.toThrow(/already been applied/);
  });

  it('rejects a reading with a reason and will not apply it after', async () => {
    client.answerWith(LICENCE_ANSWER);
    const { job } = await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });

    const rejected = await service.rejectExtraction(job.publicId, {
      reviewedBy: 'rights@archive.test',
      reason: 'the letter is a draft, not the executed one',
    });
    expect(rejected.status).toBe('rejected');

    await expect(
      service.applyLicenceExtraction(job.publicId, { reviewedBy: 'a@b.test' }),
    ).rejects.toThrow(/only a successful reading/);
  });

  it('reads a bench note into findings and files them when applied', async () => {
    client.answerWith(NOTE_ANSWER);
    const { job } = await service.readBenchNote({ elementId: element.publicId, noteText: NOTE });

    const { report } = await service.applyInspectionExtraction(job.publicId, {
      reviewedBy: 'bench@archive.test',
      inspector: 'R. Fitzgerald',
    });

    expect(report.source).toBe('extracted');
    expect(report.findings[0].code).toBe('PERF-TEAR');
    expect(report.assessment.grade).toBe('C');
  });

  it('will not apply a bench note as a licence', async () => {
    client.answerWith(NOTE_ANSWER);
    const { job } = await service.readBenchNote({ elementId: element.publicId, noteText: NOTE });

    await expect(
      service.applyLicenceExtraction(job.publicId, { reviewedBy: 'a@b.test' }),
    ).rejects.toThrow(/not a licence/);
  });

  it('adds the day up for the budget report', async () => {
    client.answerWith(LICENCE_ANSWER);
    await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });

    const used = await service.tokensUsedSince(new Date(Date.now() - 86400000));

    expect(used.tokens).toBe(920);
    expect(used.jobs).toBe(1);
  });

  it('lists the readings waiting for a human', async () => {
    client.answerWith({ ...LICENCE_ANSWER, confidence: 0.3 });
    await service.readLicenceLetter({ titleId: title.publicId, contractText: LETTER });

    const page = await service.listJobs({ needsHumanReview: true });

    expect(page.items).toHaveLength(1);
  });
});
