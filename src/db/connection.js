'use strict';

const mongoose = require('mongoose');
const { DeskError, CODES } = require('../lib/errors');

/**
 * One connection for the process. The desk is a single service talking to one
 * replica set, so a module level handle beats threading a client through every
 * repository call.
 */

let connection = null;
let connecting = null;

const DEFAULTS = {
  maxPoolSize: 10,
  serverSelectionTimeoutMs: 8000,
  socketTimeoutMS: 45000,
  retryWrites: true,
};

function attachEventLogging(conn, log) {
  if (!log) return;
  conn.on('connected', () => log.info({ db: conn.name }, 'mongo connected'));
  conn.on('disconnected', () => log.warn({ db: conn.name }, 'mongo disconnected'));
  conn.on('reconnected', () => log.info({ db: conn.name }, 'mongo reconnected'));
  conn.on('error', (err) => log.error({ err }, 'mongo connection error'));
}

async function connect({ uri, maxPoolSize, serverSelectionTimeoutMs } = {}, log = null) {
  if (connection && connection.readyState === 1) return connection;
  if (connecting) return connecting;

  if (!uri) {
    throw new DeskError('cannot connect without a mongo uri', {
      code: CODES.CONFIG_INVALID,
      status: 500,
    });
  }

  mongoose.set('strictQuery', true);
  // sanitizeFilter is deliberately off. It rewrites every operator object it
  // did not build itself, which breaks keyset paging, and the desk never puts
  // a client supplied object into a filter: zod has reduced it to a primitive
  // by the time a service sees it.
  mongoose.set('sanitizeFilter', false);

  connecting = mongoose
    .createConnection(uri, {
      maxPoolSize: maxPoolSize || DEFAULTS.maxPoolSize,
      serverSelectionTimeoutMS: serverSelectionTimeoutMs || DEFAULTS.serverSelectionTimeoutMs,
      socketTimeoutMS: DEFAULTS.socketTimeoutMS,
      retryWrites: DEFAULTS.retryWrites,
    })
    .asPromise()
    .then((conn) => {
      attachEventLogging(conn, log);
      connection = conn;
      connecting = null;
      return conn;
    })
    .catch((err) => {
      connecting = null;
      throw new DeskError(`mongo refused the connection: ${err.message}`, {
        code: CODES.INTERNAL,
        status: 503,
        cause: err,
        retryable: true,
      });
    });

  return connecting;
}

function getConnection() {
  if (!connection) {
    throw new DeskError('the database is not connected yet', {
      code: CODES.INTERNAL,
      status: 503,
      retryable: true,
    });
  }
  return connection;
}

function isConnected() {
  return Boolean(connection) && connection.readyState === 1;
}

async function ping() {
  const conn = getConnection();
  const startedAt = process.hrtime.bigint();
  await conn.db.admin().command({ ping: 1 });
  return Number((process.hrtime.bigint() - startedAt) / 1000000n);
}

/**
 * What the replica set is doing. A desk that can reach a primary but whose
 * secondary is an hour behind is a desk where a read on a lagging member
 * answers with last hour's bookings, and readiness should say so rather than
 * answering ok because the ping came back.
 */
async function replicaSetHealth() {
  const conn = getConnection();
  const status = await conn.db.admin().command({ replSetGetStatus: 1 });

  const primary = status.members.find((member) => member.stateStr === 'PRIMARY');
  const secondaries = status.members.filter((member) => member.stateStr === 'SECONDARY');
  const unreachable = status.members.filter(
    (member) => !['PRIMARY', 'SECONDARY', 'ARBITER'].includes(member.stateStr),
  );

  const primaryAt = primary && primary.optimeDate ? primary.optimeDate.getTime() : null;
  const lagSeconds = secondaries.map((member) =>
    primaryAt && member.optimeDate
      ? Math.max(0, Math.round((primaryAt - member.optimeDate.getTime()) / 1000))
      : null,
  );

  return {
    set: status.set,
    members: status.members.length,
    hasPrimary: Boolean(primary),
    secondaries: secondaries.length,
    unreachable: unreachable.map((member) => ({ name: member.name, state: member.stateStr })),
    worstLagSeconds: lagSeconds
      .filter((value) => value !== null)
      .reduce((a, b) => Math.max(a, b), 0),
  };
}

async function disconnect() {
  if (!connection) return;
  const conn = connection;
  connection = null;
  await conn.close();
}

/**
 * Runs a unit of work inside a transaction. Booking a print writes to three
 * collections and a half applied booking would strand an element, so every
 * multi collection write goes through here.
 */
async function withTransaction(work) {
  const conn = getConnection();
  const session = await conn.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  replicaSetHealth,
  connect,
  disconnect,
  getConnection,
  isConnected,
  ping,
  withTransaction,
  DEFAULTS,
};
