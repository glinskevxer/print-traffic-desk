'use strict';

const { ValidationError } = require('./errors');

/**
 * Keyset paging, not skip and limit. The catalogue is walked while prints are
 * being booked, and an offset page silently repeats or drops a row every time
 * something is inserted behind the cursor.
 */

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function encodeCursor({ sortValue, id }) {
  const payload = JSON.stringify({ v: sortValue instanceof Date ? sortValue.toISOString() : sortValue, i: String(id) });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeCursor(text) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(text), 'base64url').toString('utf8'));
  } catch (err) {
    throw new ValidationError('that cursor is not one this desk issued', [
      { key: 'cursor', problem: 'not decodable' },
    ]);
  }
  if (!parsed || typeof parsed !== 'object' || parsed.i === undefined || parsed.v === undefined) {
    throw new ValidationError('that cursor is missing its position', [
      { key: 'cursor', problem: 'incomplete' },
    ]);
  }
  return { sortValue: parsed.v, id: parsed.i };
}

/**
 * Sorting on a field that repeats needs the id as a tie break, or two rows with
 * the same value straddle a page boundary and one of them is never returned.
 */
function cursorFilter({ cursor, sortField, order, castId }) {
  if (!cursor) return {};
  const { sortValue, id } = decodeCursor(cursor);
  const comparator = order === 'desc' ? '$lt' : '$gt';
  const value = castId ? sortValue : sortValue;
  return {
    $or: [
      { [sortField]: { [comparator]: value } },
      { [sortField]: value, _id: { [comparator]: castId ? castId(id) : id } },
    ],
  };
}

function normaliseLimit(limit) {
  if (limit === undefined) return DEFAULT_LIMIT;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new ValidationError(`limit must be a whole number between 1 and ${MAX_LIMIT}`, [
      { key: 'limit', problem: 'out of range' },
    ]);
  }
  return parsed;
}

/**
 * Runs one page of a query. Reads one row past the page to decide whether
 * there is a next cursor without a second count query.
 */
async function paginate(model, options = {}) {
  const {
    filter = {},
    sortField = 'createdAt',
    order = 'asc',
    limit,
    cursor,
    projection = null,
    populate = null,
    castId = null,
    session = null,
  } = options;

  const pageSize = normaliseLimit(limit);
  const direction = order === 'desc' ? -1 : 1;
  const keyed = cursorFilter({ cursor, sortField, order, castId });
  const query = model
    .find(Object.keys(keyed).length ? { $and: [filter, keyed] } : filter, projection, { session })
    .sort({ [sortField]: direction, _id: direction })
    .limit(pageSize + 1);

  if (populate) query.populate(populate);

  const rows = await query.exec();
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const last = items[items.length - 1];

  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last ? encodeCursor({ sortValue: last.get(sortField), id: last._id }) : null,
  };
}

/** The envelope every list endpoint returns, so clients only learn one shape. */
function pageEnvelope(page, mapItem = (item) => item.toJSON()) {
  return {
    items: page.items.map(mapItem),
    page: { hasMore: page.hasMore, nextCursor: page.nextCursor },
  };
}

module.exports = {
  MAX_LIMIT,
  DEFAULT_LIMIT,
  encodeCursor,
  decodeCursor,
  cursorFilter,
  normaliseLimit,
  paginate,
  pageEnvelope,
};
