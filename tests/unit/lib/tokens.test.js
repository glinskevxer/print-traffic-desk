'use strict';

const jwt = require('jsonwebtoken');
const {
  signToken,
  verifyToken,
  bearerFrom,
  assertSecret,
  ISSUER,
  AUDIENCE,
} = require('../../../src/lib/tokens');
const { NotAuthenticatedError, ConfigError } = require('../../../src/lib/errors');

const SECRET = 'a-secret-that-is-long-enough-for-the-desk';

const operator = {
  publicId: 'op_0123456789ABCDEF',
  email: 'traffic@archive.test',
  role: 'traffic',
  venue: null,
};

describe('operator tokens', () => {
  it('will not sign with a secret anybody could guess', () => {
    expect(() => signToken({ operator, secret: 'short' })).toThrow(ConfigError);
    expect(() => assertSecret(undefined)).toThrow(/at least 32 characters/);
  });

  it('signs the operator, their role and their house', () => {
    const { token } = signToken({ operator, secret: SECRET });

    const claims = verifyToken(token, SECRET);
    expect(claims.sub).toBe(operator.publicId);
    expect(claims.role).toBe('traffic');
    expect(claims.venue).toBeNull();
    expect(claims.iss).toBe(ISSUER);
    expect(claims.aud).toBe(AUDIENCE);
  });

  it('says when the session runs out', () => {
    const now = Date.parse('2025-06-20T09:00:00Z');
    const { expiresAt } = signToken({ operator, secret: SECRET, ttlMinutes: 60, now });

    expect(expiresAt.toISOString()).toBe('2025-06-20T10:00:00.000Z');
  });

  it('refuses a token signed with another secret', () => {
    const { token } = signToken({ operator, secret: SECRET });

    expect(() => verifyToken(token, `${SECRET}-different`)).toThrow(NotAuthenticatedError);
  });

  it('refuses a token that has expired, and says so', () => {
    const { token } = signToken({
      operator,
      secret: SECRET,
      ttlMinutes: 5,
      now: Date.now() - 3600000,
    });

    expect(() => verifyToken(token, SECRET)).toThrow(/expired/);
  });

  it('refuses a token that says it needs no signature', () => {
    const forged = jwt.sign({ sub: 'op_x', role: 'admin' }, null, { algorithm: 'none' });

    expect(() => verifyToken(forged, SECRET)).toThrow(NotAuthenticatedError);
  });

  it('refuses a token meant for somewhere else', () => {
    const foreign = jwt.sign({ sub: 'op_x', iss: 'someone-else', aud: AUDIENCE }, SECRET);

    expect(() => verifyToken(foreign, SECRET)).toThrow(NotAuthenticatedError);
  });

  it('refuses rubbish', () => {
    expect(() => verifyToken('not.a.token', SECRET)).toThrow(NotAuthenticatedError);
    expect(() => verifyToken('', SECRET)).toThrow(NotAuthenticatedError);
  });

  it('carries the house a venue operator is bound to', () => {
    const { token } = signToken({
      operator: { ...operator, venue: '6a91d5ef1126b9d6d77c84de' },
      secret: SECRET,
    });

    expect(verifyToken(token, SECRET).venue).toBe('6a91d5ef1126b9d6d77c84de');
  });

  it('reads a bearer header and nothing else', () => {
    expect(bearerFrom('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerFrom('  Bearer abc.def.ghi  ')).toBe('abc.def.ghi');
    expect(bearerFrom('Basic abc')).toBeNull();
    expect(bearerFrom('abc.def.ghi')).toBeNull();
    expect(bearerFrom(undefined)).toBeNull();
  });
});
