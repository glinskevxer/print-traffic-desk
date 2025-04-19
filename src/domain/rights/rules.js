'use strict';

const { covers } = require('./territories');
const { isWithin, isBefore, isOnOrAfter } = require('../../lib/dates');

/**
 * Every clearance question is one of these. A rule reads a window and a
 * request and says yes or no with a sentence a programmer can read out to a
 * venue on the phone. No rule reads the database and no rule writes anything,
 * which is what makes the whole engine testable from a table.
 */

function pass(code, detail) {
  return { code, ok: true, detail };
}

function fail(code, detail) {
  return { code, ok: false, detail };
}

/** The licence has to be live. A draft is a negotiation, not a right. */
function statusRule(window) {
  if (window.status === 'active') return pass('status', 'the licence is active');
  if (window.status === 'draft') {
    return fail('status', 'this licence is still a draft and grants nothing');
  }
  if (window.status === 'suspended') {
    return fail('status', `this licence is suspended: ${window.suspendedReason || 'no reason given'}`);
  }
  return fail('status', 'this licence has expired');
}

/** The screening date, read in the venue's own calendar, inside the window. */
function windowRule(window, request) {
  if (isWithin(request.localDate, window.startsOn, window.endsOn)) {
    return pass('window', `${request.localDate} is inside ${window.startsOn} to ${window.endsOn}`);
  }
  if (isBefore(request.localDate, window.startsOn)) {
    return fail('window', `the licence does not open until ${window.startsOn}`);
  }
  return fail('window', `the licence closed on ${window.endsOn}`);
}

/**
 * A holdback keeps a title off repertory screens while it is still in its
 * first run, even though the licence itself has started.
 */
function holdbackRule(window, request) {
  if (!window.holdbackUntil) return pass('holdback', 'no holdback on this licence');
  if (isOnOrAfter(request.localDate, window.holdbackUntil)) {
    return pass('holdback', `the holdback lifted on ${window.holdbackUntil}`);
  }
  return fail('holdback', `held back until ${window.holdbackUntil}`);
}

function territoryRule(window, request) {
  if (covers(window.territory, request.country)) {
    return pass('territory', `${window.territory} covers ${request.country}`);
  }
  return fail('territory', `${window.territory} does not reach ${request.country}`);
}

function exhibitionTypeRule(window, request) {
  if (window.exhibitionTypes.includes(request.exhibitionType)) {
    return pass('exhibition-type', `${request.exhibitionType} exhibition is licensed`);
  }
  return fail(
    'exhibition-type',
    `this licence covers ${window.exhibitionTypes.join(', ')}, not ${request.exhibitionType}`,
  );
}

/** The total number of screenings the whole licence allows. */
function screeningCapRule(window, request) {
  if (window.maxScreenings === null || window.maxScreenings === undefined) {
    return pass('screening-cap', 'this licence is not capped');
  }
  const wanted = request.screenings || 1;
  const remaining = window.maxScreenings - window.screeningsUsed;
  if (remaining >= wanted) {
    return pass('screening-cap', `${remaining} of ${window.maxScreenings} screenings left`);
  }
  return fail(
    'screening-cap',
    `only ${Math.max(0, remaining)} of ${window.maxScreenings} screenings left, ${wanted} asked for`,
  );
}

/** Some licences cap what any one house may take out of a shared allowance. */
function venueCapRule(window, request) {
  if (!window.maxScreeningsPerVenue) return pass('venue-cap', 'no per house cap');
  const alreadyHere = request.screeningsAtVenue || 0;
  const wanted = request.screenings || 1;
  if (alreadyHere + wanted <= window.maxScreeningsPerVenue) {
    return pass(
      'venue-cap',
      `${alreadyHere + wanted} of ${window.maxScreeningsPerVenue} allowed at this house`,
    );
  }
  return fail(
    'venue-cap',
    `this house has taken ${alreadyHere} of ${window.maxScreeningsPerVenue} screenings`,
  );
}

function blackoutRule(window, request) {
  const hit = (window.blackouts || []).find((blackout) =>
    isWithin(request.localDate, blackout.startsOn, blackout.endsOn),
  );
  if (!hit) return pass('blackout', 'the date is not blacked out');
  return fail(
    'blackout',
    `blacked out ${hit.startsOn} to ${hit.endsOn}${hit.reason ? ` for ${hit.reason}` : ''}`,
  );
}

/**
 * The rules that need nothing but the window and the request. Order matters
 * only for reading: every one of them is evaluated so a refusal names every
 * reason at once rather than making a venue guess twice.
 */
const SELF_CONTAINED_RULES = Object.freeze([
  statusRule,
  windowRule,
  holdbackRule,
  territoryRule,
  exhibitionTypeRule,
  screeningCapRule,
  venueCapRule,
  blackoutRule,
]);

function evaluateSelfContained(window, request) {
  return SELF_CONTAINED_RULES.map((rule) => rule(window, request));
}

module.exports = {
  pass,
  fail,
  statusRule,
  windowRule,
  holdbackRule,
  territoryRule,
  exhibitionTypeRule,
  screeningCapRule,
  venueCapRule,
  blackoutRule,
  SELF_CONTAINED_RULES,
  evaluateSelfContained,
};
