'use strict';

const { models } = require('../models');
const { withTransaction } = require('../db/connection');
const { NotFoundError, RuleRefusedError, ConflictError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');
const audit = require('../lib/audit');
const { assertTransition } = require('../domain/elements/status');
const { planOutbound, planReturn } = require('../domain/traffic/routing');
const { permittedServices } = require('../domain/traffic/carriers');

async function loadShipment(publicId, session = null) {
  const { Shipment } = models();
  const shipment = await Shipment.byPublicId(publicId, { session });
  if (!shipment) throw new NotFoundError('shipment', publicId);
  return shipment;
}

/**
 * Plans one leg and books it. The plan is recomputed here rather than trusted
 * from the caller, because a client that worked out its own dates last week is
 * planning against last week's calendar.
 */
async function planLeg({ elementId, toVenueId, leg, screeningLocalDate, today, service, holdDays = 1 }) {
  const { PrintElement, Venue, Shipment } = models();

  return withTransaction(async (session) => {
    const element = await PrintElement.byPublicId(elementId, { session });
    if (!element) throw new NotFoundError('print element', elementId);

    const destination = await Venue.byPublicId(toVenueId, { session });
    if (!destination) throw new NotFoundError('venue', toVenueId);

    const origin = await Venue.findById(element.currentLocation, null, { session });
    if (String(origin._id) === String(destination._id)) {
      throw new RuleRefusedError('the print is already at that house', { venue: toVenueId });
    }

    const open = await Shipment.countDocuments(
      { element: element._id, status: { $in: ['planned', 'collected', 'in-transit', 'delayed'] } },
      { session },
    );
    if (open > 0) {
      throw new ConflictError('this print already has a leg open', { element: elementId, open });
    }

    const permitted = permittedServices({
      restrictions: element.handlingRestrictions,
      baseStock: element.baseStock,
    });
    if (service && !permitted.includes(service)) {
      throw new RuleRefusedError(`${service} is not permitted for this element`, {
        element: elementId,
        permitted,
      });
    }

    const planner = leg === 'return' ? planReturn : planOutbound;
    const plan = planner({
      fromTerritory: origin.territory,
      toTerritory: destination.territory,
      outboundLeadDays: origin.outboundLeadDays,
      inboundLeadDays: destination.inboundLeadDays,
      inspectionDays: element.needsInspection() ? 3 : 0,
      screeningLocalDate,
      holdDaysAfterScreening: holdDays,
      today,
      restrictions: element.handlingRestrictions,
      baseStock: element.baseStock,
      service,
    });

    if (!plan.feasible) {
      throw new RuleRefusedError(plan.detail, {
        element: elementId,
        reason: plan.reason,
        shortfallDays: plan.shortfallDays,
      });
    }

    const [shipment] = await Shipment.create(
      [
        {
          element: element._id,
          fromVenue: origin._id,
          toVenue: destination._id,
          leg,
          service: plan.service,
          plannedDispatchOn: plan.dates.dispatchOn,
          plannedArrivalOn: leg === 'return' ? plan.dates.backOn : plan.dates.arriveBy,
          cans: element.reelCount,
          insuredValueMinor: element.insuredValueMinor,
          insuredValueCurrency: element.insuredValueCurrency,
        },
      ],
      { session },
    );

    await audit.record(
      {
        action: 'shipment.planned',
        subjectType: 'shipment',
        subjectId: shipment.publicId,
        metadata: { element: element.publicId, to: destination.code, service: plan.service },
      },
      { session },
    );

    return { shipment, plan };
  });
}

async function dispatch(publicId, { dispatchedOn, carrier, trackingReference }) {
  const { PrintElement } = models();

  return withTransaction(async (session) => {
    const shipment = await loadShipment(publicId, session);
    if (shipment.status !== 'planned') {
      throw new RuleRefusedError('only a planned leg can be despatched', {
        shipment: publicId,
        status: shipment.status,
      });
    }

    const element = await PrintElement.findById(shipment.element, null, { session });
    assertTransition(element.status, 'in-transit', { element: element.publicId });

    shipment.status = 'in-transit';
    shipment.dispatchedOn = dispatchedOn;
    shipment.carrier = carrier;
    shipment.trackingReference = trackingReference;
    await shipment.save({ session });

    const before = element.status;
    element.status = 'in-transit';
    await element.save({ session });

    await audit.record(
      {
        action: 'shipment.dispatched',
        subjectType: 'shipment',
        subjectId: shipment.publicId,
        changes: [{ field: 'status', before: 'planned', after: 'in-transit' }],
        metadata: { element: element.publicId, elementStatusBefore: before, trackingReference },
      },
      { session },
    );

    return { shipment, element };
  });
}

/**
 * Arrival is where the print's location actually changes. The element lands on
 * loan at a venue and back to available at its own custodian, which is the
 * difference between a print that is out and one that is home.
 */
async function markArrived(publicId, { arrivedOn, arrivalCheck }) {
  const { PrintElement } = models();

  return withTransaction(async (session) => {
    const shipment = await loadShipment(publicId, session);
    if (!['in-transit', 'collected', 'delayed'].includes(shipment.status)) {
      throw new RuleRefusedError('this leg is not on the road', {
        shipment: publicId,
        status: shipment.status,
      });
    }

    const element = await PrintElement.findById(shipment.element, null, { session });
    const home = String(shipment.toVenue) === String(element.custodian);
    const nextStatus = home ? 'available' : 'on-loan';
    assertTransition(element.status, nextStatus, { element: element.publicId });

    shipment.status = 'delivered';
    shipment.arrivedOn = arrivedOn;
    shipment.arrivalCheck = arrivalCheck || null;
    await shipment.save({ session });

    element.currentLocation = shipment.toVenue;
    element.status = nextStatus;
    await element.save({ session });

    await audit.record(
      {
        action: 'shipment.arrived',
        subjectType: 'shipment',
        subjectId: shipment.publicId,
        changes: [{ field: 'status', before: 'in-transit', after: 'delivered' }],
        metadata: {
          element: element.publicId,
          cansReceived: arrivalCheck ? arrivalCheck.cansReceived : null,
          sealsIntact: arrivalCheck ? arrivalCheck.sealsIntact : null,
        },
      },
      { session },
    );

    return { shipment, element };
  });
}

async function markDelayed(publicId, reason) {
  const shipment = await loadShipment(publicId);
  if (!shipment.isOpen()) {
    throw new RuleRefusedError('a closed leg cannot be delayed', { shipment: publicId });
  }
  shipment.status = 'delayed';
  shipment.notes = reason;
  await shipment.save();
  return shipment;
}

/** A lost print quarantines nothing: it is gone, and the element is retired. */
async function markLost(publicId, { reportedOn, reason }) {
  const { PrintElement } = models();

  return withTransaction(async (session) => {
    const shipment = await loadShipment(publicId, session);
    if (!shipment.isOpen()) {
      throw new RuleRefusedError('a closed leg cannot be reported lost', { shipment: publicId });
    }

    const element = await PrintElement.findById(shipment.element, null, { session });
    shipment.status = 'lost';
    shipment.lostReportedOn = reportedOn;
    shipment.notes = reason;
    await shipment.save({ session });

    const before = element.status;
    element.status = 'retired';
    element.provenance = `${element.provenance ? `${element.provenance}\n` : ''}lost in transit: ${reason}`;
    await element.save({ session });

    await audit.record(
      {
        action: 'shipment.lost',
        subjectType: 'shipment',
        subjectId: shipment.publicId,
        changes: [{ field: 'status', before, after: 'retired' }],
        metadata: { element: element.publicId, reason },
      },
      { session },
    );

    return { shipment, element };
  });
}

async function listShipments(query = {}) {
  const { Shipment, PrintElement, Venue } = models();
  const filter = {};

  if (query.elementId) {
    const element = await PrintElement.byPublicId(query.elementId);
    if (!element) throw new NotFoundError('print element', query.elementId);
    filter.element = element._id;
  }
  if (query.venueId) {
    const venue = await Venue.byPublicId(query.venueId);
    if (!venue) throw new NotFoundError('venue', query.venueId);
    filter.$or = [{ fromVenue: venue._id }, { toVenue: venue._id }];
  }
  if (query.status) filter.status = query.status;
  if (query.leg) filter.leg = query.leg;
  if (query.openOnly) filter.status = { $in: ['planned', 'collected', 'in-transit', 'delayed'] };

  return paginate(Shipment, {
    filter,
    sortField: query.sortBy || 'plannedDispatchOn',
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
  });
}

/** Legs that should have landed by now, worst first, for the morning chase. */
async function overdueArrivals(today) {
  const { Shipment } = models();
  return Shipment.find({
    status: { $in: ['collected', 'in-transit', 'delayed'] },
    plannedArrivalOn: { $lt: today },
  }).sort({ plannedArrivalOn: 1 });
}

module.exports = {
  planLeg,
  dispatch,
  markArrived,
  markDelayed,
  markLost,
  listShipments,
  overdueArrivals,
  loadShipment,
};
