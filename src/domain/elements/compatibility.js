'use strict';

const { boothRunsGauge, playableSoundFormat } = require('../formats');
const { RESTRICTIONS, blocksPublicExhibition, describe } = require('../handling');

/**
 * Whether a booth can run a print. This lived inside the element service until
 * the booking path needed the same answer and got a slightly different one, so
 * it is a rule now and both callers read it.
 *
 * Each check answers with a code and a sentence. The codes are stable: the
 * front of house screen groups on them.
 */

function gaugeCheck(element, venue) {
  if (boothRunsGauge(element.gauge, venue.booth.gauges)) return null;
  return { rule: 'gauge', detail: `${venue.code} does not run ${element.gauge}` };
}

function soundCheck(element, venue) {
  const playable = playableSoundFormat(element.soundFormat, venue.booth.soundFormats);
  if (playable) return null;
  return { rule: 'sound', detail: `${venue.code} cannot reproduce ${element.soundFormat}` };
}

function speedCheck(element, venue) {
  if (venue.booth.speeds.includes(element.projectionSpeed)) return null;
  return {
    rule: 'speed',
    detail: `${venue.code} cannot hold ${element.projectionSpeed} frames a second`,
  };
}

function nitrateCheck(element, venue) {
  if (element.baseStock !== 'nitrate' || venue.booth.nitrateCertified) return null;
  return { rule: 'nitrate', detail: `${venue.code} holds no nitrate certificate` };
}

function reelCheck(element, venue) {
  if (element.reelCount <= venue.booth.reelCapacity) return null;
  return {
    rule: 'reels',
    detail: `${element.reelCount} reels is past the ${venue.booth.reelCapacity} this booth holds`,
  };
}

/**
 * Restrictions are checked one at a time rather than as a set, because the
 * sentence a venue needs is the one naming the restriction they fail.
 */
function restrictionChecks(element, venue) {
  const problems = [];
  const has = (restriction) => element.handlingRestrictions.includes(restriction);

  if (has(RESTRICTIONS.CHANGEOVER_ONLY) && !venue.booth.changeoverCapable) {
    problems.push({
      rule: 'changeover',
      detail: `${venue.code} cannot run changeover, and ${describe(RESTRICTIONS.CHANGEOVER_ONLY)}`,
    });
  }
  if (has(RESTRICTIONS.NO_PLATTER) && !venue.booth.changeoverCapable) {
    problems.push({ rule: 'platter', detail: `${venue.code} can only run from a platter` });
  }
  if (has(RESTRICTIONS.ARCHIVE_PROJECTIONIST_ONLY) && !venue.booth.projectionistOnStaff) {
    problems.push({ rule: 'projectionist', detail: `${venue.code} keeps no projectionist on staff` });
  }
  if (has(RESTRICTIONS.NITRATE_BOOTH) && !venue.booth.nitrateCertified) {
    problems.push({ rule: 'nitrate-booth', detail: `${venue.code} holds no nitrate certificate` });
  }
  if (blocksPublicExhibition(element.handlingRestrictions)) {
    problems.push({ rule: 'exhibition', detail: 'this element is for study and duplication only' });
  }
  return problems;
}

const CHECKS = Object.freeze([gaugeCheck, soundCheck, speedCheck, nitrateCheck, reelCheck]);

function boothCompatibility(element, venue) {
  const problems = CHECKS.map((check) => check(element, venue))
    .filter(Boolean)
    .concat(restrictionChecks(element, venue));

  return {
    compatible: problems.length === 0,
    problems,
    playableSound: playableSoundFormat(element.soundFormat, venue.booth.soundFormats),
  };
}

/** The venues out of a list that could actually run this print. */
function venuesThatCanRun(element, venues) {
  return venues.filter((venue) => boothCompatibility(element, venue).compatible);
}

/** The elements out of a list that this booth could actually run. */
function elementsRunnableAt(elements, venue) {
  return elements.filter((element) => boothCompatibility(element, venue).compatible);
}

module.exports = {
  boothCompatibility,
  venuesThatCanRun,
  elementsRunnableAt,
  gaugeCheck,
  soundCheck,
  speedCheck,
  nitrateCheck,
  reelCheck,
  restrictionChecks,
};
