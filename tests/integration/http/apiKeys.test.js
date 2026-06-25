'use strict';

const request = require('supertest');
const { buildTestApp, stubOperator } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { makeVenue, makeTitle, makeRightsHolder } = require('../../helpers/factories');
const { authenticate } = require('../../../src/http/middleware/auth');
const { readPresented } = require('../../../src/models/apiKey');
const authService = require('../../../src/services/authService');

describe('keys for machines', () => {
  let app;
  let real;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
    // A second app that runs the real middleware, to prove a key gets in.
    real = buildTestApp({ operator: null, authenticateWith: authenticate() }).app;
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    const holder = await makeRightsHolder({ name: 'Park Circus' });
    await makeTitle({ rightsHolder: holder._id, slug: 'daisies' });
  });

  async function mint(body = {}) {
    const res = await request(app)
      .post('/auth/api-keys')
      .send({ name: 'Prince booking screen', role: 'viewer', ...body })
      .expect(201);
    return res.body;
  }

  it('shows the secret once, in the shape a caller can present', async () => {
    const key = await mint();

    expect(key.secret).toMatch(/^pdk_[0-9a-f]{8}_[A-Za-z0-9_-]{20,}$/);
    expect(readPresented(key.secret).prefix).toBe(key.prefix);
    expect(key.secretHash).toBeUndefined();
  });

  it('never stores the secret it showed', async () => {
    const key = await mint();
    const { ApiKey } = models();

    const stored = await ApiKey.findOne({ prefix: key.prefix }).select('+secretHash');
    expect(stored.secretHash).toHaveLength(64);
    expect(key.secret).not.toContain(stored.secretHash);
  });

  it('lets a machine in with its key', async () => {
    const key = await mint();

    const res = await request(real).get('/titles').set('x-api-key', key.secret).expect(200);

    expect(res.body.items).toHaveLength(1);
  });

  it('holds a key to the role it was minted with', async () => {
    const key = await mint({ role: 'viewer' });

    const res = await request(real)
      .post('/titles')
      .set('x-api-key', key.secret)
      .send({ title: 'Daisies', year: 1966 })
      .expect(403);

    expect(res.body.error.details.role).toBe('viewer');
  });

  it('turns away a key that is not one', async () => {
    await request(real)
      .get('/titles')
      .set('x-api-key', 'pdk_deadbeef_notarealsecretatall')
      .expect(401);
    await request(real).get('/titles').set('x-api-key', 'nonsense').expect(401);
  });

  it('turns away a revoked key', async () => {
    const key = await mint();
    await request(app)
      .delete(`/auth/api-keys/${key.id}`)
      .send({ reason: 'the screen was decommissioned' })
      .expect(200);

    const res = await request(real).get('/titles').set('x-api-key', key.secret).expect(403);
    expect(res.body.error.message).toMatch(/revoked or has run out/);
  });

  it('turns away a key that has run out', async () => {
    const key = await mint({ expiresOn: '2020-01-01' });

    await request(real).get('/titles').set('x-api-key', key.secret).expect(403);
  });

  it('binds a key to one house when it is minted for one', async () => {
    const venue = await makeVenue({ code: 'GB-LON-PRINCE' });
    const key = await mint({ venueId: venue.publicId, role: 'programmer' });

    const { ApiKey } = models();
    const stored = await ApiKey.byPublicId(key.id);
    expect(String(stored.venue)).toBe(String(venue._id));
    expect(stored.asOperator().isHouseBound()).toBe(true);
  });

  it('counts what a key has been used for', async () => {
    const key = await mint();
    await request(real).get('/titles').set('x-api-key', key.secret).expect(200);
    await request(real).get('/titles').set('x-api-key', key.secret).expect(200);

    // The count is written without being waited for, so give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stored = await models().ApiKey.byPublicId(key.id);
    expect(stored.usedCount).toBeGreaterThanOrEqual(1);
    expect(stored.lastUsedAt).toBeInstanceOf(Date);
  });

  it('will not revoke the same key twice, or without a reason', async () => {
    const key = await mint();

    await request(app).delete(`/auth/api-keys/${key.id}`).send({}).expect(400);
    await request(app).delete(`/auth/api-keys/${key.id}`).send({ reason: 'done' }).expect(200);
    await request(app).delete(`/auth/api-keys/${key.id}`).send({ reason: 'again' }).expect(409);
  });

  it('lists the live keys and the dead ones separately', async () => {
    const first = await mint({ name: 'One' });
    await mint({ name: 'Two' });
    await request(app).delete(`/auth/api-keys/${first.id}`).send({ reason: 'done' }).expect(200);

    const live = await request(app).get('/auth/api-keys?live=true').expect(200);
    expect(live.body.items.map((each) => each.name)).toEqual(['Two']);

    const dead = await request(app).get('/auth/api-keys?live=false').expect(200);
    expect(dead.body.items.map((each) => each.name)).toEqual(['One']);
  });

  it('never puts a hash in a listing', async () => {
    await mint();

    const res = await request(app).get('/auth/api-keys').expect(200);

    expect(JSON.stringify(res.body)).not.toContain('secretHash');
  });

  it('only an admin mints or revokes a key', async () => {
    const { app: programmer } = buildTestApp({ operator: stubOperator({ role: 'programmer' }) });

    await request(programmer)
      .post('/auth/api-keys')
      .send({ name: 'sneaky', role: 'admin' })
      .expect(403);
  });

  it('records the minting and the revoking', async () => {
    const key = await mint();
    await request(app).delete(`/auth/api-keys/${key.id}`).send({ reason: 'done' }).expect(200);

    const trail = await request(app).get(`/audit-events/operator/${key.id}`).expect(200);
    expect(trail.body.items.map((each) => each.action).sort()).toEqual([
      'api-key.created',
      'api-key.revoked',
    ]);
  });

  it('resolves a key straight from the service too', async () => {
    const key = await mint();

    const resolved = await authService.resolveApiKey(key.secret);

    expect(resolved.publicId).toBe(key.id);
  });
});
