'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../asyncHandler');
const { validate } = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { publicId, listQuery } = require('../schemas/common');
const { pageEnvelope } = require('../../lib/pagination');
const { ROLES } = require('../../models/operator');
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

function authRoutes() {
  const router = Router();

  router.post(
    '/sign-in',
    validate({ body: signInBody }),
    asyncHandler(async (req, res) => {
      res.json(await service.signIn({ ...req.valid.body, from: req.ip }));
    }),
  );

  router.get(
    '/me',
    authenticate(),
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
    authenticate(),
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
    authenticate(),
    requireRole('admin'),
    validate({ body: createOperatorBody }),
    asyncHandler(async (req, res) => {
      const operator = await service.createOperator(req.valid.body);
      res.status(201).json(operator.toJSON());
    }),
  );

  router.get(
    '/operators',
    authenticate(),
    requireRole('admin'),
    validate({ query: listOperatorsQuery }),
    asyncHandler(async (req, res) => {
      res.json(pageEnvelope(await service.listOperators(req.valid.query)));
    }),
  );

  router.put(
    '/operators/:operatorId/role',
    authenticate(),
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
    authenticate(),
    requireRole('admin'),
    validate({ params: z.object({ operatorId: publicId('op') }) }),
    asyncHandler(async (req, res) => {
      res.json((await service.deactivate(req.valid.params.operatorId)).toJSON());
    }),
  );

  return router;
}

module.exports = { authRoutes };
