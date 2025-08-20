'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { withTransaction } = require('../db/connection');
const { RuleRefusedError, ConflictError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');
const audit = require('../lib/audit');
const { bookingReference } = require('../lib/ids');
const { instantOf, localDateOf, addDays } = require('../lib/dates');
const { assertTransition } = require('../domain/elements/status');
const { rankCandidates } = require('../domain/elements/selection');
const { planRoundTrip } = require('../domain/traffic/routing');
const { spansFromShipments, isFreeBetween } = require('../domain/traffic/availability');
const { computeRoyalty } = require('../domain/royalties/compute');
const rightsService = require('./rightsService');

const DEFAULT_HOLD_MINUTES = 2880;

async function loadBooking(publicId, session = null) {
  const { Booking } = models();
  const booking = await required(Booking, publicId, { session });
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
    const title = await required(Title, input.titleId, { session });
    if (title.status !== 'bookable') {
      throw new RuleRefusedError('this title is not bookable', {
        title: input.titleId,
        status: title.status,
      });
    }

    const venue = await required(Venue, input.venueId, { session });
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

/**
 * Confirming turns a hold into traffic. Two legs are written now rather than
 * at hold time, because a hold that lapses should leave no despatch note
 * behind for somebody to act on.
 */
async function confirmBooking(publicId, { confirmedBy } = {}) {
  const { Booking, Shipment, PrintElement, Venue } = models();

  return withTransaction(async (session) => {
    const booking = await loadBooking(publicId, session);

    if (booking.status === 'confirmed') return { booking, shipments: [] };
    if (booking.status !== 'held') {
      throw new RuleRefusedError('only a held booking can be confirmed', {
        booking: publicId,
        status: booking.status,
      });
    }
    if (booking.hasLapsed()) {
      throw new RuleRefusedError('this hold has run out, ask for it again', { booking: publicId });
    }

    const element = await PrintElement.findById(booking.element, null, { session });
    const venue = await Venue.findById(booking.venue, null, { session });
    const origin = await Venue.findById(element.currentLocation, null, { session });

    const legs = await Shipment.create(
      [
        {
          element: element._id,
          fromVenue: origin._id,
          toVenue: venue._id,
          leg: 'outbound',
          service: booking.traffic.service,
          plannedDispatchOn: booking.traffic.committedFrom,
          plannedArrivalOn: booking.localDate,
          cans: element.reelCount,
        },
        {
          element: element._id,
          fromVenue: venue._id,
          toVenue: origin._id,
          leg: 'return',
          service: booking.traffic.service,
          plannedDispatchOn: addDays(booking.localDate, 1),
          plannedArrivalOn: booking.traffic.committedUntil,
          cans: element.reelCount,
        },
      ],
      { session },
    );

    booking.status = 'confirmed';
    booking.holdExpiresAt = null;
    booking.traffic.outboundShipment = legs[0]._id;
    booking.traffic.returnShipment = legs[1]._id;
    if (confirmedBy) booking.bookedBy = confirmedBy;
    await booking.save({ session });

    await audit.record(
      {
        action: 'booking.confirmed',
        subjectType: 'booking',
        subjectId: booking.publicId,
        changes: [{ field: 'status', before: 'held', after: 'confirmed' }],
        metadata: { outbound: legs[0].publicId, return: legs[1].publicId },
      },
      { session },
    );

    return { booking, shipments: legs };
  });
}

/**
 * Releases everything a booking was holding: the licence count, the print and
 * any leg that had not yet gone. A leg already on the road is left alone,
 * because the print is in a van and cancelling the paperwork does not stop it.
 */
async function releaseBooking(booking, { session, nextStatus, reason, feeMinor }) {
  const { Shipment, PrintElement, RightsWindow } = models();

  const openLegs = await Shipment.find(
    {
      _id: { $in: [booking.traffic.outboundShipment, booking.traffic.returnShipment].filter(Boolean) },
      status: 'planned',
    },
    null,
    { session },
  );
  for (const leg of openLegs) {
    leg.status = 'cancelled';
    // eslint-disable-next-line no-await-in-loop
    await leg.save({ session });
  }

  const element = await PrintElement.findById(booking.element, null, { session });
  if (element && element.status === 'committed') {
    element.status = 'available';
    await element.save({ session });
  }

  if (booking.rightsWindow) {
    await RightsWindow.updateOne(
      { _id: booking.rightsWindow, screeningsUsed: { $gt: 0 } },
      { $inc: { screeningsUsed: -1 } },
      { session },
    );
  }

  const before = booking.status;
  booking.status = nextStatus;
  booking.cancellation = { reason: reason || null, at: new Date(), feeMinor: feeMinor ?? null };
  await booking.save({ session });

  await audit.record(
    {
      action: `booking.${nextStatus}`,
      subjectType: 'booking',
      subjectId: booking.publicId,
      changes: [{ field: 'status', before, after: nextStatus }],
      metadata: { reason: reason || null, legsCancelled: openLegs.length },
    },
    { session },
  );

  return { booking, element, legsCancelled: openLegs.length };
}

async function cancelBooking(publicId, { reason, feeMinor }) {
  return withTransaction(async (session) => {
    const booking = await loadBooking(publicId, session);
    if (!booking.isLive()) {
      throw new RuleRefusedError('this booking is already closed', {
        booking: publicId,
        status: booking.status,
      });
    }
    if (!reason) {
      throw new RuleRefusedError('cancelling a booking needs a reason', { booking: publicId });
    }
    return releaseBooking(booking, { session, nextStatus: 'cancelled', reason, feeMinor });
  });
}

/**
 * Sweeps holds nobody confirmed. Run on a timer: a lapsed hold that keeps its
 * print committed is how a shelf fills up with prints nobody is showing.
 */
async function lapseExpiredHolds(now = new Date()) {
  const { Booking } = models();
  const expired = await Booking.find({ status: "held", holdExpiresAt: { $lte: now } }).limit(200);

  const lapsed = [];
  for (const held of expired) {
    // eslint-disable-next-line no-await-in-loop
    await withTransaction(async (session) => {
      const booking = await loadBooking(held.publicId, session);
      if (booking.status !== "held") return;
      await releaseBooking(booking, {
        session,
        nextStatus: "lapsed",
        reason: "the hold ran out",
      });
      lapsed.push(booking.publicId);
    });
  }
  return lapsed;
}

/**
 * The house rings the takings through the morning after. The royalty is worked
 * out here and stored with its basis, so a statement six weeks later shows the
 * same number the venue was told on the phone.
 */
async function reportBoxOffice(publicId, input) {
  const { Booking, Venue, RightsWindow, PrintElement } = models();

  return withTransaction(async (session) => {
    const booking = await loadBooking(publicId, session);

    if (!['confirmed', 'settled'].includes(booking.status)) {
      throw new RuleRefusedError('takings can only be reported against a confirmed booking', {
        booking: publicId,
        status: booking.status,
      });
    }
    if (booking.status === 'settled') {
      throw new RuleRefusedError('this booking is already settled', { booking: publicId });
    }

    const venue = await Venue.findById(booking.venue, null, { session });
    if (input.currency !== venue.boxOfficeCurrency) {
      throw new RuleRefusedError('the takings are not in the currency this house sells in', {
        reported: input.currency,
        house: venue.boxOfficeCurrency,
      });
    }
    if (input.admissions > venue.seats * 4) {
      throw new RuleRefusedError('that is more admissions than the house could seat in a day', {
        admissions: input.admissions,
        seats: venue.seats,
      });
    }

    const window = await RightsWindow.findById(booking.rightsWindow, null, { session });
    const boxOffice = {
      grossMinor: input.grossMinor,
      currency: input.currency,
      admissions: input.admissions,
      houseNutMinor: input.houseNutMinor ?? venue.houseNutMinor,
      reportedAt: new Date(),
      reportedBy: input.reportedBy,
    };

    const royalty = computeRoyalty({ terms: window.terms, boxOffice });

    booking.boxOffice = boxOffice;
    booking.royaltyMinor = royalty.amountMinor;
    booking.royaltyCurrency = royalty.currency;
    booking.royaltyBasis = royalty.basis;
    await booking.save({ session });

    // The screening has happened, so the print has one more run on it.
    await PrintElement.updateOne(
      { _id: booking.element },
      { $inc: { screeningsSinceInspection: 1 } },
      { session },
    );

    await audit.record(
      {
        action: 'booking.box-office-reported',
        subjectType: 'booking',
        subjectId: booking.publicId,
        metadata: {
          grossMinor: boxOffice.grossMinor,
          admissions: boxOffice.admissions,
          royaltyMinor: royalty.amountMinor,
          basis: royalty.basis,
        },
      },
      { session },
    );

    return { booking, royalty };
  });
}

/** Closes a booking once the money has been accounted for. */
async function settleBooking(publicId, settledOn) {
  return withTransaction(async (session) => {
    const booking = await loadBooking(publicId, session);

    if (booking.status !== 'confirmed') {
      throw new RuleRefusedError('only a confirmed booking settles', {
        booking: publicId,
        status: booking.status,
      });
    }
    if (!booking.boxOffice) {
      throw new RuleRefusedError('the takings have not been reported yet', { booking: publicId });
    }

    booking.status = 'settled';
    booking.settledOn = settledOn;
    await booking.save({ session });

    await audit.record(
      {
        action: 'booking.settled',
        subjectType: 'booking',
        subjectId: booking.publicId,
        changes: [{ field: 'status', before: 'confirmed', after: 'settled' }],
        metadata: { royaltyMinor: booking.royaltyMinor, settledOn },
      },
      { session },
    );

    return booking;
  });
}

/** Bookings that have played but whose takings nobody has rung through. */
async function awaitingBoxOffice(asOfLocalDate) {
  const { Booking } = models();
  return Booking.find({
    status: 'confirmed',
    boxOffice: null,
    localDate: { $lt: asOfLocalDate },
  }).sort({ localDate: 1 });
}

async function listBookings(query = {}) {
  const { Booking, Title, Venue, PrintElement } = models();
  const filter = {};

  if (query.titleId) {
    const title = await required(Title, query.titleId);
    filter.title = title._id;
  }
  if (query.venueId) {
    const venue = await required(Venue, query.venueId);
    filter.venue = venue._id;
  }
  if (query.elementId) {
    const element = await required(PrintElement, query.elementId);
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
  confirmBooking,
  cancelBooking,
  lapseExpiredHolds,
  reportBoxOffice,
  settleBooking,
  awaitingBoxOffice,
  releaseBooking,
  getBooking,
  listBookings,
  loadBooking,
  candidateElements,
  screeningsTakenAt,
};
