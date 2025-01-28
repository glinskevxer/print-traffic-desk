'use strict';

const { connect, disconnect, getConnection } = require('../../src/db/connection');

async function openTestConnection() {
  return connect({ uri: process.env.MONGO_URI, maxPoolSize: 5, serverSelectionTimeoutMs: 5000 });
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

module.exports = { openTestConnection, closeTestConnection, clearCollections };
