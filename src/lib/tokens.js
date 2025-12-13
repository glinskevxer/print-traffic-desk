'use strict';

const jwt = require('jsonwebtoken');
const { NotAuthenticatedError, ConfigError } = require('./errors');

/**
 * Short lived bearer tokens for desk operators. There is no refresh token: the
 * desk is a back office tool, sessions are hours not months, and a stolen
 * token that expires at the end of the shift is a smaller problem than a
 * refresh chain nobody rotates.
 */

const ISSUER = 'printdesk';
const AUDIENCE = 'printdesk-api';
const MIN_SECRET_LENGTH = 32;

function assertSecret(secret) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`the signing secret must be at least ${MIN_SECRET_LENGTH} characters`, {
      key: 'AUTH_JWT_SECRET',
    });
  }
  return secret;
}

function signToken({ operator, secret, ttlMinutes = 480, now = Date.now() }) {
  assertSecret(secret);

  const issuedAt = Math.floor(now / 1000);
  const claims = {
    sub: operator.publicId,
    email: operator.email,
    role: operator.role,
    venue: operator.venue ? String(operator.venue) : null,
    iat: issuedAt,
    exp: issuedAt + ttlMinutes * 60,
    iss: ISSUER,
    aud: AUDIENCE,
  };

  return {
    token: jwt.sign(claims, secret, { algorithm: 'HS256' }),
    expiresAt: new Date(claims.exp * 1000),
  };
}

/**
 * The algorithm is pinned. Left open, a token signed with alg none is accepted
 * by some libraries, and this one has had that bug before.
 */
function verifyToken(token, secret) {
  assertSecret(secret);
  try {
    return jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new NotAuthenticatedError('that session has expired, sign in again');
    }
    throw new NotAuthenticatedError('that token is not one this desk issued');
  }
}

/** Reads a bearer token out of an Authorization header. */
function bearerFrom(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(headerValue.trim());
  return match ? match[1] : null;
}

module.exports = {
  ISSUER,
  AUDIENCE,
  MIN_SECRET_LENGTH,
  signToken,
  verifyToken,
  bearerFrom,
  assertSecret,
};
