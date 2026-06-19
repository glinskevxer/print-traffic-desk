'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { listWith } = require('../db/listing');
const { withTransaction } = require('../db/connection');
const { RuleRefusedError, ConflictError } = require('../lib/errors');
const audit = require('../lib/audit');
const outbox = require('../lib/outbox');
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

    // The live statuses, matching the unique index: a period that has been
    // voided or credited can be stated again, and a credit note shares the
    // period of the statement it corrects without blocking it.
    const existing = await RoyaltyStatement.findOne(
      {
        rightsHolder: holder._id,
        periodStartsOn,
        periodEndsOn,
        status: { $in: ['draft', 'issued', 'paid'] },
        creditsStatement: null,
      },
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

    await outbox.enqueue(
      {
        kind: 'statement.issued',
        subjectType: 'royalty-statement',
        subjectId: statement.publicId,
        to: holder.name,
        channel: 'email',
        payload: {
          periodStartsOn: statement.periodStartsOn,
          periodEndsOn: statement.periodEndsOn,
          totalMinor: statement.totalMinor,
          currency: statement.currency,
          dueOn: statement.dueOn,
        },
      },
      { session },
    );

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

  return listWith(RoyaltyStatement, { filter, query, sortField: 'periodStartsOn' });
}

/**
 * Corrects an issued statement without editing it.
 *
 * A distributor has the paper. Changing what a statement said after they have
 * filed it is how a reconciliation takes a month, so the desk raises a credit
 * note: a statement of its own, with the lines reversed, pointing at the one it
 * corrects. Both stay, and both add up.
 */
async function creditStatement(publicId, { reason, issuedOn, lines = null }) {
  const { RoyaltyStatement, RightsHolder } = models();

  if (!reason) {
    throw new RuleRefusedError('a credit note needs a reason', { statement: publicId });
  }

  return withTransaction(async (session) => {
    const original = await loadStatement(publicId, session);

    // The already credited check comes first: crediting moves the statement
    // out of issued, so a second attempt would otherwise be told the status is
    // wrong rather than that somebody has already done it.
    if (original.creditedBy) {
      throw new ConflictError('that statement has already been credited', {
        statement: publicId,
        creditNote: String(original.creditedBy),
      });
    }
    if (!['issued', 'paid'].includes(original.status)) {
      throw new RuleRefusedError('only an issued statement is corrected with a credit note', {
        statement: publicId,
        status: original.status,
      });
    }
    if (original.isCreditNote()) {
      throw new RuleRefusedError('a credit note is not itself credited', { statement: publicId });
    }

    const reversedFrom = lines
      ? original.lines.filter((line) => lines.includes(line.reference))
      : original.lines;
    if (reversedFrom.length === 0) {
      throw new RuleRefusedError('none of those bookings are on that statement', {
        statement: publicId,
        asked: lines,
      });
    }

    const reversed = reversedFrom.map((line) => ({
      booking: line.booking,
      reference: line.reference,
      titleSlug: line.titleSlug,
      venueCode: line.venueCode,
      localDate: line.localDate,
      admissions: line.admissions,
      grossMinor: line.grossMinor,
      royaltyMinor: -line.royaltyMinor,
      basis: `credit: ${line.basis}`,
    }));

    const holder = await RightsHolder.findById(original.rightsHolder, null, { session });
    const [note] = await RoyaltyStatement.create(
      [
        {
          rightsHolder: original.rightsHolder,
          periodStartsOn: original.periodStartsOn,
          periodEndsOn: original.periodEndsOn,
          currency: original.currency,
          lines: reversed,
          totalMinor: reversed.reduce((sum, line) => sum + line.royaltyMinor, 0),
          screeningCount: reversed.length,
          admissionsTotal: reversed.reduce((sum, line) => sum + line.admissions, 0),
          grossTotalMinor: reversed.reduce((sum, line) => sum + line.grossMinor, 0),
          status: 'issued',
          issuedOn,
          dueOn: addDays(issuedOn, holder.settlementDays),
          creditsStatement: original._id,
          creditReason: reason,
        },
      ],
      { session },
    );

    original.creditedBy = note._id;
    original.status = 'credited';
    await original.save({ session });

    await audit.record(
      {
        action: 'statement.credited',
        subjectType: 'royalty-statement',
        subjectId: original.publicId,
        changes: [{ field: 'status', before: 'issued', after: 'credited' }],
        metadata: {
          creditNote: note.publicId,
          reason,
          reversedLines: reversed.length,
          totalMinor: note.totalMinor,
        },
      },
      { session },
    );

    return { note, original };
  });
}

module.exports = {
  creditStatement,
  buildStatement,
  issueStatement,
  recordPayment,
  voidStatement,
  getStatement,
  listStatements,
  settledLinesFor,
};
