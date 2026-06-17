'use strict';

const { models } = require('../models');
const { BOOKING_REFERENCE_PATTERN } = require('../lib/ids');

/**
 * The box at the top of the screen.
 *
 * Whoever is at the desk types one thing: a barcode off a can, a venue code
 * off a despatch note, a booking reference somebody read down the phone, or
 * part of a title. Making them pick which kind first is making them do the
 * computer's job, so the shape of what they typed decides where to look.
 */

const BARCODE = /^PE-?\d{1,6}$/i;
const VENUE_CODE = /^[A-Z]{2}-[A-Z]{2,4}(-[A-Z0-9]{1,10})?$/i;
const PUBLIC_ID = /^[a-z]{2,6}_[0-9A-Z]{16}$/;

function shapeOf(term) {
  const trimmed = String(term).trim();
  if (PUBLIC_ID.test(trimmed)) return 'public-id';
  if (BOOKING_REFERENCE_PATTERN.test(trimmed.toUpperCase())) return 'booking-reference';
  if (BARCODE.test(trimmed)) return 'barcode';
  if (VENUE_CODE.test(trimmed)) return 'venue-code';
  return 'text';
}

/** A barcode written as PE-123, PE123 or 123 all mean the same can. */
function normaliseBarcode(term) {
  const digits = String(term).replace(/\D/g, '');
  return `PE-${digits.padStart(6, '0')}`;
}

const ID_PREFIXES = Object.freeze({
  ttl: { model: 'Title', kind: 'title' },
  ven: { model: 'Venue', kind: 'venue' },
  rh: { model: 'RightsHolder', kind: 'rights-holder' },
  elem: { model: 'PrintElement', kind: 'print element' },
  insp: { model: 'InspectionReport', kind: 'inspection' },
  rw: { model: 'RightsWindow', kind: 'licence' },
  shp: { model: 'Shipment', kind: 'shipment' },
  bkg: { model: 'Booking', kind: 'booking' },
  stmt: { model: 'RoyaltyStatement', kind: 'statement' },
  exj: { model: 'ExtractionJob', kind: 'reading' },
});

async function byPublicId(term) {
  const prefix = term.split('_')[0];
  const target = ID_PREFIXES[prefix];
  if (!target) return [];

  const found = await models()[target.model].byPublicId(term);
  return found
    ? [{ kind: target.kind, id: found.publicId, label: labelFor(target.kind, found) }]
    : [];
}

function labelFor(kind, document) {
  if (kind === 'title') return `${document.title} (${document.year})`;
  if (kind === 'venue') return `${document.code} ${document.name}`;
  if (kind === 'print element') return `${document.barcode} ${document.gauge}`;
  if (kind === 'booking') return `${document.reference} ${document.localDate}`;
  if (kind === 'rights-holder') return document.name;
  if (kind === 'statement') return `${document.periodStartsOn} to ${document.periodEndsOn}`;
  return document.publicId;
}

/**
 * Text goes to the index on the catalogue and to a prefix match on the venue
 * name. The catalogue is the only collection big enough to need a text index,
 * and a regex over a few hundred houses costs nothing.
 */
async function byText(term, limit) {
  const { Title, Venue } = models();

  const [titles, venues] = await Promise.all([
    Title.find(
      { $text: { $search: term } },
      { score: { $meta: 'textScore' }, slug: 1, title: 1, year: 1, publicId: 1 },
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit),
    Venue.find({ name: { $regex: escapeRegex(term), $options: 'i' } }, 'publicId code name').limit(
      limit,
    ),
  ]);

  return [
    ...titles.map((title) => ({
      kind: 'title',
      id: title.publicId,
      label: `${title.title} (${title.year})`,
    })),
    ...venues.map((venue) => ({
      kind: 'venue',
      id: venue.publicId,
      label: `${venue.code} ${venue.name}`,
    })),
  ];
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function search(term, { limit = 10 } = {}) {
  const trimmed = String(term || '').trim();
  if (trimmed.length < 2) return { term: trimmed, shape: 'too-short', results: [] };

  const shape = shapeOf(trimmed);
  const { PrintElement, Venue, Booking } = models();

  if (shape === 'public-id') {
    return { term: trimmed, shape, results: await byPublicId(trimmed) };
  }

  if (shape === 'barcode') {
    const element = await PrintElement.findOne({ barcode: normaliseBarcode(trimmed) });
    return {
      term: trimmed,
      shape,
      results: element
        ? [
            {
              kind: 'print element',
              id: element.publicId,
              label: labelFor('print element', element),
            },
          ]
        : [],
    };
  }

  if (shape === 'booking-reference') {
    const booking = await Booking.findOne({ reference: trimmed.toUpperCase() });
    return {
      term: trimmed,
      shape,
      results: booking
        ? [{ kind: 'booking', id: booking.publicId, label: labelFor('booking', booking) }]
        : [],
    };
  }

  if (shape === 'venue-code') {
    const venues = await Venue.find({
      code: { $regex: `^${escapeRegex(trimmed.toUpperCase())}`, $options: '' },
    }).limit(limit);
    return {
      term: trimmed,
      shape,
      results: venues.map((venue) => ({
        kind: 'venue',
        id: venue.publicId,
        label: labelFor('venue', venue),
      })),
    };
  }

  return { term: trimmed, shape, results: await byText(trimmed, limit) };
}

module.exports = { search, shapeOf, normaliseBarcode, labelFor, ID_PREFIXES };
