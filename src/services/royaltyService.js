'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { withTransaction } = require('../db/connection');
const { RuleRefusedError, ConflictError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');
const audit = require('../lib/audit');
const { totalFor } = require('../domain/royalties/compute');
const { addDays } = require('../lib/dates');

async function loadStatement(publicId, session = null) {
  const { RoyaltyStatement } = models();
  const statement = await required(RoyaltyStatement, publicId, { session });
  return statement;
}

/**
 * Every settled booking in the period whose licence belongs to this holder.
 * The join runs through the rights window rather than the title, because a
 * title can move between distributors and the money follows the licence.
 */
async function settledLinesFor({ holder, periodStartsOn, periodEndsOn, session }) {
  const { Booking, RightsWindow, Title, Venue } = models();

  const windows = await RightsWindow.find({ rightsHolder: holder._id }, '_id', { session });
  if (windows.length === 0) return [];

  const bookings = await Booking.find(
    {
      rightsWindow: { $in: windows.map((each) => each._id) },
      status: 'settled',
      localDate: { $gte: periodStartsOn, $lte: periodEndsOn },
    },
    null,
    { session },
  ).sort({ localDate: 1 });

  if (bookings.length === 0) return [];

  const titles = await Title.find({ _id: { $in: bookings.map((each) => each.title) } }, 'slug', {
    session,
  });
  const venues = await Venue.find({ _id: { $in: bookings.map((each) => each.venue) } }, 'code', {
    session,
  });
  const titleById = new Map(titles.map((each) => [String(each._id), each.slug]));
  const venueById = new Map(venues.map((each) => [String(each._id), each.code]));

  return bookings.map((booking) => ({
    booking: booking._id,
    reference: booking.reference,
    titleSlug: titleById.get(String(booking.title)) || 'unknown',
    venueCode: venueById.get(String(booking.venue)) || 'unknown',
    localDate: booking.localDate,
    admissions: booking.boxOffice ? booking.boxOffice.admissions : 0,
    grossMinor: booking.boxOffice ? booking.boxOffice.grossMinor : 0,
    royaltyMinor: booking.royaltyMinor || 0,
    currency: booking.royaltyCurrency,
    basis: booking.royaltyBasis || 'no basis recorded',
  }));
}

async function buildStatement({ rightsHolderId, periodStartsOn, periodEndsOn }) {
  const { RightsHolder, RoyaltyStatement } = models();

  return withTransaction(async (session) => {
    const holder = await required(RightsHolder, rightsHolderId, { session });

    const existing = await RoyaltyStatement.findOne(
      { rightsHolder: holder._id, periodStartsOn, periodEndsOn, status: { $ne: 'void' } },
      null,
      { session },
    );
    if (existing) {
      throw new ConflictError('a statement for that period already exists', {
        statement: existing.publicId,
        status: existing.status,
      });
    }

    const lines = await settledLinesFor({ holder, periodStartsOn, periodEndsOn, session });
    const totalMinor = totalFor(
      lines.map((line) => ({ amountMinor: line.royaltyMinor, currency: line.currency })),
      holder.remittanceCurrency,
    );

    const [statement] = await RoyaltyStatement.create(
      [
        {
          rightsHolder: holder._id,
          periodStartsOn,
          periodEndsOn,
          currency: holder.remittanceCurrency,
          lines: lines.map(({ currency: _currency, ...line }) => line),
          totalMinor,
          screeningCount: lines.length,
          admissionsTotal: lines.reduce((sum, line) => sum + line.admissions, 0),
          grossTotalMinor: lines.reduce((sum, line) => sum + line.grossMinor, 0),
        },
      ],
      { session },
    );

    await audit.record(
      {
        action: 'statement.built',
        subjectType: 'royalty-statement',
        subjectId: statement.publicId,
        metadata: { holder: holder.name, lines: lines.length, totalMinor },
      },
      { session },
    );

    return statement;
  });
}

/** Issuing freezes the lines and starts the clock on the holder's terms. */
async function issueStatement(publicId, issuedOn) {
  const { RightsHolder } = models();

  return withTransaction(async (session) => {
    const statement = await loadStatement(publicId, session);
    if (statement.status !== 'draft') {
      throw new RuleRefusedError('only a draft statement can be issued', {
        statement: publicId,
        status: statement.status,
      });
    }
    if (statement.lines.length === 0) {
      throw new RuleRefusedError('there is nothing on this statement to issue', {
        statement: publicId,
      });
    }

    const holder = await RightsHolder.findById(statement.rightsHolder, null, { session });
    statement.status = 'issued';
    statement.issuedOn = issuedOn;
    statement.dueOn = addDays(issuedOn, holder.settlementDays);
    await statement.save({ session });

    await audit.record(
      {
        action: 'statement.issued',
        subjectType: 'royalty-statement',
        subjectId: statement.publicId,
        changes: [{ field: 'status', before: 'draft', after: 'issued' }],
        metadata: { dueOn: statement.dueOn, totalMinor: statement.totalMinor },
      },
      { session },
    );

    return statement;
  });
}

async function recordPayment(publicId, { paidOn, paymentReference }) {
  return withTransaction(async (session) => {
    const statement = await loadStatement(publicId, session);
    if (statement.status !== 'issued') {
      throw new RuleRefusedError('only an issued statement can be paid', {
        statement: publicId,
        status: statement.status,
      });
    }

    statement.status = 'paid';
    statement.paidOn = paidOn;
    statement.paymentReference = paymentReference;
    await statement.save({ session });

    await audit.record(
      {
        action: 'statement.paid',
        subjectType: 'royalty-statement',
        subjectId: statement.publicId,
        changes: [{ field: 'status', before: 'issued', after: 'paid' }],
        metadata: { paidOn, paymentReference },
      },
      { session },
    );

    return statement;
  });
}

/** Voiding is the only way back: an issued statement is never edited. */
async function voidStatement(publicId, reason) {
  const statement = await loadStatement(publicId);
  if (statement.status === 'paid') {
    throw new RuleRefusedError('a paid statement cannot be voided, raise a credit', {
      statement: publicId,
    });
  }
  if (!reason) {
    throw new RuleRefusedError('voiding a statement needs a reason', { statement: publicId });
  }

  statement.status = 'void';
  statement.voidReason = reason;
  await statement.save();
  return statement;
}

async function getStatement(publicId) {
  return loadStatement(publicId);
}

async function listStatements(query = {}) {
  const { RoyaltyStatement, RightsHolder } = models();
  const filter = {};

  if (query.rightsHolderId) {
    const holder = await required(RightsHolder, query.rightsHolderId);
    filter.rightsHolder = holder._id;
  }
  if (query.status) filter.status = query.status;
  if (query.overdueAsOf) {
    filter.status = 'issued';
    filter.dueOn = { $lt: query.overdueAsOf };
  }

  return paginate(RoyaltyStatement, {
    filter,
    sortField: query.sortBy || 'periodStartsOn',
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
  });
}

module.exports = {
  buildStatement,
  issueStatement,
  recordPayment,
  voidStatement,
  getStatement,
  listStatements,
  settledLinesFor,
};
