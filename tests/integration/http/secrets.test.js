'use strict';

const request = require('supertest');
const { buildTestApp } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { authenticate } = require('../../../src/http/middleware/auth');
const { findSecretShapes, scrubSecrets } = require('../../../src/lib/logger');
const { resetConfigForTests } = require('../../../src/config/env');
const authService = require('../../../src/services/authService');

const SECRET = 'a-secret-that-is-long-enough-for-the-desk';

/**
 * Nothing that proves who somebody is may reach a log line or a response body.
 * This walks the paths that carry one and fails on the shape of a secret
 * rather than on a list of field names somebody remembered to add.
 */
describe('what must never leave the process', () => {
  let app;
  let lines;

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
    resetConfigForTests();
    ({ app, lines } = buildTestApp({ operator: null, authenticateWith: authenticate() }));

    await authService.createOperator({
      email: 'desk@archive.test',
      name: 'The Desk',
      role: 'admin',
      password: 'a-long-enough-password',
    });
  });

  function logged() {
    return JSON.stringify(lines);
  }

  it('knows the shape of every secret the desk handles', () => {
    expect(findSecretShapes('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcF8xMjMifQ.c2lnbmF0dXJl')).toContain(
      'operator token',
    );
    expect(findSecretShapes('pdk_deadbeef_aaaaaaaaaaaaaaaaaaaaaaaa')).toContain('machine key');
    expect(findSecretShapes('sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa')).toContain('openai key');
    expect(findSecretShapes(`scrypt$16384$${'a'.repeat(32)}$${'b'.repeat(128)}`)).toContain(
      'stored password',
    );
    expect(findSecretShapes('an ordinary sentence')).toEqual([]);
  });

  it('scrubs a secret out of a message that carried one', () => {
    expect(scrubSecrets('connect failed for sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(
      'connect failed for [redacted openai key]',
    );
  });

  it('never logs the password somebody signed in with', async () => {
    await request(app)
      .post('/auth/sign-in')
      .send({ email: 'desk@archive.test', password: 'a-long-enough-password' })
      .expect(200);

    expect(logged()).not.toContain('a-long-enough-password');
  });

  it('never logs the password somebody got wrong either', async () => {
    await request(app)
      .post('/auth/sign-in')
      .send({ email: 'desk@archive.test', password: 'the-wrong-password-here' })
      .expect(401);

    expect(logged()).not.toContain('the-wrong-password-here');
  });

  it('never logs the token it just issued', async () => {
    const res = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'desk@archive.test', password: 'a-long-enough-password' })
      .expect(200);

    await request(app).get('/auth/me').set('authorization', `Bearer ${res.body.token}`).expect(200);

    expect(logged()).not.toContain(res.body.token);
    expect(findSecretShapes(logged())).toEqual([]);
  });

  it('never logs a machine key that was presented', async () => {
    const signIn = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'desk@archive.test', password: 'a-long-enough-password' })
      .expect(200);
    const key = await request(app)
      .post('/auth/api-keys')
      .set('authorization', `Bearer ${signIn.body.token}`)
      .send({ name: 'A booking screen', role: 'viewer' })
      .expect(201);

    await request(app).get('/titles').set('x-api-key', key.body.secret).expect(200);

    expect(logged()).not.toContain(key.body.secret);
  });

  it('never puts a stored password in a response', async () => {
    const signIn = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'desk@archive.test', password: 'a-long-enough-password' })
      .expect(200);

    const res = await request(app)
      .get('/auth/operators')
      .set('authorization', `Bearer ${signIn.body.token}`)
      .expect(200);

    expect(findSecretShapes(JSON.stringify(res.body))).toEqual([]);
  });

  it('answers a refused sign in without saying which half was wrong', async () => {
    const wrongPassword = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'desk@archive.test', password: 'not-it' })
      .expect(401);
    const noSuchOperator = await request(app)
      .post('/auth/sign-in')
      .send({ email: 'nobody@archive.test', password: 'not-it' })
      .expect(401);

    expect(wrongPassword.body).toEqual(noSuchOperator.body);
  });

  it('blanks the credentials that ride on a request', async () => {
    await request(app)
      .get('/auth/me')
      .set('authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JnZWQifQ.Zm9yZ2Vk')
      .expect(401);

    expect(logged()).not.toContain('Zm9yZ2Vk');
  });

  it('leaves nothing of a secret in an unhandled failure', () => {
    const err = new Error('upstream refused the key sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa');

    const { serialiseError } = require('../../../src/lib/logger');
    expect(serialiseError(err).message).toBe('upstream refused the key [redacted openai key]');
  });
});
