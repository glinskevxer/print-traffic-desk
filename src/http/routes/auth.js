'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { publicId, listQuery } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { ROLES } = require('../../models/operator');
const { isoDate } = require('../schemas/common');
const service = require('../../services/authService');

const signInBody = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(200),
});

const createOperatorBody = z.object({
  email: z.string().email().max(160),
  name: z.string().min(2).max(120),
  role: z.enum(ROLES),
  password: z.string().min(12).max(200),
  venueId: publicId('ven').optional(),
});

const listOperatorsQuery = listQuery.extend({
  role: z.enum(ROLES).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

/**
 * The sign in path is mounted before the desk wide token check, so the routes
 * here that do need an operator ask for one themselves. The middleware is
 * taken rather than built, so a test can hand in a known operator the same way
 * it does everywhere else.
 */
function authRoutes({ authenticateWith } = {}) {
  const router = Router();
  const needsOperator = authenticateWith || authenticate();

  router.post(
    '/sign-in',
    validate({ body: signInBody }),
    asyncHandler(async (req, res) => {
      res.json(await service.signIn({ ...req.valid.body, from: req.ip }));
    }),
  );

  router.get(
    '/me',
    needsOperator,
    asyncHandler(async (req, res) => {
      res.json({
        id: req.operator.publicId,
        email: req.operator.email,
        name: req.operator.name,
        role: req.operator.role,
        venue: req.operator.venue,
        expiresAt: new Date(req.claims.exp * 1000),
      });
    }),
  );

  router.put(
    '/password',
    needsOperator,
    validate({
      body: z.object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(12).max(200),
      }),
    }),
    asyncHandler(async (req, res) => {
      await service.changePassword(req.operator.publicId, req.valid.body);
      res.json({ changed: true });
    }),
  );

  router.post(
    '/operators',
    needsOperator,
    requireRole('admin'),
    validate({ body: createOperatorBody }),
    asyncHandler(async (req, res) => {
      const operator = await service.createOperator(req.valid.body);
      res.status(201).json(operator.toJSON());
    }),
  );

  router.get(
    '/operators',
    needsOperator,
    requireRole('admin'),
    validate({ query: listOperatorsQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await service.listOperators(req.valid.query)));
    }),
  );

  router.put(
    '/operators/:operatorId/role',
    needsOperator,
    requireRole('admin'),
    validate({
      params: z.object({ operatorId: publicId('op') }),
      body: z.object({ role: z.enum(ROLES) }),
    }),
    asyncHandler(async (req, res) => {
      const operator = await service.setRole(req.valid.params.operatorId, req.valid.body.role);
      res.json(operator.toJSON());
    }),
  );

  router.delete(
    '/operators/:operatorId',
    needsOperator,
    requireRole('admin'),
    validate({ params: z.object({ operatorId: publicId('op') }) }),
    asyncHandler(async (req, res) => {
      res.json((await service.deactivate(req.valid.params.operatorId)).toJSON());
    }),
  );

  router.post(
    '/api-keys',
    needsOperator,
    requireRole('admin'),
    validate({
      body: z.object({
        name: z.string().min(3).max(120),
        role: z.enum(ROLES),
        venueId: publicId('ven').optional(),
        expiresOn: isoDate.optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { key, presented } = await service.createApiKey({
        ...req.valid.body,
        createdBy: req.operator.email,
      });
      // The only time the secret exists outside the caller's hands.
      res.status(201).json({ ...key.toJSON(), secret: presented });
    }),
  );

  router.get(
    '/api-keys',
    needsOperator,
    requireRole('admin'),
    validate({
      query: listQuery.extend({
        role: z.enum(ROLES).optional(),
        live: z
          .enum(['true', 'false'])
          .transform((value) => value === 'true')
          .optional(),
      }),
    }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await service.listApiKeys(req.valid.query)));
    }),
  );

  router.delete(
    '/api-keys/:keyId',
    needsOperator,
    requireRole('admin'),
    validate({
      params: z.object({ keyId: publicId('key') }),
      body: z.object({ reason: z.string().min(3).max(400) }),
    }),
    asyncHandler(async (req, res) => {
      const key = await service.revokeApiKey(req.valid.params.keyId, {
        reason: req.valid.body.reason,
        revokedBy: req.operator.email,
      });
      res.json(key.toJSON());
    }),
  );

  return router;
}

module.exports = { authRoutes };
