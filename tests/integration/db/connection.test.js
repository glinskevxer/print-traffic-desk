'use strict';

const {
  connect,
  disconnect,
  getConnection,
  isConnected,
  ping,
  withTransaction,
} = require('../../../src/db/connection');
const { DeskError } = require('../../../src/lib/errors');
const { testDatabaseUri } = require('../../helpers/db');

describe('mongo connection', () => {
  afterEach(async () => {
    await disconnect();
  });

  it('refuses to hand out a connection before one is open', () => {
    expect(() => getConnection()).toThrow(DeskError);
    expect(isConnected()).toBe(false);
  });

  it('opens once and hands the same handle back', async () => {
    const first = await connect({ uri: testDatabaseUri() });
    const second = await connect({ uri: testDatabaseUri() });

    expect(second).toBe(first);
    expect(isConnected()).toBe(true);
  });

  it('answers a ping with a round trip in milliseconds', async () => {
    await connect({ uri: testDatabaseUri() });

    const elapsed = await ping();

    expect(typeof elapsed).toBe('number');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('reports a refused connection as retryable rather than a crash', async () => {
    let caught;
    try {
      await connect({ uri: 'mongodb://127.0.0.1:1/nothing', serverSelectionTimeoutMs: 300 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DeskError);
    expect(caught.status).toBe(503);
    expect(caught.retryable).toBe(true);
  });

  it('will not connect without a uri', async () => {
    await expect(connect({})).rejects.toThrow(/without a mongo uri/);
  });

  it('commits the whole unit of work or none of it', async () => {
    const conn = await connect({ uri: testDatabaseUri() });
    const ledger = conn.db.collection('transaction-probe');
    await ledger.deleteMany({});

    await withTransaction(async (session) => {
      await ledger.insertOne({ leg: 'out' }, { session });
      await ledger.insertOne({ leg: 'back' }, { session });
    });
    expect(await ledger.countDocuments()).toBe(2);

    await expect(
      withTransaction(async (session) => {
        await ledger.insertOne({ leg: 'stranded' }, { session });
        throw new Error('carrier refused the pickup');
      }),
    ).rejects.toThrow('carrier refused the pickup');

    expect(await ledger.countDocuments()).toBe(2);
  });

  it('closing twice is not an error', async () => {
    await connect({ uri: testDatabaseUri() });
    await disconnect();
    await expect(disconnect()).resolves.toBeUndefined();
  });
});
