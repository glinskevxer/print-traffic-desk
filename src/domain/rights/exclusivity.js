'use strict';

const { covers, overlap } = require('./territories');
const { isWithin, rangesOverlap } = require('../../lib/dates');
const { pass, fail } = require('./rules');

/**
 * Exclusivity is the only clearance rule that reads other people's licences.
 * A house that has bought the exclusive on a title in a city stops every other
 * house in that city showing it, whatever their own licence says, and the desk
 * has to be able to name the house doing the blocking.
 */

function isLive(window, localDate) {
  return window.status === 'active' && isWithin(localDate, window.startsOn, window.endsOn);
}

function sharesExhibition(window, exhibitionType) {
  return window.exhibitionTypes.includes(exhibitionType);
}

/**
 * Does this exclusive window reach the screening being asked for? The holder
 * is never blocked by their own exclusive.
 */
function blocks(exclusiveWindow, request) {
  if (!exclusiveWindow.exclusivity || exclusiveWindow.exclusivity.scope === 'none') return false;
  if (!isLive(exclusiveWindow, request.localDate)) return false;
  if (!sharesExhibition(exclusiveWindow, request.exhibitionType)) return false;
  if (!covers(exclusiveWindow.territory, request.country)) return false;

  const heldBy = String(exclusiveWindow.exclusivity.heldBy || '');
  if (heldBy && heldBy === String(request.venueId)) return false;

  if (exclusiveWindow.exclusivity.scope === 'city') {
    return normaliseCity(exclusiveWindow.holderCity) === normaliseCity(request.city);
  }
  return true;
}

function normaliseCity(city) {
  return String(city || '').trim().toLowerCase();
}

/**
 * Reads a list of exclusive windows on the same title and answers with one
 * outcome. Everything that blocks is listed, because a venue told about one
 * blocker and then a second one loses a day each time.
 */
function exclusivityRule(exclusiveWindows, request) {
  const blocking = (exclusiveWindows || []).filter((window) => blocks(window, request));

  if (blocking.length === 0) {
    return pass('exclusivity', 'no exclusive licence covers this screening');
  }

  const named = blocking
    .map((window) => `${window.holderName || window.publicId} (${window.exclusivity.scope})`)
    .join(', ');
  return {
    ...fail('exclusivity', `an exclusive licence is held by ${named}`),
    blockedBy: blocking.map((window) => window.publicId),
  };
}

/**
 * Two exclusive licences on one title that reach the same country, on the same
 * kind of exhibition, at the same time cannot both be granted. This is checked
 * when a window is written, not when a booking is made.
 */
function findExclusivityClashes(candidate, existingWindows) {
  if (!candidate.exclusivity || candidate.exclusivity.scope === 'none') return [];

  return (existingWindows || []).filter((existing) => {
    if (String(existing.publicId) === String(candidate.publicId)) return false;
    if (!existing.exclusivity || existing.exclusivity.scope === 'none') return false;
    if (!['active', 'draft'].includes(existing.status)) return false;
    if (!rangesOverlap(candidate, existing)) return false;
    if (!overlap(candidate.territory, existing.territory)) return false;
    return candidate.exhibitionTypes.some((kind) => existing.exhibitionTypes.includes(kind));
  });
}

/**
 * A city exclusive and a territory exclusive can coexist only when the city
 * one is held by the house the territory one is held by. Anything else is two
 * promises the desk cannot keep at once.
 */
function clashIsResolvable(candidate, existing) {
  const sameHolder =
    String(candidate.exclusivity.heldBy || '') === String(existing.exclusivity.heldBy || '');
  return sameHolder && candidate.exclusivity.heldBy !== null;
}

module.exports = {
  blocks,
  exclusivityRule,
  findExclusivityClashes,
  clashIsResolvable,
  normaliseCity,
};
