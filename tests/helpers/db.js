'use strict';

const { connect, disconnect, getConnection } = require('../../src/db/connection');

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
  return connect({ uri: testDatabaseUri(), maxPoolSize: 5, serverSelectionTimeoutMs: 5000 });
}

async function closeTestConnection() {
  await disconnect();
}

/** Empties every collection between tests without dropping the indexes. */
async function clearCollections() {
  const conn = getConnection();
  const collections = await conn.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

module.exports = { testDatabaseUri, openTestConnection, closeTestConnection, clearCollections };
