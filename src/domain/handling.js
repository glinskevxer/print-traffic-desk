'use strict';

/**
 * A restriction is a promise the desk makes to whoever owns the print. They
 * are additive: an element carries every restriction any inspection has ever
 * put on it until an inspector clears it by name.
 */

const RESTRICTIONS = Object.freeze({
  NO_PLATTER: 'no-platter',
  CHANGEOVER_ONLY: 'changeover-only',
  ARCHIVE_PROJECTIONIST_ONLY: 'archive-projectionist-only',
  NITRATE_BOOTH: 'nitrate-booth',
  SINGLE_SCREENING_PER_BOOKING: 'single-screening-per-booking',
  NO_TRAVEL_ABROAD: 'no-travel-abroad',
  HAND_CARRY_ONLY: 'hand-carry-only',
  REDUCED_SPEED: 'reduced-speed',
  NO_PUBLIC_EXHIBITION: 'no-public-exhibition',
});

const ALL_RESTRICTIONS = Object.freeze(Object.values(RESTRICTIONS));

/** What a booth or a shipment must satisfy for each restriction to hold. */
const RESTRICTION_DEMANDS = Object.freeze({
  [RESTRICTIONS.NO_PLATTER]: 'the print may not be laid up on a platter',
  [RESTRICTIONS.CHANGEOVER_ONLY]: 'the booth must run two projectors in changeover',
  [RESTRICTIONS.ARCHIVE_PROJECTIONIST_ONLY]: 'a named archive projectionist must run the show',
  [RESTRICTIONS.NITRATE_BOOTH]: 'the booth must hold a current nitrate certificate',
  [RESTRICTIONS.SINGLE_SCREENING_PER_BOOKING]: 'only one screening may be sold per booking',
  [RESTRICTIONS.NO_TRAVEL_ABROAD]: 'the element may not leave its custodian territory',
  [RESTRICTIONS.HAND_CARRY_ONLY]: 'the element travels with a courier, never by freight',
  [RESTRICTIONS.REDUCED_SPEED]: 'the print must run below its nominal speed',
  [RESTRICTIONS.NO_PUBLIC_EXHIBITION]: 'the element is for study and duplication only',
});

function isRestriction(value) {
  return ALL_RESTRICTIONS.includes(value);
}

/** Union of two restriction lists, kept in the declared order and deduplicated. */
function mergeRestrictions(existing = [], added = []) {
  const seen = new Set([...existing, ...added]);
  return ALL_RESTRICTIONS.filter((restriction) => seen.has(restriction));
}

function withoutRestrictions(existing = [], cleared = []) {
  const dropped = new Set(cleared);
  return existing.filter((restriction) => !dropped.has(restriction));
}

/** A restriction nobody can satisfy at a public screening blocks a booking. */
function blocksPublicExhibition(restrictions = []) {
  return restrictions.includes(RESTRICTIONS.NO_PUBLIC_EXHIBITION);
}

function describe(restriction) {
  return RESTRICTION_DEMANDS[restriction] || null;
}

module.exports = {
  RESTRICTIONS,
  ALL_RESTRICTIONS,
  RESTRICTION_DEMANDS,
  isRestriction,
  mergeRestrictions,
  withoutRestrictions,
  blocksPublicExhibition,
  describe,
};
