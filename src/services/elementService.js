'use strict';

const { models } = require('../models');
const { withTransaction } = require('../db/connection');
const { NotFoundError, ConflictError, RuleRefusedError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');
const { assertTransition, isCommitted } = require('../domain/elements/status');
const { boothCompatibility } = require('../domain/elements/compatibility');
const audit = require('../lib/audit');

async function getElement(publicId, session = null) {
  const { PrintElement } = models();
  const element = await PrintElement.byPublicId(publicId, { session });
  if (!element) throw new NotFoundError('print element', publicId);
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

  const title = await Title.byPublicId(input.titleId);
  if (!title) throw new NotFoundError('title', input.titleId);
  const owner = await RightsHolder.byPublicId(input.ownerId);
  if (!owner) throw new NotFoundError('rights holder', input.ownerId);
  const custodian = await Venue.byPublicId(input.custodianId);
  if (!custodian) throw new NotFoundError('venue', input.custodianId);

  if (input.baseStock === 'nitrate' && !custodian.booth.nitrateCertified) {
    throw new RuleRefusedError('nitrate cannot be held by a house without a certificate', {
      venue: custodian.publicId,
    });
  }

  try {
    return await PrintElement.create({
      ...input,
      title: title._id,
      owner: owner._id,
      custodian: custodian._id,
      currentLocation: custodian._id,
      status: 'intake',
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError(`barcode ${input.barcode} is already catalogued`, {
        barcode: input.barcode,
      });
    }
    throw err;
  }
}

async function listElements(query = {}) {
  const { PrintElement, Title, Venue } = models();
  const filter = {};

  if (query.titleId) {
    const title = await Title.byPublicId(query.titleId);
    if (!title) throw new NotFoundError('title', query.titleId);
    filter.title = title._id;
  }
  if (query.locationId) {
    const venue = await Venue.byPublicId(query.locationId);
    if (!venue) throw new NotFoundError('venue', query.locationId);
    filter.currentLocation = venue._id;
  }
  if (query.status) filter.status = query.status;
  if (query.gauge) filter.gauge = query.gauge;
  if (query.baseStock) filter.baseStock = query.baseStock;
  if (query.grade) filter.conditionGrade = query.grade;
  if (query.needsInspection) {
    filter.$expr = { $gte: ['$screeningsSinceInspection', '$inspectionIntervalScreenings'] };
  }

  return paginate(PrintElement, {
    filter,
    sortField: query.sortBy || 'barcode',
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
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
    const venue = await Venue.byPublicId(venuePublicId, { session });
    if (!venue) throw new NotFoundError('venue', venuePublicId);

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

module.exports = {
  getElement,
  getElementByBarcode,
  catalogueElement,
  listElements,
  relocate,
  setStatus,
  boothCompatibility,
};
