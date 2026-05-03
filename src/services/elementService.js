'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { listWith, guardDuplicates } = require('../db/listing');
const { withTransaction } = require('../db/connection');
const { NotFoundError, RuleRefusedError } = require('../lib/errors');
const { assertTransition, isCommitted } = require('../domain/elements/status');
const { boothCompatibility } = require('../domain/elements/compatibility');
const audit = require('../lib/audit');

async function getElement(publicId, session = null) {
  const { PrintElement } = models();
  const element = await required(PrintElement, publicId, { session });
  return element;
}

async function getElementByBarcode(barcode) {
  const { PrintElement } = models();
  const element = await PrintElement.findOne({ barcode: String(barcode).toUpperCase() });
  if (!element) throw new NotFoundError('print element', barcode);
  return element;
}

async function catalogueElement(input) {
  const { PrintElement, Title, Venue, RightsHolder } = models();

  const title = await required(Title, input.titleId);
  const owner = await required(RightsHolder, input.ownerId);
  const custodian = await required(Venue, input.custodianId);

  if (input.baseStock === 'nitrate' && !custodian.booth.nitrateCertified) {
    throw new RuleRefusedError('nitrate cannot be held by a house without a certificate', {
      venue: custodian.publicId,
    });
  }

  return guardDuplicates(
    () =>
      PrintElement.create({
        ...input,
        title: title._id,
        owner: owner._id,
        custodian: custodian._id,
        currentLocation: custodian._id,
        status: 'intake',
      }),
    {
      message: `barcode ${input.barcode} is already catalogued`,
      details: { barcode: input.barcode },
    },
  );
}

/**
 * Provenance is free text and runs to pages on an archive print. A shelf
 * listing does not want it and the single element endpoint does.
 */
const ELEMENT_LIST_PROJECTION = '-provenance';

async function listElements(query = {}) {
  const { PrintElement, Title, Venue } = models();
  const filter = {};

  if (query.titleId) {
    const title = await required(Title, query.titleId);
    filter.title = title._id;
  }
  if (query.locationId) {
    const venue = await required(Venue, query.locationId);
    filter.currentLocation = venue._id;
  }
  if (query.status) filter.status = query.status;
  if (query.gauge) filter.gauge = query.gauge;
  if (query.baseStock) filter.baseStock = query.baseStock;
  if (query.grade) filter.conditionGrade = query.grade;
  if (query.needsInspection) {
    Object.assign(filter, PrintElement.dueForInspectionFilter());
  }

  return listWith(PrintElement, {
    filter,
    query,
    sortField: 'barcode',
    projection: ELEMENT_LIST_PROJECTION,
  });
}

/**
 * Moving a print is a fact about where it is, not a booking. The traffic side
 * records the shipment; this is the desk correcting the shelf.
 */
async function relocate(publicId, venuePublicId, reason) {
  const { Venue } = models();

  return withTransaction(async (session) => {
    const element = await getElement(publicId, session);
    const venue = await required(Venue, venuePublicId, { session });

    if (isCommitted(element.status)) {
      throw new RuleRefusedError('this print is committed, cancel the booking before moving it', {
        element: publicId,
        status: element.status,
      });
    }
    if (element.baseStock === 'nitrate' && !venue.booth.nitrateCertified) {
      throw new RuleRefusedError('nitrate cannot be sent to a house without a certificate', {
        venue: venuePublicId,
      });
    }

    const from = String(element.currentLocation);
    element.currentLocation = venue._id;
    element.provenance = reason
      ? `${element.provenance ? `${element.provenance}\n` : ''}${reason}`
      : element.provenance;
    await element.save({ session });

    await audit.record(
      {
        action: 'element.relocated',
        subjectType: 'print-element',
        subjectId: element.publicId,
        changes: [{ field: 'currentLocation', before: from, after: String(venue._id) }],
        metadata: { venueCode: venue.code, reason: reason || null },
      },
      { session },
    );
    return element;
  });
}

async function setStatus(publicId, status, reason) {
  return withTransaction(async (session) => {
    const element = await getElement(publicId, session);
    assertTransition(element.status, status, { element: publicId });

    if (status === 'retired' && !reason) {
      throw new RuleRefusedError('retiring a print needs a reason', { element: publicId });
    }
    const before = element.status;
    element.status = status;
    if (reason) {
      element.provenance = `${element.provenance ? `${element.provenance}\n` : ''}${reason}`;
    }
    await element.save({ session });

    if (before !== status) {
      await audit.record(
        {
          action: 'element.status-changed',
          subjectType: 'print-element',
          subjectId: element.publicId,
          changes: [{ field: 'status', before, after: status }],
          metadata: { reason: reason || null },
        },
        { session },
      );
    }
    return element;
  });
}

/**
 * Where a print has been and what happened to it. An archive is asked this
 * about a fifty year old element more often than it is asked anything else:
 * before it lends one out, whoever is borrowing wants to know how many times
 * it has run and who last looked at it.
 */
async function provenanceOf(publicId, { limit = 100 } = {}) {
  const { Shipment, InspectionReport, Booking, Venue } = models();
  const element = await getElement(publicId);

  const [legs, inspections, screenings] = await Promise.all([
    Shipment.find({ element: element._id }).sort({ plannedDispatchOn: 1 }).limit(limit),
    InspectionReport.find({ element: element._id }).sort({ inspectedAt: 1 }).limit(limit),
    Booking.find({ element: element._id, status: { $in: ['confirmed', 'settled'] } })
      .sort({ screeningAt: 1 })
      .limit(limit),
  ]);

  const venueIds = [
    ...legs.map((leg) => leg.fromVenue),
    ...legs.map((leg) => leg.toVenue),
    ...screenings.map((booking) => booking.venue),
    element.currentLocation,
    element.custodian,
  ];
  const venues = await Venue.find({ _id: { $in: venueIds } }, 'code name');
  const codeOf = new Map(venues.map((venue) => [String(venue._id), venue.code]));

  const events = [
    ...legs.map((leg) => ({
      at: leg.arrivedOn || leg.plannedArrivalOn,
      kind: 'travelled',
      detail: `${leg.leg} leg ${codeOf.get(String(leg.fromVenue))} to ${codeOf.get(String(leg.toVenue))}`,
      status: leg.status,
      reference: leg.publicId,
    })),
    ...inspections.map((report) => ({
      at: report.inspectedAt.toISOString().slice(0, 10),
      kind: 'inspected',
      detail: `${report.kind} by ${report.inspector}, graded ${report.assessment.grade}`,
      status: report.assessment.verdict,
      reference: report.publicId,
    })),
    ...screenings.map((booking) => ({
      at: booking.localDate,
      kind: 'screened',
      detail: `at ${codeOf.get(String(booking.venue))}`,
      status: booking.status,
      reference: booking.reference,
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return {
    element,
    home: codeOf.get(String(element.custodian)) || null,
    at: codeOf.get(String(element.currentLocation)) || null,
    screenings: screenings.length,
    inspections: inspections.length,
    legs: legs.length,
    events,
  };
}

/**
 * Hands a print to a different keeper.
 *
 * Custody is not location. A print can sit in a vault for years while a
 * different archive owns it, and the difference matters: the custodian is
 * where a leg comes home to, and the owner is who is told when it is
 * quarantined and who is asked before it travels abroad.
 */
async function transferCustody(publicId, { custodianId, ownerId, reason, effectiveOn }) {
  const { Venue, RightsHolder } = models();

  if (!reason) {
    throw new RuleRefusedError('handing a print to a new keeper needs a reason', {
      element: publicId,
    });
  }

  return withTransaction(async (session) => {
    const element = await getElement(publicId, session);

    if (isCommitted(element.status)) {
      throw new RuleRefusedError('this print is out, bring it home before it changes hands', {
        element: publicId,
        status: element.status,
      });
    }
    if (element.status === 'retired') {
      throw new RuleRefusedError('a retired print does not change hands', { element: publicId });
    }

    const changes = [];

    if (custodianId) {
      const custodian = await required(Venue, custodianId, { session });
      if (element.baseStock === 'nitrate' && !custodian.booth.nitrateCertified) {
        throw new RuleRefusedError('nitrate cannot be kept by a house without a certificate', {
          venue: custodianId,
        });
      }
      if (String(custodian._id) !== String(element.custodian)) {
        changes.push({
          field: 'custodian',
          before: String(element.custodian),
          after: String(custodian._id),
        });
        element.custodian = custodian._id;
      }
    }

    if (ownerId) {
      const owner = await required(RightsHolder, ownerId, { session });
      if (!owner.active) {
        throw new RuleRefusedError('that party is no longer trading', { owner: ownerId });
      }
      if (String(owner._id) !== String(element.owner)) {
        changes.push({ field: 'owner', before: String(element.owner), after: String(owner._id) });
        element.owner = owner._id;
      }
    }

    if (changes.length === 0) {
      throw new RuleRefusedError('that print already has that keeper', { element: publicId });
    }

    const stamped = effectiveOn ? `on ${effectiveOn}` : 'today';
    element.provenance = `${element.provenance ? `${element.provenance}\n` : ''}custody changed ${stamped}: ${reason}`;
    await element.save({ session });

    await audit.record(
      {
        action: 'element.custody-changed',
        subjectType: 'print-element',
        subjectId: element.publicId,
        changes,
        metadata: { reason, effectiveOn: effectiveOn || null },
      },
      { session },
    );

    return { element, changes };
  });
}

module.exports = {
  ELEMENT_LIST_PROJECTION,
  transferCustody,
  provenanceOf,
  getElement,
  getElementByBarcode,
  catalogueElement,
  listElements,
  relocate,
  setStatus,
  boothCompatibility,
};
