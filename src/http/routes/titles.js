'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { publicId, listQuery } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const titleService = require('../../services/titleService');

const creditSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.enum(['director', 'writer', 'cinematographer', 'editor', 'composer', 'producer']),
});

const createBody = z.object({
  title: z.string().min(1).max(200),
  originalTitle: z.string().min(1).max(200).optional(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).optional(),
  year: z.number().int().min(1888).max(2100),
  credits: z.array(creditSchema).max(40).default([]),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10).default([]),
  originalLanguages: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(10).default([]),
  runtimeMinutes: z.number().int().min(1).max(1500).optional(),
  synopsis: z.string().max(4000).optional(),
  rightsHolderId: publicId('rh'),
});

const updateBody = createBody
  .omit({ rightsHolderId: true, slug: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'nothing to change' });

const statusBody = z.object({
  status: z.enum(['draft', 'bookable', 'withdrawn']),
  reason: z.string().min(3).max(500).optional(),
});

const listTitlesQuery = listQuery.extend({
  status: z.enum(['draft', 'bookable', 'withdrawn']).optional(),
  year: z.coerce.number().int().min(1888).max(2100).optional(),
  rightsHolderId: publicId('rh').optional(),
  search: z.string().min(2).max(80).optional(),
  sortBy: z.enum(['slug', 'year', 'createdAt']).default('slug'),
});

function titleRoutes() {
  const router = Router();

  router.post(
    '/',
    validate({ body: createBody }),
    asyncHandler(async (req, res) => {
      const title = await titleService.createTitle(req.valid.body);
      res.status(201).json(title.toJSON());
    }),
  );

  router.get(
    '/',
    validate({ query: listTitlesQuery }),
    asyncHandler(async (req, res) => {
      const page = await titleService.listTitles(req.valid.query);
      res.json(pageEnvelope(page));
    }),
  );

  router.get(
    '/:titleId',
    validate({ params: z.object({ titleId: publicId('ttl') }) }),
    asyncHandler(async (req, res) => {
      const title = await titleService.getTitle(req.valid.params.titleId);
      res.json(title.toJSON());
    }),
  );

  router.patch(
    '/:titleId',
    validate({ params: z.object({ titleId: publicId('ttl') }), body: updateBody }),
    asyncHandler(async (req, res) => {
      const title = await titleService.updateTitle(req.valid.params.titleId, req.valid.body);
      res.json(title.toJSON());
    }),
  );

  router.put(
    '/:titleId/status',
    validate({ params: z.object({ titleId: publicId('ttl') }), body: statusBody }),
    asyncHandler(async (req, res) => {
      const { status, reason } = req.valid.body;
      const title = await titleService.setTitleStatus(req.valid.params.titleId, status, reason);
      res.json(title.toJSON());
    }),
  );

  return router;
}

module.exports = { titleRoutes };
