'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { listWith } = require('../db/listing');
const { RuleRefusedError, ConflictError, DeskError, CODES } = require('../lib/errors');
const audit = require('../lib/audit');
const { config } = require('../config/env');
const { createClient } = require('../ai/client');
const { costOf } = require('../ai/pricing');
const licence = require('../ai/extractLicenceTerms');
const notes = require('../ai/normaliseInspectionNotes');
const rightsService = require('./rightsService');
const inspectionService = require('./inspectionService');

/**
 * The desk's side of extraction: budgets, caching, the job record and the
 * review step. The reading itself lives in src/ai, which knows nothing about
 * mongo, and this knows nothing about prompts.
 */

let injectedClient = null;

/** Tests and the CLI hand in their own client rather than a key. */
function useClient(client) {
  injectedClient = client;
}

function extractionClient(cfg = config()) {
  if (injectedClient) return injectedClient;
  if (!cfg.extraction.enabled) {
    throw new RuleRefusedError('extraction is switched off on this desk', {
      setting: 'EXTRACTION_ENABLED',
    });
  }
  return createClient({
    apiKey: cfg.extraction.apiKey,
    model: cfg.extraction.model,
    baseURL: cfg.extraction.baseUrl,
    timeoutMs: cfg.extraction.timeoutMs,
    attempts: cfg.extraction.maxAttempts,
  });
}

function previewOf(text) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** Tokens spent since an instant, for the daily budget. */
async function tokensUsedSince(since) {
  const { ExtractionJob } = models();
  const [summary] = await ExtractionJob.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        tokens: { $sum: { $add: ['$usage.promptTokens', '$usage.completionTokens'] } },
        costHundredthCents: { $sum: '$usage.costHundredthCents' },
        jobs: { $sum: 1 },
      },
    },
  ]);
  return summary || { tokens: 0, costHundredthCents: 0, jobs: 0 };
}

async function assertWithinBudget(cfg) {
  if (cfg.extraction.dailyTokenBudget === 0) return;
  const since = new Date(Date.now() - 86400000);
  const { tokens } = await tokensUsedSince(since);
  if (tokens >= cfg.extraction.dailyTokenBudget) {
    throw new RuleRefusedError('the extraction budget for today is spent', {
      tokens,
      budget: cfg.extraction.dailyTokenBudget,
    });
  }
}

/** An identical document already read by the same model and prompt. */
async function reusableJob({ kind, inputHash, model, promptVersion }) {
  const { ExtractionJob } = models();
  return ExtractionJob.findOne({
    kind,
    inputHash,
    model,
    promptVersion,
    status: { $in: ['succeeded', 'applied'] },
  }).sort({ createdAt: -1 });
}

async function runExtraction({ kind, subjectType, subject, text, requestedBy, read }) {
  const cfg = config();
  const client = extractionClient(cfg);
  const { ExtractionJob } = models();

  await assertWithinBudget(cfg);

  const job = await ExtractionJob.create({
    kind,
    subjectType,
    subject: subject._id,
    subjectPublicId: subject.publicId,
    inputHash: 'pending',
    inputPreview: previewOf(text),
    inputLength: text.length,
    model: client.model,
    promptVersion: 'pending',
    status: 'running',
    requestedBy,
  });

  try {
    const outcome = await read(client);
    const cost = costOf({ model: outcome.model, ...outcome.usage });

    job.inputHash = outcome.fingerprint;
    job.promptVersion = outcome.promptVersion;
    job.model = outcome.requestedModel || client.model;
    job.resolvedModel = outcome.model;
    job.result = outcome.extracted;
    job.confidence = outcome.extracted.confidence;
    job.needsHumanReview =
      outcome.extracted.confidence < cfg.extraction.confidenceFloor ||
      outcome.extracted.unclear.length > 0;
    job.usage = {
      promptTokens: outcome.usage.promptTokens,
      completionTokens: outcome.usage.completionTokens,
      costHundredthCents: cost.totalHundredthCents,
    };
    job.status = 'succeeded';
    job.attempts.push({ outcome: 'succeeded', elapsedMs: outcome.elapsedMs });
    await job.save();

    await audit.record({
      action: `extraction.${kind}.succeeded`,
      subjectType: 'title',
      subjectId: job.publicId,
      metadata: {
        subject: subject.publicId,
        confidence: job.confidence,
        needsHumanReview: job.needsHumanReview,
        tokens: job.totalTokens,
      },
    });

    return job;
  } catch (err) {
    job.status = 'failed';
    job.attempts.push({
      outcome: 'failed',
      errorCode: err.code || CODES.INTERNAL,
      errorMessage: String(err.message).slice(0, 500),
    });
    await job.save();
    throw err;
  }
}

async function readLicenceLetter({ titleId, contractText, requestedBy }) {
  const { Title, RightsHolder } = models();
  const cfg = config();

  const title = await required(Title, titleId);
  const rightsHolder = await RightsHolder.findById(title.rightsHolder);

  const text = licence.assertReadable(contractText);
  const cached = await reusableJob({
    kind: 'licence-terms',
    inputHash: licence.fingerprint({
      contractText: text,
      model: cfg.extraction.model,
      promptVersion: licence.PROMPT_VERSION,
    }),
    model: cfg.extraction.model,
    promptVersion: licence.PROMPT_VERSION,
  });
  if (cached) return { job: cached, reused: true };

  const job = await runExtraction({
    kind: 'licence-terms',
    subjectType: 'title',
    subject: title,
    text,
    requestedBy,
    read: (client) =>
      licence.extractLicenceTerms({
        client,
        contractText: text,
        title,
        rightsHolder,
        defaultCurrency: cfg.desk.defaultCurrency,
      }),
  });
  return { job, reused: false };
}

async function readBenchNote({ elementId, noteText, requestedBy }) {
  const { PrintElement } = models();
  const cfg = config();

  const element = await required(PrintElement, elementId);
  const text = notes.assertReadable(noteText);

  const cached = await reusableJob({
    kind: 'inspection-notes',
    inputHash: notes.fingerprint({
      noteText: text,
      model: cfg.extraction.model,
      promptVersion: notes.PROMPT_VERSION,
    }),
    model: cfg.extraction.model,
    promptVersion: notes.PROMPT_VERSION,
  });
  if (cached) return { job: cached, reused: true };

  const job = await runExtraction({
    kind: 'inspection-notes',
    subjectType: 'print-element',
    subject: element,
    text,
    requestedBy,
    read: (client) => notes.normaliseInspectionNotes({ client, noteText: text, element }),
  });
  return { job, reused: false };
}

function assertApplicable(job) {
  if (job.status === 'applied') {
    throw new ConflictError('that reading has already been applied', {
      job: job.publicId,
      appliedTo: job.appliedTo,
    });
  }
  if (job.status !== 'succeeded') {
    throw new RuleRefusedError('only a successful reading can be applied', {
      job: job.publicId,
      status: job.status,
    });
  }
}

/**
 * A human turns a reading into a record. The reviewer is recorded on both
 * sides, because "the machine said so" is not an answer a distributor accepts.
 */
async function applyLicenceExtraction(jobPublicId, { reviewedBy }) {
  const { ExtractionJob, Title } = models();
  const job = await required(ExtractionJob, jobPublicId);
  assertApplicable(job);
  if (job.kind !== 'licence-terms') {
    throw new RuleRefusedError('that reading is not a licence', { job: jobPublicId });
  }

  const title = await Title.findById(job.subject);
  const holder = await models().RightsHolder.findById(title.rightsHolder);
  const input = licence.toWindowInput(job.result, {
    titleId: title.publicId,
    rightsHolderId: holder.publicId,
  });

  const window = await rightsService.createWindow(input);
  window.sourceDocument = {
    extractionJob: job._id,
    confidence: job.confidence,
    reviewedBy,
  };
  await window.save();

  job.status = 'applied';
  job.appliedTo = window.publicId;
  job.reviewedBy = reviewedBy;
  job.reviewedAt = new Date();
  await job.save();

  return { job, window };
}

async function applyInspectionExtraction(jobPublicId, { reviewedBy, inspector, kind = 'routine' }) {
  const { ExtractionJob, PrintElement } = models();
  const job = await required(ExtractionJob, jobPublicId);
  assertApplicable(job);
  if (job.kind !== 'inspection-notes') {
    throw new RuleRefusedError('that reading is not a bench note', { job: jobPublicId });
  }

  const element = await PrintElement.findById(job.subject);
  const input = notes.toInspectionInput(job.result, { inspector: inspector || reviewedBy, kind });
  const { report } = await inspectionService.recordInspection(element.publicId, input);

  job.status = 'applied';
  job.appliedTo = report.publicId;
  job.reviewedBy = reviewedBy;
  job.reviewedAt = new Date();
  await job.save();

  return { job, report };
}

async function rejectExtraction(jobPublicId, { reviewedBy, reason }) {
  const { ExtractionJob } = models();
  const job = await required(ExtractionJob, jobPublicId);

  if (job.status === 'applied') {
    throw new ConflictError('that reading has already been applied', { job: jobPublicId });
  }
  if (!reason) {
    throw new RuleRefusedError('rejecting a reading needs a reason', { job: jobPublicId });
  }

  job.status = 'rejected';
  job.rejectedReason = reason;
  job.reviewedBy = reviewedBy;
  job.reviewedAt = new Date();
  await job.save();
  return job;
}

async function getJob(publicId) {
  const { ExtractionJob } = models();
  return required(ExtractionJob, publicId);
}

async function listJobs(query = {}) {
  const { ExtractionJob } = models();
  const filter = {};
  if (query.kind) filter.kind = query.kind;
  if (query.status) filter.status = query.status;
  if (query.needsHumanReview !== undefined) filter.needsHumanReview = query.needsHumanReview;

  // The result is the whole extracted licence or the whole set of findings.
  // A review queue lists thirty of them and reads one.
  return listWith(ExtractionJob, {
    filter,
    query: { order: 'desc', ...query },
    sortField: 'createdAt',
    projection: '-result -attempts',
  });
}

module.exports = {
  useClient,
  extractionClient,
  previewOf,
  tokensUsedSince,
  reusableJob,
  readLicenceLetter,
  readBenchNote,
  applyLicenceExtraction,
  applyInspectionExtraction,
  rejectExtraction,
  getJob,
  listJobs,
  DeskError,
};
