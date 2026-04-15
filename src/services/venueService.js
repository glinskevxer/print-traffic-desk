'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { listWith, guardDuplicates } = require('../db/listing');
const { NotFoundError, RuleRefusedError } = require('../lib/errors');
const { assertZone } = require('../lib/dates');
const { parseCsv, blankToNull } = require('../lib/csv');

async function createVenue(input) {
  const { Venue } = models();
  assertZone(input.timezone);

  if (input.address.territory !== input.territory) {
    throw new RuleRefusedError('the shipping address must sit in the venue territory', {
      venueTerritory: input.territory,
      addressTerritory: input.address.territory,
    });
  }

  return guardDuplicates(() => Venue.create(input), {
    message: `venue ${input.code} is already on file`,
    details: { code: input.code },
  });
}

async function getVenue(publicId) {
  const { Venue } = models();
  const venue = await required(Venue, publicId);
  return venue;
}

async function getVenueByCode(code) {
  const { Venue } = models();
  const venue = await Venue.findOne({ code: String(code).toUpperCase() });
  if (!venue) throw new NotFoundError('venue', code);
  return venue;
}

async function listVenues(query = {}) {
  const { Venue } = models();
  const filter = {};

  if (query.territory) filter.territory = query.territory;
  if (query.city) filter.city = new RegExp(`^${query.city}$`, 'i');
  if (query.active !== undefined) filter.active = query.active;
  if (query.gauge) filter['booth.gauges'] = query.gauge;
  if (query.nitrateCertified !== undefined)
    filter['booth.nitrateCertified'] = query.nitrateCertified;

  return listWith(Venue, { filter, query, sortField: 'code' });
}

const EDITABLE = [
  'name',
  'address',
  'seats',
  'houseNutMinor',
  'inboundLeadDays',
  'outboundLeadDays',
  'carrierAccount',
  'timezone',
];

async function updateVenue(publicId, patch) {
  const venue = await getVenue(publicId);
  if (patch.timezone) assertZone(patch.timezone);
  if (patch.address && patch.address.territory !== venue.territory) {
    throw new RuleRefusedError('a venue cannot move to another territory, retire it instead', {
      venue: publicId,
    });
  }

  for (const field of EDITABLE) {
    if (patch[field] !== undefined) venue.set(field, patch[field]);
  }
  await venue.save();
  return venue;
}

/**
 * A booth change is separate from an address change because it invalidates
 * bookings: a house that has lost its 70mm heads cannot run what it holds.
 */
async function updateBooth(publicId, booth) {
  const { PrintElement } = models();
  const venue = await getVenue(publicId);
  const previous = venue.booth.toObject();

  venue.set('booth', { ...previous, ...booth });
  await venue.save();

  const stranded = await PrintElement.countDocuments({
    currentLocation: venue._id,
    gauge: { $nin: venue.booth.gauges },
    status: { $in: ['available', 'committed'] },
  });

  return { venue, strandedElements: stranded };
}

async function setVenueActive(publicId, active) {
  const { PrintElement } = models();
  const venue = await getVenue(publicId);

  if (!active) {
    const holding = await PrintElement.countDocuments({
      currentLocation: venue._id,
      status: { $in: ['committed', 'in-transit'] },
    });
    if (holding > 0) {
      throw new RuleRefusedError('this venue still holds prints that are committed elsewhere', {
        venue: publicId,
        holding,
      });
    }
  }

  venue.active = active;
  await venue.save();
  return venue;
}

/**
 * What a house has on, night by night. The programmer wants one screen with
 * the print, its condition and whether the leg that carries it has actually
 * left, because the three questions arrive as one phone call.
 */
async function diaryFor(publicId, { from, to }) {
  const { Booking, Title, PrintElement, Shipment } = models();
  const venue = await getVenue(publicId);

  const bookings = await Booking.find({
    venue: venue._id,
    localDate: { $gte: from, $lte: to },
    status: { $ne: 'cancelled' },
  }).sort({ screeningAt: 1 });

  if (bookings.length === 0) return { venue, nights: [] };

  const [titles, elements, legs] = await Promise.all([
    Title.find({ _id: { $in: bookings.map((each) => each.title) } }, 'slug title year'),
    PrintElement.find(
      { _id: { $in: bookings.map((each) => each.element).filter(Boolean) } },
      'barcode gauge soundFormat conditionGrade status handlingRestrictions',
    ),
    Shipment.find({ toVenue: venue._id, status: { $ne: 'cancelled' } }),
  ]);

  const titleById = new Map(titles.map((each) => [String(each._id), each]));
  const elementById = new Map(elements.map((each) => [String(each._id), each]));
  const legByElement = new Map(legs.map((each) => [String(each.element), each]));

  const nights = bookings.map((booking) => {
    const title = titleById.get(String(booking.title));
    const element = booking.element ? elementById.get(String(booking.element)) : null;
    const leg = element ? legByElement.get(String(element._id)) : null;

    return {
      booking: booking.publicId,
      reference: booking.reference,
      localDate: booking.localDate,
      localTime: booking.localTime,
      status: booking.status,
      title: title ? { id: title.publicId, slug: title.slug, year: title.year } : null,
      print: element
        ? {
            id: element.publicId,
            barcode: element.barcode,
            gauge: element.gauge,
            grade: element.conditionGrade,
            status: element.status,
            restrictions: element.handlingRestrictions,
          }
        : null,
      arrival: leg
        ? { shipment: leg.publicId, status: leg.status, expected: leg.plannedArrivalOn }
        : null,
    };
  });

  return { venue, nights };
}

/**
 * Takes the spreadsheet of houses an archive already keeps.
 *
 * Nothing is written until every row has been read and checked. An import that
 * puts in the first forty rows and stops on the forty first leaves somebody
 * working out which forty went in, and they never trust the importer again.
 */
const IMPORT_COLUMNS = Object.freeze([
  'code',
  'name',
  'territory',
  'city',
  'timezone',
  'line1',
  'postcode',
  'seats',
  'currency',
  'gauges',
  'soundFormats',
  'nitrateCertified',
  'inboundLeadDays',
  'outboundLeadDays',
]);

function rowToVenue(row, line) {
  const problems = [];
  const need = (name) => {
    const value = blankToNull(row[name]);
    if (value === null) problems.push(`${name} is missing`);
    return value;
  };

  const venue = {
    code: (need('code') || '').toUpperCase(),
    name: need('name'),
    territory: (need('territory') || '').toUpperCase(),
    city: need('city'),
    timezone: blankToNull(row.timezone) || 'Europe/London',
    boxOfficeCurrency: (blankToNull(row.currency) || 'GBP').toUpperCase(),
    seats: Number(blankToNull(row.seats) || 0),
    address: {
      line1: need('line1'),
      city: blankToNull(row.city),
      postcode: need('postcode'),
      territory: (blankToNull(row.territory) || '').toUpperCase(),
    },
    booth: {
      gauges: (blankToNull(row.gauges) || '35mm').split(/[;|]/).map((value) => value.trim()),
      soundFormats: (blankToNull(row.soundFormats) || 'optical-mono')
        .split(/[;|]/)
        .map((value) => value.trim()),
      nitrateCertified: String(blankToNull(row.nitrateCertified) || '').toLowerCase() === 'yes',
    },
    inboundLeadDays: Number(blankToNull(row.inboundLeadDays) || 2),
    outboundLeadDays: Number(blankToNull(row.outboundLeadDays) || 1),
  };

  if (!Number.isInteger(venue.seats) || venue.seats < 1) problems.push('seats is not a number');

  return { line, venue, problems };
}

async function importVenues(text, { dryRun = false } = {}) {
  const { Venue } = models();
  const { headers, rows } = parseCsv(text);

  const missingColumns = ['code', 'name', 'territory', 'city', 'line1', 'postcode', 'seats'].filter(
    (name) => !headers.includes(name),
  );
  if (missingColumns.length > 0) {
    throw new RuleRefusedError('that file is missing columns the desk needs', {
      missing: missingColumns,
      expected: IMPORT_COLUMNS,
    });
  }

  const read = rows.map((row, index) => rowToVenue(row, index + 2));
  const broken = read.filter((entry) => entry.problems.length > 0);

  const codes = read.map((entry) => entry.venue.code);
  const repeated = codes.filter((code, index) => codes.indexOf(code) !== index);
  if (repeated.length > 0) {
    broken.push({ line: 0, problems: [`${[...new Set(repeated)].join(', ')} appears twice`] });
  }

  const existing = await Venue.find({ code: { $in: codes } }, 'code');
  const alreadyOnFile = existing.map((venue) => venue.code);

  if (broken.length > 0) {
    throw new RuleRefusedError('that file has rows the desk cannot read', {
      rows: broken.map((entry) => ({ line: entry.line, problems: entry.problems })),
    });
  }

  const toAdd = read.filter((entry) => !alreadyOnFile.includes(entry.venue.code));
  if (dryRun) {
    return {
      read: read.length,
      added: 0,
      wouldAdd: toAdd.length,
      skipped: alreadyOnFile,
      dryRun: true,
    };
  }

  for (const entry of toAdd) {
    // eslint-disable-next-line no-await-in-loop
    await createVenue(entry.venue);
  }

  return {
    read: read.length,
    added: toAdd.length,
    wouldAdd: 0,
    skipped: alreadyOnFile,
    dryRun: false,
  };
}

module.exports = {
  importVenues,
  IMPORT_COLUMNS,
  diaryFor,
  createVenue,
  getVenue,
  getVenueByCode,
  listVenues,
  updateVenue,
  updateBooth,
  setVenueActive,
  EDITABLE,
};
