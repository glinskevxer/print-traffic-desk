'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { paginate } = require('../lib/pagination');
const {
  NotAuthenticatedError,
  ForbiddenError,
  ConflictError,
  RuleRefusedError,
} = require('../lib/errors');
const { config } = require('../config/env');
const { signToken, verifyToken } = require('../lib/tokens');
const audit = require('../lib/audit');

/**
 * Sign in, lock out and who is who. The failure counter lives on the operator
 * rather than in memory, because the desk runs behind two processes and a
 * counter in one of them halves the lockout.
 */

const MIN_PASSWORD_LENGTH = 12;

function assertPasswordStrong(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new RuleRefusedError(
      `a desk password has to be at least ${MIN_PASSWORD_LENGTH} characters`,
      { minimum: MIN_PASSWORD_LENGTH },
    );
  }
  if (/^\d+$/.test(password)) {
    throw new RuleRefusedError('a desk password cannot be only digits', {});
  }
  return password;
}

/**
 * Every attempt at the door, whether it opened or not. This is the one audit
 * line written for somebody who is not signed in, so the actor is the address
 * that was tried rather than an operator.
 */
async function recordAttempt({ email, from, outcome, operator = null }) {
  return audit.record({
    action: `operator.sign-in.${outcome}`,
    subjectType: 'operator',
    subjectId: operator ? operator.publicId : 'unknown',
    metadata: { email, from: from || null, outcome },
  });
}

async function createOperator({ email, name, role, password, venueId }) {
  const { Operator, Venue } = models();
  assertPasswordStrong(password);

  const venue = venueId ? await required(Venue, venueId) : null;
  const operator = new Operator({ email, name, role, venue: venue ? venue._id : null });
  operator.setPassword(password);

  try {
    await operator.save();
  } catch (err) {
    if (err.code === 11000) throw new ConflictError(`${email} already works this desk`, { email });
    throw err;
  }

  await audit.record({
    action: 'operator.created',
    subjectType: 'operator',
    subjectId: operator.publicId,
    metadata: { email: operator.email, role: operator.role },
  });

  return operator;
}

/**
 * A wrong password and an unknown address answer the same way and take about
 * the same time, so the form cannot be used to find out who has an account.
 */
async function signIn({ email, password, from = null }, { now = new Date() } = {}) {
  const { Operator } = models();
  const cfg = config();
  const attempted = String(email).toLowerCase();

  const operator = await Operator.findOne({ email: attempted }).select('+passwordHash');
  if (!operator) {
    // An address nobody has is still recorded. A run of these against
    // different addresses is somebody working through a list, and that is
    // exactly the pattern a trail should show.
    await recordAttempt({ email: attempted, from, outcome: 'no-such-operator' });
    throw new NotAuthenticatedError('that email and password do not match an operator');
  }
  if (!operator.active) {
    await recordAttempt({ email: attempted, from, outcome: 'deactivated', operator });
    throw new ForbiddenError('that operator no longer works this desk');
  }
  if (operator.isLocked(now)) {
    await recordAttempt({ email: attempted, from, outcome: 'locked-out', operator });
    throw new ForbiddenError('too many failed attempts, try again later', {
      lockedUntil: operator.lockedUntil,
    });
  }

  if (!operator.passwordMatches(password)) {
    operator.failedAttempts += 1;
    const lockedNow = operator.failedAttempts >= cfg.auth.maxFailedAttempts;
    if (lockedNow) {
      operator.lockedUntil = new Date(now.getTime() + cfg.auth.lockoutMinutes * 60000);
      operator.failedAttempts = 0;
    }
    await operator.save();
    await recordAttempt({
      email: attempted,
      from,
      outcome: lockedNow ? 'wrong-password-locked' : 'wrong-password',
      operator,
    });
    throw new NotAuthenticatedError('that email and password do not match an operator');
  }

  operator.failedAttempts = 0;
  operator.lockedUntil = null;
  operator.lastSeenAt = now;
  await operator.save();
  await recordAttempt({ email: attempted, from, outcome: 'signed-in', operator });

  const { token, expiresAt } = signToken({
    operator,
    secret: cfg.auth.secret,
    ttlMinutes: cfg.auth.tokenTtlMinutes,
    now: now.getTime(),
  });

  return {
    token,
    expiresAt,
    operator: {
      id: operator.publicId,
      email: operator.email,
      name: operator.name,
      role: operator.role,
      venue: operator.venue,
    },
  };
}

/** Claims plus the live record, so a deactivated operator is turned away. */
async function resolveToken(token) {
  const { Operator } = models();
  const cfg = config();
  const claims = verifyToken(token, cfg.auth.secret);

  const operator = await Operator.findOne({ publicId: claims.sub });
  if (!operator || !operator.active) {
    throw new NotAuthenticatedError('that operator no longer works this desk');
  }
  return { claims, operator };
}

async function changePassword(publicId, { currentPassword, newPassword }) {
  const { Operator } = models();
  const operator = await Operator.findOne({ publicId }).select('+passwordHash');
  if (!operator) throw new NotAuthenticatedError('no such operator');

  if (!operator.passwordMatches(currentPassword)) {
    throw new NotAuthenticatedError('the current password does not match');
  }
  assertPasswordStrong(newPassword);
  if (newPassword === currentPassword) {
    throw new RuleRefusedError('the new password is the old one', {});
  }

  operator.setPassword(newPassword);
  operator.failedAttempts = 0;
  operator.lockedUntil = null;
  await operator.save();
  return operator;
}

async function setRole(publicId, role) {
  const { Operator } = models();
  const operator = await required(Operator, publicId);
  const before = operator.role;

  operator.role = role;
  await operator.save();

  await audit.record({
    action: 'operator.role-changed',
    subjectType: 'operator',
    subjectId: operator.publicId,
    changes: [{ field: 'role', before, after: role }],
  });
  return operator;
}

async function deactivate(publicId) {
  const { Operator } = models();
  const operator = await required(Operator, publicId);
  operator.active = false;
  await operator.save();
  return operator;
}

async function listOperators(query = {}) {
  const { Operator } = models();
  const filter = {};
  if (query.role) filter.role = query.role;
  if (query.active !== undefined) filter.active = query.active;

  return paginate(Operator, {
    filter,
    sortField: 'email',
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
  });
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  recordAttempt,
  assertPasswordStrong,
  createOperator,
  signIn,
  resolveToken,
  changePassword,
  setRole,
  deactivate,
  listOperators,
};
