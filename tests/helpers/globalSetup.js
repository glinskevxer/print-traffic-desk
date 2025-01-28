'use strict';

const { MongoMemoryReplSet } = require('mongodb-memory-server');

/**
 * One replica set for the whole integration run. A replica set rather than a
 * single server because the booking path runs in a transaction, and a
 * standalone mongod refuses to start one.
 */
module.exports = async function globalSetup() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  globalThis.__MONGO_REPLSET__ = replSet;
  process.env.MONGO_URI = replSet.getUri('printdesk-test');
};
