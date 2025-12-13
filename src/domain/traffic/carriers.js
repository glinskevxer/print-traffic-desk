'use strict';

const { RESTRICTIONS } = require('../handling');
const { ValidationError } = require('../../lib/errors');

/**
 * Prints travel as freight, and how long a leg takes is a property of the lane
 * and the service, not of the distance. The desk quotes from a table because
 * that is what the carriers themselves quote from.
 */

const SERVICES = Object.freeze(['road-freight', 'air-freight', 'courier', 'hand-carry']);

const SERVICE_BASE_DAYS = Object.freeze({
  'road-freight': 3,
  'air-freight': 2,
  courier: 1,
  'hand-carry': 1,
});

/**
 * Lanes are written from the shipper's point of view and are symmetric unless
 * a customs regime makes them otherwise. GB to EU picks up two customs days in
 * each direction; inside the union it picks up none.
 */
const LANES = Object.freeze({
  'GB->GB': { transitDays: 1, customsDays: 0 },
  'IE->IE': { transitDays: 1, customsDays: 0 },
  'GB->IE': { transitDays: 3, customsDays: 1 },
  'IE->GB': { transitDays: 3, customsDays: 1 },
  'GB->EU': { transitDays: 4, customsDays: 2 },
  'EU->GB': { transitDays: 4, customsDays: 2 },
  'EU->EU': { transitDays: 3, customsDays: 0 },
  'GB->US': { transitDays: 6, customsDays: 3 },
  'US->GB': { transitDays: 6, customsDays: 3 },
  'EU->US': { transitDays: 6, customsDays: 3 },
  'US->US': { transitDays: 3, customsDays: 0 },
  DEFAULT: { transitDays: 8, customsDays: 4 },
});

const EU_MEMBERS = require('../rights/territories').EU;

function laneKey(territory) {
  if (territory === 'GB') return 'GB';
  if (territory === 'IE') return 'IE';
  if (territory === 'US') return 'US';
  if (EU_MEMBERS.includes(territory)) return 'EU';
  return 'OTHER';
}

function laneFor(fromTerritory, toTerritory) {
  const key = `${laneKey(fromTerritory)}->${laneKey(toTerritory)}`;
  return LANES[key] || LANES.DEFAULT;
}

/**
 * A hand carried print never goes in a freight consolidation, and a nitrate
 * element never flies. Both are decided by what the element carries, not by
 * what the venue would prefer.
 */
function permittedServices({ restrictions = [], baseStock = 'polyester' } = {}) {
  let allowed = [...SERVICES];

  if (restrictions.includes(RESTRICTIONS.HAND_CARRY_ONLY)) {
    allowed = allowed.filter((service) => ['courier', 'hand-carry'].includes(service));
  }
  if (baseStock === 'nitrate') {
    allowed = allowed.filter((service) => service !== 'air-freight');
  }
  return allowed;
}

function assertService(service) {
  if (!SERVICES.includes(service)) {
    throw new ValidationError(`${service} is not a service this desk books`, [
      { key: 'service', problem: 'unknown carrier service' },
    ]);
  }
  return service;
}

/**
 * Working days in transit, split so a despatch note can show the customs hold
 * separately. Hand carry skips customs queues because somebody is standing in
 * them with the cans.
 */
function estimateTransit({ fromTerritory, toTerritory, service = 'road-freight' }) {
  assertService(service);
  const lane = laneFor(fromTerritory, toTerritory);
  const base = SERVICE_BASE_DAYS[service];

  const transitDays = Math.max(base, service === 'hand-carry' ? 1 : lane.transitDays);
  const customsDays = service === 'hand-carry' ? 0 : lane.customsDays;

  return {
    service,
    transitDays,
    customsDays,
    totalDays: transitDays + customsDays,
    crossesBorder: laneKey(fromTerritory) !== laneKey(toTerritory) || fromTerritory !== toTerritory,
  };
}

/** The quickest permitted way to get an element from one place to another. */
function fastestPermitted({ fromTerritory, toTerritory, restrictions, baseStock }) {
  const allowed = permittedServices({ restrictions, baseStock });
  if (allowed.length === 0) return null;

  return allowed
    .map((service) => estimateTransit({ fromTerritory, toTerritory, service }))
    .sort(
      (a, b) =>
        a.totalDays - b.totalDays || SERVICES.indexOf(a.service) - SERVICES.indexOf(b.service),
    )
    .at(0);
}

module.exports = {
  SERVICES,
  SERVICE_BASE_DAYS,
  LANES,
  laneKey,
  laneFor,
  permittedServices,
  assertService,
  estimateTransit,
  fastestPermitted,
};
