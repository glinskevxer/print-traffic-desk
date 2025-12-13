'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { withTransaction } = require('../db/connection');
const { ConflictError, RuleRefusedError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');
const audit = require('../lib/audit');
const { assertTerritory } = require('../domain/rights/territories');
const { findExclusivityClashes, clashIsResolvable } = require('../domain/rights/exclusivity');
const { clearScreening, refusalDetails } = require('../domain/rights/clearance');
const { assertTermsComplete } = require('../domain/royalties/terms');
const { localDateOf } = require('../lib/dates');

async function getWindow(publicId, session = null) {
  const { RightsWindow } = models();
  const window = await required(RightsWindow, publicId, { session });
  return window;
}

/** Every window on a title that is not itself, for clash checking. */
async function siblingWindows(window, session = null) {
  const { RightsWindow } = models();
  return RightsWindow.find({ title: window.title, publicId: { $ne: window.publicId } }, null, {
    session,
  });
}

async function createWindow(input) {
  const { RightsWindow, Title, RightsHolder, Venue } = models();

  const title = await required(Title, input.titleId);
  const holder = await required(RightsHolder, input.rightsHolderId);

  assertTerritory(input.territory);
  assertTermsComplete(input.terms);

  if (input.terms.currency !== holder.remittanceCurrency) {
    throw new RuleRefusedError(
      'a licence has to be written in the currency the holder is paid in',
      {
        terms: input.terms.currency,
        holder: holder.remittanceCurrency,
      },
    );
  }

  let heldBy = null;
  if (input.exclusivity && input.exclusivity.scope !== 'none') {
    const venue = await required(Venue, input.exclusivity.heldByVenueId);
    heldBy = venue._id;
  }

  return RightsWindow.create({
    ...input,
    title: title._id,
    rightsHolder: holder._id,
    exclusivity: { scope: input.exclusivity ? input.exclusivity.scope : 'none', heldBy },
    status: 'draft',
  });
}

/**
 * Activation is the moment a promise is made, so the clash check happens here
 * rather than at draft time. Two drafts may contradict each other; two live
 * licences may not.
 */
async function activateWindow(publicId) {
  return withTransaction(async (session) => {
    const window = await getWindow(publicId, session);

    if (window.status === 'active') return window;
    if (window.status === 'expired') {
      throw new RuleRefusedError('an expired licence cannot be activated, write a new one', {
        window: publicId,
      });
    }

    const siblings = await siblingWindows(window, session);
    const clashes = findExclusivityClashes(window, siblings).filter(
      (other) => !clashIsResolvable(window, other),
    );
    if (clashes.length > 0) {
      throw new ConflictError('another exclusive licence already covers this', {
        window: publicId,
        clashesWith: clashes.map((other) => other.publicId),
      });
    }

    const before = window.status;
    window.status = 'active';
    window.suspendedReason = undefined;
    await window.save({ session });

    await audit.record(
      {
        action: 'rights-window.activated',
        subjectType: 'rights-window',
        subjectId: window.publicId,
        changes: [{ field: 'status', before, after: 'active' }],
      },
      { session },
    );
    return window;
  });
}

async function suspendWindow(publicId, reason) {
  return withTransaction(async (session) => {
    const window = await getWindow(publicId, session);
    if (!reason) {
      throw new RuleRefusedError('suspending a licence needs a reason', { window: publicId });
    }

    const before = window.status;
    window.status = 'suspended';
    window.suspendedReason = reason;
    await window.save({ session });

    await audit.record(
      {
        action: 'rights-window.suspended',
        subjectType: 'rights-window',
        subjectId: window.publicId,
        changes: [{ field: 'status', before, after: 'suspended' }],
        metadata: { reason },
      },
      { session },
    );
    return window;
  });
}

/** Sweeps windows whose end date has passed into expired. Run from the CLI. */
async function expireFinishedWindows(today) {
  const { RightsWindow } = models();
  const result = await RightsWindow.updateMany(
    { status: { $in: ['active', 'suspended'] }, endsOn: { $lt: today } },
    { $set: { status: 'expired' } },
  );
  return result.modifiedCount;
}

async function listWindows(query = {}) {
  const { RightsWindow, Title, RightsHolder } = models();
  const filter = {};

  if (query.titleId) {
    const title = await required(Title, query.titleId);
    filter.title = title._id;
  }
  if (query.rightsHolderId) {
    const holder = await required(RightsHolder, query.rightsHolderId);
    filter.rightsHolder = holder._id;
  }
  if (query.status) filter.status = query.status;
  if (query.territory) filter.territory = query.territory;
  if (query.exclusiveOnly) filter['exclusivity.scope'] = { $ne: 'none' };
  if (query.onDate) {
    filter.startsOn = { $lte: query.onDate };
    filter.endsOn = { $gte: query.onDate };
  }

  return paginate(RightsWindow, {
    filter,
    sortField: query.sortBy || 'startsOn',
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
  });
}

/**
 * Hydrates the windows for one title with the venue facts the exclusivity rule
 * needs, then runs the engine. Nothing is written: a booking calls this, and so
 * does the programmer who wants to know before they advertise.
 */
async function clearScreeningRequest({
  titleId,
  venue,
  localDate,
  exhibitionType,
  screenings = 1,
  screeningsAtVenue = 0,
}) {
  const { RightsWindow, Title, Venue } = models();

  const title = await required(Title, titleId);

  const windows = await RightsWindow.find({ title: title._id });
  const holderVenueIds = windows
    .filter((window) => window.exclusivity.heldBy)
    .map((window) => window.exclusivity.heldBy);
  const holderVenues = holderVenueIds.length
    ? await Venue.find({ _id: { $in: holderVenueIds } })
    : [];
  const venuesById = new Map(holderVenues.map((each) => [String(each._id), each]));

  const decorate = (window) => {
    const holder = venuesById.get(String(window.exclusivity.heldBy));
    return Object.assign(window.toObject({ virtuals: false }), {
      publicId: window.publicId,
      holderCity: holder ? holder.city : null,
      holderName: holder ? holder.name : null,
    });
  };

  const decorated = windows.map(decorate);
  const request = {
    localDate,
    country: venue.territory,
    city: venue.city,
    exhibitionType,
    venueId: String(venue._id),
    screenings,
    screeningsAtVenue,
  };

  const decision = clearScreening({
    windows: decorated,
    exclusiveWindows: decorated.filter((window) => window.exclusivity.scope !== 'none'),
    request,
  });

  return { ...decision, request, details: refusalDetails(decision.evaluations) };
}

/** Same question, phrased from an instant rather than a local date. */
async function clearScreeningAt({ titleId, venue, instant, exhibitionType, screenings }) {
  return clearScreeningRequest({
    titleId,
    venue,
    localDate: localDateOf(instant, venue.timezone),
    exhibitionType,
    screenings,
  });
}

module.exports = {
  createWindow,
  getWindow,
  activateWindow,
  suspendWindow,
  expireFinishedWindows,
  listWindows,
  clearScreeningRequest,
  clearScreeningAt,
};
