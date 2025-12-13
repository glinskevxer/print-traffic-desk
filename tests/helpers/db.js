'use strict';

const { connect, disconnect, getConnection } = require('../../src/db/connection');
const { registerModels, syncIndexes } = require('../../src/models');

/**
 * Jest runs suites in parallel workers against the one replica set the global
 * setup started. They each get their own database, otherwise one suite's
 * clean up empties a collection another suite is halfway through reading.
 */
function testDatabaseUri() {
  const worker = process.env.JEST_WORKER_ID || '1';
  const uri = new URL(process.env.MONGO_URI);
  uri.pathname = `/printdesk-test-${worker}`;
  return uri.toString();
}

async function openTestConnection() {
  return connect({ uri: testDatabaseUri(), maxPoolSize: 5, serverSelectionTimeoutMs: 10000 });
}

/**
 * Connects, registers the models and builds the indexes. Jest hands every test
 * file a fresh module registry but reuses the worker process, so the fact that
 * this worker's database already has its indexes is kept on globalThis. Twenty
 * suites each rebuilding forty indexes cost more than the tests did.
 */
async function useDatabase() {
  const connection = await openTestConnection();
  const models = registerModels(connection);

  const key = `printdesk-indexes-${process.env.JEST_WORKER_ID || '1'}`;
  if (!globalThis[key]) {
    await syncIndexes();
    globalThis[key] = true;
  }
  return models;
}

async function closeTestConnection() {
  await disconnect();
}

/**
 * Empties every collection that has anything in it, without dropping the
 * indexes. Counting first and only deleting where there is something to delete
 * turns fifteen round trips per test into two or three.
 */
async function clearCollections() {
  const conn = getConnection();
  const collections = await conn.db.collections();

  await Promise.all(
    collections.map(async (collection) => {
      const anything = await collection.findOne({}, { projection: { _id: 1 } });
      if (anything) await collection.deleteMany({});
    }),
  );
}

module.exports = {
  testDatabaseUri,
  openTestConnection,
  useDatabase,
  closeTestConnection,
  clearCollections,
};
