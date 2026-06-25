'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { authenticate } = require('../../../src/http/middleware/auth');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { resetConfigForTests } = require('../../../src/config/env');
const { makeVenue } = require('../../helpers/factories');
const authService = require('../../../src/services/authService');

const SECRET = 'a-secret-that-is-long-enough-for-the-desk';

describe('auth endpoints', () => {
  let app;

  beforeAll(async () => {
    await useDatabase();
    // This file is about the real thing: signing in and presenting a token.
    ({ app } = buildTestApp({ operator: null, authenticateWith: authenticate() }));
  });

  afterAll(async () => {
    await closeTestConnection();
    resetConfigForTests();
  });

  beforeEach(async () => {
    await clearCollections();
    process.env.AUTH_JWT_SECRET = SECRET;
    resetConfigForTests();
  });

  async function anOperator(overrides = {}) {
    return authService.createOperator({
      email: 'traffic@archive.test',
      name: 'A. Novak',
      role: 'traffic',
      password: 'a-long-enough-password',
      ...overrides,
    });
  }

  async function tokenFor(overrides = {}) {
    await anOperator(overrides);
    const res = await request(app)
      .post('/auth/sign-in')
      .send({
        email: overrides.email || 'traffic@archive.test',
        password: 'a-long-enough-password',
      })
      .expect(200);
    return res.body.token;
  }

  it('signs an operator in and says when the session ends', async () => {
    await anOperator();

    const res = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'traffic@archive.test', password: 'a-long-enough-password' })
      .expect(200);

    expect(typeof res.body.token).toBe('string');
    expect(res.body.operator.role).toBe('traffic');
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('answers 401 for a wrong password', async () => {
    await anOperator();

    const res = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'traffic@archive.test', password: 'not-the-password' })
      .expect(401);

    expect(res.body.error.code).toBe('not_authenticated');
  });

  it('refuses a sign in that is not an email', async () => {
    await request(app).post('/auth/sign-in').send({ email: 'nope', password: 'x' }).expect(400);
  });

  it('tells an operator who they are', async () => {
    const token = await tokenFor();

    const res = await request(app)
      .get('/auth/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.email).toBe('traffic@archive.test');
    expect(res.body.id).toMatch(/^op_/);
  });

  it('answers 401 with no token, a mangled one or the wrong scheme', async () => {
    await request(app).get('/auth/me').expect(401);
    await request(app).get('/auth/me').set('authorization', 'Bearer nonsense').expect(401);
    await request(app).get('/auth/me').set('authorization', 'Basic abc').expect(401);
  });

  it('lets an operator change their own password', async () => {
    const token = await tokenFor();

    await request(app)
      .put('/auth/password')
      .set('authorization', `Bearer ${token}`)
      .send({ currentPassword: 'a-long-enough-password', newPassword: 'a-different-password' })
      .expect(200);

    await request(app)
      .post('/auth/sign-in')
      .send({ email: 'traffic@archive.test', password: 'a-different-password' })
      .expect(200);
  });

  it('only an admin creates operators', async () => {
    const trafficToken = await tokenFor();

    const refused = await request(app)
      .post('/auth/operators')
      .set('authorization', `Bearer ${trafficToken}`)
      .send({
        email: 'new@archive.test',
        name: 'New Person',
        role: 'viewer',
        password: 'a-long-enough-password',
      })
      .expect(403);
    expect(refused.body.error.details.allowed).toEqual(['admin']);

    await authService.createOperator({
      email: 'boss@archive.test',
      name: 'The Boss',
      role: 'admin',
      password: 'a-long-enough-password',
    });
    const adminSignIn = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'boss@archive.test', password: 'a-long-enough-password' })
      .expect(200);

    await request(app)
      .post('/auth/operators')
      .set('authorization', `Bearer ${adminSignIn.body.token}`)
      .send({
        email: 'new@archive.test',
        name: 'New Person',
        role: 'viewer',
        password: 'a-long-enough-password',
      })
      .expect(201);
  });

  it('never puts a password hash in a response', async () => {
    await authService.createOperator({
      email: 'boss@archive.test',
      name: 'The Boss',
      role: 'admin',
      password: 'a-long-enough-password',
    });
    const signIn = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'boss@archive.test', password: 'a-long-enough-password' })
      .expect(200);

    const res = await request(app)
      .get('/auth/operators')
      .set('authorization', `Bearer ${signIn.body.token}`)
      .expect(200);

    expect(JSON.stringify(res.body)).not.toContain('scrypt');
  });

  it('binds an operator to their house', async () => {
    const venue = await makeVenue({ code: 'GB-LON-PRINCE' });
    const token = await tokenFor({ venueId: venue.publicId });

    const res = await request(app)
      .get('/auth/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(String(res.body.venue)).toBe(String(venue._id));
  });
});
