'use strict';

const { models } = require('../models');
const { withTransaction } = require('../db/connection');
const { NotFoundError, RuleRefusedError, ConflictError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');
const audit = require('../lib/audit');
const { bookingReference } = require('../lib/ids');
const { instantOf, localDateOf, addDays } = require('../lib/dates');
const { assertTransition } = require('../domain/elements/status');
const { rankCandidates } = require('../domain/elements/selection');
const { planRoundTrip } = require('../domain/traffic/routing');
const { spansFromShipments, isFreeBetween } = require('../domain/traffic/availability');
const rightsService = require('./rightsService');

const DEFAULT_HOLD_MINUTES = 2880;

async function loadBooking(publicId, session = null) {
  const { Booking } = models();
  const booking = await Booking.byPublicId(publicId, { session });
  if (!booking) throw new NotFoundError('booking', publicId);
  return booking;
}

/** How many screenings this house has already taken off the same licence. */
async function screeningsTakenAt(titleId, venueId, session) {
  const { Booking } = models();
  return Booking.countDocuments(
    { title: titleId, venue: venueId, status: { $in: ['held', 'cleared', 'confirmed', 'settled'] } },
    { session },
  );
}

/**
 * Everything on the shelf for this title that is free for the span the trip
 * needs and that this booth could run, best first.
 */
async function candidateElements({ title, venue, span, session }) {
  const { PrintElement, Shipment, Venue } = models();

  const elements = await PrintElement.find(
    { title: title._id, status: { $in: ['available', 'intake'] } },
    null,
    { session },
  );
  if (elements.length === 0) return { runnable: [], rejected: [], unavailable: [] };

  const shipments = await Shipment.find(
    { element: { $in: elements.map((each) => each._id) } },
    null,
    { session },
  );
  const byElement = new Map();
  for (const shipment of shipments) {
    const key = String(shipment.element);
    if (!byElement.has(key)) byElement.set(key, []);
    byElement.get(key).push(shipment);
  }

  const free = [];
  const unavailable = [];
  for (const element of elements) {
    const spans = spansFromShipments(byElement.get(String(element._id)) || []);
    if (isFreeBetween(spans, span.startsOn, span.endsOn)) free.push(element);
    else unavailable.push(element);
  }

  const locations = await Venue.find(
    { _id: { $in: free.map((each) => each.currentLocation) } },
    null,
    { session },
  );
  const territoryById = new Map(locations.map((each) => [String(each._id), each.territory]));

  const ranked = rankCandidates(free, {
    venue,
    territoryOf: (element) => territoryById.get(String(element.currentLocation)) || null,
  });
  return { ...ranked, unavailable };
}

/**
 * Takes a hold. Three things have to be true at once and they are checked in
 * this order because that is the order a venue can do something about them:
 * the licence, then a print, then the calendar.
 */
async function requestBooking(input) {
  const { Booking, Title, Venue, PrintElement, RightsWindow } = models();
  const holdMinutes = input.holdMinutes || DEFAULT_HOLD_MINUTES;

  return withTransaction(async (session) => {
    const title = await Title.byPublicId(input.titleId, { session });
    if (!title) throw new NotFoundError('title', input.titleId);
    if (title.status !== 'bookable') {
      throw new RuleRefusedError('this title is not bookable', {
        title: input.titleId,
        status: title.status,
      });
    }

    const venue = await Venue.byPublicId(input.venueId, { session });
    if (!venue) throw new NotFoundError('venue', input.venueId);
    if (!venue.active) {
      throw new RuleRefusedError('this house is not taking bookings', { venue: input.venueId });
    }

    const screeningAt = instantOf(input.localDate, input.localTime, venue.timezone);
    const takenHere = await screeningsTakenAt(title._id, venue._id, session);

    const decision = await rightsService.clearScreeningRequest({
      titleId: title.publicId,
      venue,
      localDate: input.localDate,
      exhibitionType: input.exhibitionType,
      screenings: 1,
      screeningsAtVenue: takenHere,
    });
    if (!decision.cleared) {
      throw new RuleRefusedError('no licence clears this screening', {
        refusalCodes: decision.refusalCodes,
        refusals: decision.details,
      });
    }

    const today = input.today || localDateOf(new Date(), venue.timezone);
    const span = { startsOn: today, endsOn: addDays(input.localDate, 21) };
    const { runnable, rejected, unavailable } = await candidateElements({
      title,
      venue,
      span,
      session,
    });

    let chosen;
    if (input.elementId) {
      const asked = runnable.find((each) => each.element.publicId === input.elementId);
      if (!asked) {
        throw new RuleRefusedError('that print cannot take this booking', {
          element: input.elementId,
          rejected: rejected.map((each) => ({
            element: each.element.publicId,
            problems: each.problems,
          })),
        });
      }
      chosen = asked;
    } else {
      [chosen] = runnable;
    }
    if (!chosen) {
      throw new RuleRefusedError('no print of this title can play at this house', {
        rejected: rejected.map((each) => ({ element: each.element.publicId, problems: each.problems })),
        unavailable: unavailable.map((each) => each.publicId),
      });
    }

    const element = chosen.element;
    const origin = await Venue.findById(element.currentLocation, null, { session });
    const plan = planRoundTrip({
      fromTerritory: origin.territory,
      toTerritory: venue.territory,
      outboundLeadDays: origin.outboundLeadDays,
      inboundLeadDays: venue.inboundLeadDays,
      inspectionDays: element.needsInspection() ? 3 : 0,
      screeningLocalDate: input.localDate,
      holdDaysAfterScreening: input.holdDaysAfterScreening || 1,
      today,
      restrictions: element.handlingRestrictions,
      baseStock: element.baseStock,
    });
    if (!plan.feasible) {
      throw new RuleRefusedError(plan.outbound.detail, {
        element: element.publicId,
        reason: plan.outbound.reason,
        shortfallDays: plan.outbound.shortfallDays,
      });
    }

    const window = await RightsWindow.byPublicId(decision.windowId, { session });
    const [booking] = await Booking.create(
      [
        {
          reference: bookingReference(screeningAt),
          title: title._id,
          venue: venue._id,
          element: element._id,
          rightsWindow: window._id,
          screeningAt,
          localDate: input.localDate,
          localTime: input.localTime,
          exhibitionType: input.exhibitionType,
          status: 'held',
          holdExpiresAt: new Date(Date.now() + holdMinutes * 60000),
          clearance: {
            windowId: window.publicId,
            clearedAt: new Date(),
            outcomes: decision.evaluations
              .find((evaluation) => evaluation.windowId === window.publicId)
              .outcomes.map(({ code, ok, detail }) => ({ code, ok, detail })),
          },
          traffic: {
            committedFrom: plan.committedFrom,
            committedUntil: plan.committedUntil,
            service: plan.outbound.service,
          },
          idempotencyKey: input.idempotencyKey || null,
          bookedBy: input.bookedBy,
          notes: input.notes,
        },
      ],
      { session },
    );

    assertTransition(element.status, 'committed', { element: element.publicId });
    await PrintElement.updateOne(
      { _id: element._id, revision: element.revision },
      { $set: { status: 'committed' }, $inc: { revision: 1 } },
      { session },
    ).then((result) => {
      if (result.matchedCount === 0) {
        throw new ConflictError('that print was committed by somebody else, try again', {
          element: element.publicId,
        });
      }
    });

    await RightsWindow.updateOne(
      { _id: window._id },
      { $inc: { screeningsUsed: 1 } },
      { session },
    );

    await audit.record(
      {
        action: 'booking.held',
        subjectType: 'booking',
        subjectId: booking.publicId,
        metadata: {
          reference: booking.reference,
          title: title.slug,
          venue: venue.code,
          element: element.publicId,
          window: window.publicId,
        },
      },
      { session },
    );

    return { booking, element, plan, decision };
  });
}

async function getBooking(publicId) {
  return loadBooking(publicId);
}

async function listBookings(query = {}) {
  const { Booking, Title, Venue, PrintElement } = models();
  const filter = {};

  if (query.titleId) {
    const title = await Title.byPublicId(query.titleId);
    if (!title) throw new NotFoundError('title', query.titleId);
    filter.title = title._id;
  }
  if (query.venueId) {
    const venue = await Venue.byPublicId(query.venueId);
    if (!venue) throw new NotFoundError('venue', query.venueId);
    filter.venue = venue._id;
  }
  if (query.elementId) {
    const element = await PrintElement.byPublicId(query.elementId);
    if (!element) throw new NotFoundError('print element', query.elementId);
    filter.element = element._id;
  }
  if (query.status) filter.status = query.status;
  if (query.from) filter.localDate = { ...(filter.localDate || {}), $gte: query.from };
  if (query.to) filter.localDate = { ...(filter.localDate || {}), $lte: query.to };

  return paginate(Booking, {
    filter,
    sortField: query.sortBy || 'screeningAt',
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
  });
}

module.exports = {
  DEFAULT_HOLD_MINUTES,
  requestBooking,
  getBooking,
  listBookings,
  loadBooking,
  candidateElements,
  screeningsTakenAt,
};
