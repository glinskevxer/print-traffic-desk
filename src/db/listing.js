'use strict';

const { paginate } = require('../lib/pagination');
const { ConflictError } = require('../lib/errors');

/**
 * Two things every service was writing out by hand.
 *
 * The first is the shape of a list call: a filter the service builds, and then
 * the same four paging arguments read off the query in the same order. Nine
 * copies of it had drifted into three different default sorts for the same
 * kind of collection.
 *
 * The second is the duplicate key dance. Mongo raises E11000 and a client
 * needs a sentence naming the field it collided on, and only the service knows
 * what that field means.
 */

/** One page of a collection, with the paging arguments read the same way. */
function listWith(
  model,
  { filter = {}, query = {}, sortField, populate = null, projection = null },
) {
  return paginate(model, {
    filter,
    sortField: query.sortBy || sortField,
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
    populate,
    projection,
  });
}

const DUPLICATE_KEY = 11000;

function isDuplicateKey(err) {
  return Boolean(err) && err.code === DUPLICATE_KEY;
}

/**
 * Runs a write and turns a duplicate key into a conflict a client can read.
 * Anything else is left alone: a service that swallowed every write failure as
 * a conflict is how a validation error once came back as 409.
 */
async function guardDuplicates(write, { message, details = {} }) {
  try {
    return await write();
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    throw new ConflictError(message, { ...details, index: indexNameOf(err) });
  }
}

/** Which unique index actually fired, for the detail bag. */
function indexNameOf(err) {
  if (err && err.keyPattern) return Object.keys(err.keyPattern).join('+');
  const match = /index: (\S+)/.exec(String(err && err.message));
  return match ? match[1] : null;
}

module.exports = { listWith, guardDuplicates, isDuplicateKey, indexNameOf, DUPLICATE_KEY };
