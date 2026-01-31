'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { listWith, guardDuplicates } = require('../db/listing');
const { NotFoundError, RuleRefusedError } = require('../lib/errors');
const { assertZone } = require('../lib/dates');

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

module.exports = {
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
