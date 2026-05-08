'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { idempotency } = require('../middleware/idempotency');
const { publicId, listQuery } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { EXTRACTION_KINDS } = require('../../ai/schemas');
const { JOB_STATUSES } = require('../../models/extractionJob');
const { toDollars } = require('../../ai/pricing');
const { INSPECTION_KINDS } = require('../../models/inspectionReport');
const service = require('../../services/extractionService');

const readLetterBody = z.object({
  titleId: publicId('ttl'),
  contractText: z.string().min(40).max(60000),
  requestedBy: z.string().min(3).max(160).optional(),
});

const readNoteBody = z.object({
  elementId: publicId('elem'),
  noteText: z.string().min(10).max(20000),
  requestedBy: z.string().min(3).max(160).optional(),
});

const listJobsQuery = listQuery.extend({
  kind: z.enum(EXTRACTION_KINDS).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  needsHumanReview: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const jobParams = z.object({ jobId: publicId('exj') });

/**
 * A job is answered without its result unless somebody asks for the job
 * itself. A list of thirty readings with thirty licence drafts inline is
 * unreadable, and the review screen fetches the one it is showing.
 */
function jobSummary(job) {
  return {
    id: job.publicId,
    kind: job.kind,
    status: job.status,
    subject: job.subjectPublicId,
    confidence: job.confidence,
    needsHumanReview: job.needsHumanReview,
    model: job.model,
    promptVersion: job.promptVersion,
    tokens: job.totalTokens,
    costUsd: toDollars(job.usage.costHundredthCents),
    appliedTo: job.appliedTo,
    createdAt: job.createdAt,
  };
}

function extractionRoutes() {
  const router = Router();

  router.post(
    '/licence-letters',
    requireRole('programmer'),
    idempotency(),
    validate({ body: readLetterBody }),
    asyncHandler(async (req, res) => {
      const { job, reused } = await service.readLicenceLetter(req.valid.body);
      res.status(reused ? 200 : 201).json({ ...jobSummary(job), reused, result: job.result });
    }),
  );

  router.post(
    '/bench-notes',
    requireRole('archivist'),
    idempotency(),
    validate({ body: readNoteBody }),
    asyncHandler(async (req, res) => {
      const { job, reused } = await service.readBenchNote(req.valid.body);
      res.status(reused ? 200 : 201).json({ ...jobSummary(job), reused, result: job.result });
    }),
  );

  router.get(
    '/',
    validate({ query: listJobsQuery }),
    asyncHandler(async (req, res) => {
      const page = await service.listJobs(req.valid.query);
      res.json(pageEnvelope(page, jobSummary));
    }),
  );

  router.get(
    '/spend',
    validate({ query: z.object({ hours: z.coerce.number().int().min(1).max(720).default(24) }) }),
    asyncHandler(async (req, res) => {
      const since = new Date(Date.now() - req.valid.query.hours * 3600000);
      const used = await service.tokensUsedSince(since);
      res.json({
        since,
        jobs: used.jobs,
        tokens: used.tokens,
        costUsd: toDollars(used.costHundredthCents),
      });
    }),
  );

  router.get(
    '/queue',
    asyncHandler(async (_req, res) => {
      res.json(await service.queueSummary());
    }),
  );

  router.post(
    '/review',
    requireRole('admin'),
    validate({
      body: z.object({
        reviewedBy: z.string().min(3).max(160),
        decisions: z
          .array(
            z.object({
              jobId: publicId('exj'),
              decision: z.enum(['apply', 'reject']),
              reason: z.string().min(3).max(400).optional(),
              inspector: z.string().min(2).max(120).optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
    }),
    asyncHandler(async (req, res) => {
      const result = await service.reviewBatch(req.valid.body.decisions, {
        reviewedBy: req.valid.body.reviewedBy,
      });
      res.status(result.failed > 0 ? 207 : 200).json(result);
    }),
  );

  router.get(
    '/:jobId',
    validate({ params: jobParams }),
    asyncHandler(async (req, res) => {
      const job = await service.getJob(req.valid.params.jobId);
      res.json({ ...jobSummary(job), result: job.result, attempts: job.attempts });
    }),
  );

  router.put(
    '/:jobId/apply',
    requireRole('admin'),
    validate({
      params: jobParams,
      body: z.object({
        reviewedBy: z.string().min(3).max(160),
        inspector: z.string().min(2).max(120).optional(),
        inspectionKind: z.enum(INSPECTION_KINDS).optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const job = await service.getJob(req.valid.params.jobId);

      if (job.kind === 'licence-terms') {
        const applied = await service.applyLicenceExtraction(job.publicId, req.valid.body);
        return res.json({ ...jobSummary(applied.job), rightsWindow: applied.window.toJSON() });
      }

      const applied = await service.applyInspectionExtraction(job.publicId, {
        ...req.valid.body,
        kind: req.valid.body.inspectionKind,
      });
      return res.json({ ...jobSummary(applied.job), inspectionReport: applied.report.toJSON() });
    }),
  );

  router.put(
    '/:jobId/reject',
    requireRole('programmer'),
    validate({
      params: jobParams,
      body: z.object({
        reviewedBy: z.string().min(3).max(160),
        reason: z.string().min(3).max(400),
      }),
    }),
    asyncHandler(async (req, res) => {
      const job = await service.rejectExtraction(req.valid.params.jobId, req.valid.body);
      res.json(jobSummary(job));
    }),
  );

  return router;
}

module.exports = { extractionRoutes, jobSummary };
