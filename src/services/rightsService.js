'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { listWith } = require('../db/listing');
const { withTransaction } = require('../db/connection');
const { ConflictError, RuleRefusedError } = require('../lib/errors');
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

  return listWith(RightsWindow, { filter, query, sortField: 'startsOn' });
}

/**
 * Hydrates the windows for one title with the venue facts the exclusivity rule
 * needs, then runs the engine. Nothing is written: a booking calls this, and so
 * does the programmer who wants to know before they advertise.
 */
/**
 * Every licence on a title, with the venue facts the exclusivity rule needs
 * folded in. Loaded once and handed around: an availability sweep asks the
 * same question of thirty houses, and loading the licences thirty times was
 * sixty queries for one screen.
 */
async function licencesFor(titleId) {
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

  const decorated = windows.map((window) => {
    const holder = venuesById.get(String(window.exclusivity.heldBy));
    return Object.assign(window.toObject({ virtuals: false }), {
      publicId: window.publicId,
      holderCity: holder ? holder.city : null,
      holderName: holder ? holder.name : null,
    });
  });

  return {
    title,
    windows: decorated,
    exclusives: decorated.filter((window) => window.exclusivity.scope !== 'none'),
  };
}

/**
 * Runs the engine against licences already loaded. Nothing is written: a
 * booking calls this, and so does the programmer who wants to know before they
 * advertise.
 */
function decide({
  licences,
  venue,
  localDate,
  exhibitionType,
  screenings = 1,
  screeningsAtVenue = 0,
}) {
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
    windows: licences.windows,
    exclusiveWindows: licences.exclusives,
    request,
  });

  return { ...decision, request, details: refusalDetails(decision.evaluations) };
}

async function clearScreeningRequest({
  titleId,
  venue,
  localDate,
  exhibitionType,
  screenings = 1,
  screeningsAtVenue = 0,
}) {
  const licences = await licencesFor(titleId);
  return decide({ licences, venue, localDate, exhibitionType, screenings, screeningsAtVenue });
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

/**
 * Copies a licence forward into a new period.
 *
 * Renewals are how most licences are written: the same territory, the same
 * terms, a year later. Typing them again is where the mistakes come from, so
 * the desk copies the old one and takes only the dates and whatever the
 * renewal actually changed.
 *
 * The copy is a draft. A renewal that goes live on its own is a renewal
 * nobody read.
 */
const RENEWABLE = Object.freeze([
  'title',
  'rightsHolder',
  'territory',
  'exhibitionTypes',
  'maxScreenings',
  'maxScreeningsPerVenue',
  'blackouts',
  'terms',
]);

async function renewWindow(publicId, { startsOn, endsOn, changes = {}, reference }) {
  const { RightsWindow } = models();

  return withTransaction(async (session) => {
    const previous = await getWindow(publicId, session);

    if (!['active', 'expired', 'suspended'].includes(previous.status)) {
      throw new RuleRefusedError('a draft is not renewed, it is edited', {
        window: publicId,
        status: previous.status,
      });
    }
    if (startsOn > endsOn) {
      throw new RuleRefusedError('the renewal ends before it starts', { startsOn, endsOn });
    }
    if (startsOn <= previous.endsOn) {
      throw new RuleRefusedError('a renewal starts after the licence it renews', {
        renewalStartsOn: startsOn,
        previousEndsOn: previous.endsOn,
      });
    }

    const carried = {};
    for (const field of RENEWABLE) {
      carried[field] = previous.get(field);
    }
    // Blackouts are dated, so last year's are not this year's. They are
    // dropped rather than shifted: a festival moves, and guessing when is
    // worse than making somebody type it.
    const blackoutsDropped = carried.blackouts.length;
    carried.blackouts = [];

    if (changes.terms) carried.terms = { ...carried.terms.toObject(), ...changes.terms };
    if (changes.maxScreenings !== undefined) carried.maxScreenings = changes.maxScreenings;
    if (changes.maxScreeningsPerVenue !== undefined) {
      carried.maxScreeningsPerVenue = changes.maxScreeningsPerVenue;
    }
    if (changes.exhibitionTypes) carried.exhibitionTypes = changes.exhibitionTypes;

    assertTermsComplete(carried.terms);

    const [renewal] = await RightsWindow.create(
      [
        {
          ...carried,
          startsOn,
          endsOn,
          reference: reference || previous.reference,
          status: 'draft',
          screeningsUsed: 0,
          exclusivity: { scope: previous.exclusivity.scope, heldBy: previous.exclusivity.heldBy },
          notes: `renewed from ${previous.publicId}`,
        },
      ],
      { session },
    );

    await audit.record(
      {
        action: 'rights-window.renewed',
        subjectType: 'rights-window',
        subjectId: renewal.publicId,
        metadata: {
          renewedFrom: previous.publicId,
          startsOn,
          endsOn,
          blackoutsDropped,
          termsChanged: Boolean(changes.terms),
        },
      },
      { session },
    );

    return { renewal, previous, blackoutsDropped };
  });
}

module.exports = {
  licencesFor,
  decide,
  renewWindow,
  RENEWABLE,
  createWindow,
  getWindow,
  activateWindow,
  suspendWindow,
  expireFinishedWindows,
  listWindows,
  clearScreeningRequest,
  clearScreeningAt,
};
