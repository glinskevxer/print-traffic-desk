'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { NotFoundError, ConflictError, RuleRefusedError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');
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

  try {
    return await Venue.create(input);
  } catch (err) {
    if (err.code === 11000) throw new ConflictError(`venue ${input.code} is already on file`, {
      code: input.code,
    });
    throw err;
  }
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
  if (query.nitrateCertified !== undefined) filter['booth.nitrateCertified'] = query.nitrateCertified;

  return paginate(Venue, {
    filter,
    sortField: query.sortBy || 'code',
    order: query.order,
    limit: query.limit,
    cursor: query.cursor,
  });
}

const EDITABLE = ['name', 'address', 'seats', 'houseNutMinor', 'inboundLeadDays',
  'outboundLeadDays', 'carrierAccount', 'timezone'];

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

module.exports = {
  createVenue,
  getVenue,
  getVenueByCode,
  listVenues,
  updateVenue,
  updateBooth,
  setVenueActive,
  EDITABLE,
};
