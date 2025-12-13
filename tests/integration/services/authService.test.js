'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { makeVenue } = require('../../helpers/factories');
const { resetConfigForTests } = require('../../../src/config/env');
const service = require('../../../src/services/authService');
const { NotAuthenticatedError, ForbiddenError } = require('../../../src/lib/errors');

const SECRET = 'a-secret-that-is-long-enough-for-the-desk';

describe('signing an operator in', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
    resetConfigForTests();
  });

  beforeEach(async () => {
    await clearCollections();
    process.env.AUTH_JWT_SECRET = SECRET;
    process.env.AUTH_MAX_FAILED_ATTEMPTS = '3';
    process.env.AUTH_LOCKOUT_MINUTES = '15';
    resetConfigForTests();
  });

  const account = (overrides = {}) => ({
    email: 'traffic@archive.test',
    name: 'A. Novak',
    role: 'traffic',
    password: 'a-long-enough-password',
    ...overrides,
  });

  it('creates an operator without ever storing the password', async () => {
    const operator = await service.createOperator(account());

    expect(operator.publicId).toMatch(/^op_/);
    expect(operator.toJSON().passwordHash).toBeUndefined();

    const { Operator } = models();
    const stored = await Operator.findOne({ email: 'traffic@archive.test' }).select(
      '+passwordHash',
    );
    expect(stored.passwordHash).not.toContain('a-long-enough-password');
  });

  it('refuses a password anybody could type', async () => {
    await expect(service.createOperator(account({ password: 'short' }))).rejects.toThrow(
      /at least 12 characters/,
    );
    await expect(service.createOperator(account({ password: '123456789012' }))).rejects.toThrow(
      /only digits/,
    );
  });

  it('refuses the same email twice', async () => {
    await service.createOperator(account());

    await expect(service.createOperator(account({ name: 'Somebody else' }))).rejects.toThrow(
      /already works this desk/,
    );
  });

  it('binds an operator to a house when one is given', async () => {
    const venue = await makeVenue({ code: 'GB-LON-PRINCE' });

    const operator = await service.createOperator(account({ venueId: venue.publicId }));

    expect(String(operator.venue)).toBe(String(venue._id));
    expect(operator.isHouseBound()).toBe(true);
  });

  it('hands back a token that resolves to the operator', async () => {
    await service.createOperator(account());

    const { token, operator, expiresAt } = await service.signIn({
      email: 'traffic@archive.test',
      password: 'a-long-enough-password',
    });

    expect(operator.role).toBe('traffic');
    expect(expiresAt).toBeInstanceOf(Date);

    const resolved = await service.resolveToken(token);
    expect(resolved.operator.email).toBe('traffic@archive.test');
  });

  it('answers the same way for a wrong password and an unknown address', async () => {
    await service.createOperator(account());

    await expect(
      service.signIn({ email: 'traffic@archive.test', password: 'wrong-password-here' }),
    ).rejects.toThrow(/do not match an operator/);
    await expect(
      service.signIn({ email: 'nobody@archive.test', password: 'wrong-password-here' }),
    ).rejects.toThrow(/do not match an operator/);
  });

  it('locks the account after too many tries', async () => {
    await service.createOperator(account());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        service.signIn({ email: 'traffic@archive.test', password: 'wrong-password-here' }),
      ).rejects.toThrow(NotAuthenticatedError);
    }

    await expect(
      service.signIn({ email: 'traffic@archive.test', password: 'a-long-enough-password' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('lets the operator back in once the lockout runs out', async () => {
    await service.createOperator(account());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await service
        .signIn({ email: 'traffic@archive.test', password: 'wrong-password-here' })
        .catch(() => {});
    }

    const later = new Date(Date.now() + 16 * 60000);
    const { token } = await service.signIn(
      { email: 'traffic@archive.test', password: 'a-long-enough-password' },
      { now: later },
    );

    expect(typeof token).toBe('string');
  });

  it('clears the failure count on a good sign in', async () => {
    await service.createOperator(account());
    await service
      .signIn({ email: 'traffic@archive.test', password: 'wrong-password-here' })
      .catch(() => {});

    await service.signIn({ email: 'traffic@archive.test', password: 'a-long-enough-password' });

    const { Operator } = models();
    expect((await Operator.findOne({})).failedAttempts).toBe(0);
  });

  it('turns a deactivated operator away even with a live token', async () => {
    const operator = await service.createOperator(account());
    const { token } = await service.signIn({
      email: 'traffic@archive.test',
      password: 'a-long-enough-password',
    });
    await service.deactivate(operator.publicId);

    await expect(service.resolveToken(token)).rejects.toThrow(/no longer works this desk/);
  });

  it('will not sign a deactivated operator in at all', async () => {
    const operator = await service.createOperator(account());
    await service.deactivate(operator.publicId);

    await expect(
      service.signIn({ email: 'traffic@archive.test', password: 'a-long-enough-password' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('changes a password only with the current one', async () => {
    const operator = await service.createOperator(account());

    await expect(
      service.changePassword(operator.publicId, {
        currentPassword: 'not-the-password',
        newPassword: 'another-long-password',
      }),
    ).rejects.toThrow(/current password does not match/);

    await service.changePassword(operator.publicId, {
      currentPassword: 'a-long-enough-password',
      newPassword: 'another-long-password',
    });

    await expect(
      service.signIn({ email: 'traffic@archive.test', password: 'another-long-password' }),
    ).resolves.toHaveProperty('token');
  });

  it('will not accept the old password as the new one', async () => {
    const operator = await service.createOperator(account());

    await expect(
      service.changePassword(operator.publicId, {
        currentPassword: 'a-long-enough-password',
        newPassword: 'a-long-enough-password',
      }),
    ).rejects.toThrow(/the old one/);
  });

  it('records a role change in the audit trail', async () => {
    const operator = await service.createOperator(account());

    await service.setRole(operator.publicId, 'admin');

    const { AuditEvent } = models();
    const event = await AuditEvent.findOne({ action: 'operator.role-changed' });
    expect(event.changes[0]).toMatchObject({ before: 'traffic', after: 'admin' });
  });

  it('lists the operators by role', async () => {
    await service.createOperator(account());
    await service.createOperator(account({ email: 'programmer@archive.test', role: 'programmer' }));

    const page = await service.listOperators({ role: 'programmer' });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].toJSON().passwordHash).toBeUndefined();
  });
});
