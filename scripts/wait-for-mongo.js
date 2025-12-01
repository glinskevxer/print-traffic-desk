'use strict';

const { MongoClient } = require('mongodb');

/**
 * Compose starts the desk and mongo together and the desk loses the race about
 * one time in three. Rather than a sleep, ask mongo whether it is up, and give
 * up loudly after a bounded wait.
 */

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/printdesk';
const DEADLINE_MS = Number(process.env.WAIT_FOR_MONGO_MS || 60000);
const GAP_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reachable() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 2000 });
  try {
    await client.connect();
    await client.db().admin().command({ ping: 1 });
    return true;
  } catch (err) {
    return false;
  } finally {
    await client.close().catch(() => {});
  }
}

async function main() {
  const giveUpAt = Date.now() + DEADLINE_MS;
  let attempt = 0;

  while (Date.now() < giveUpAt) {
    attempt += 1;
    // eslint-disable-next-line no-await-in-loop
    if (await reachable()) {
      process.stdout.write(`mongo answered on attempt ${attempt}\n`);
      return 0;
    }
    process.stdout.write(`mongo not up yet, attempt ${attempt}\n`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(GAP_MS);
  }

  process.stderr.write(`mongo did not come up within ${DEADLINE_MS}ms\n`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
