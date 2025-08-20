'use strict';

const { NotFoundError } = require('../lib/errors');

/**
 * Nine services all wrote the same four lines: fetch by public id, and if it
 * is not there raise the not found with a label a client can read. Two of them
 * had drifted and said "element" where the rest said "print element", so a
 * venue chasing an error code got two different answers for one mistake.
 */

const LABELS = Object.freeze({
  Title: 'title',
  Venue: 'venue',
  RightsHolder: 'rights holder',
  PrintElement: 'print element',
  InspectionReport: 'inspection report',
  RightsWindow: 'rights window',
  Shipment: 'shipment',
  Booking: 'booking',
  RoyaltyStatement: 'royalty statement',
});

function labelFor(model) {
  return LABELS[model.modelName] || model.modelName.toLowerCase();
}

/** Fetch by public id, or raise the not found the client sees. */
async function required(model, publicId, { session = null } = {}) {
  const document = await model.byPublicId(publicId, { session });
  if (!document) throw new NotFoundError(labelFor(model), publicId);
  return document;
}

/** Fetch by mongo id where the caller already holds a reference. */
async function requiredById(model, id, { session = null } = {}) {
  const document = await model.findById(id, null, { session });
  if (!document) throw new NotFoundError(labelFor(model), String(id));
  return document;
}

/**
 * Resolves several public ids at once. Used where a create takes three
 * references and a client wants to know about all of them, not the first.
 */
async function requireAll(pairs, { session = null } = {}) {
  const resolved = {};
  const missing = [];

  for (const [name, model, publicId] of pairs) {
    if (publicId === undefined || publicId === null) continue;
    // eslint-disable-next-line no-await-in-loop
    const document = await model.byPublicId(publicId, { session });
    if (document) resolved[name] = document;
    else missing.push({ resource: labelFor(model), identifier: publicId });
  }

  if (missing.length === 1) {
    throw new NotFoundError(missing[0].resource, missing[0].identifier);
  }
  if (missing.length > 1) {
    const err = new NotFoundError(missing[0].resource, missing[0].identifier);
    err.details.alsoMissing = missing.slice(1);
    throw err;
  }
  return resolved;
}

module.exports = { LABELS, labelFor, required, requiredById, requireAll };
