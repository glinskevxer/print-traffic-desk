'use strict';

const { RuleRefusedError } = require('../../lib/errors');
const { isCommitted } = require('./status');

/**
 * Taking a print out of the collection for good.
 *
 * An archive does not throw film away casually and it never throws it away
 * without writing down what happened to it, so a retirement carries a reason
 * from a closed list and, where the print physically went, a disposal record.
 * "Retired" with no disposal is a print somebody has to go and look for.
 */

const REASONS = Object.freeze({
  SHRUNK: 'shrunk-beyond-use',
  DECAYED: 'chemically-decayed',
  LOST: 'lost-in-transit',
  DESTROYED: 'destroyed',
  RETURNED: 'returned-to-owner',
  DEACCESSIONED: 'deaccessioned',
  SUPERSEDED: 'superseded-by-restoration',
});

const ALL_REASONS = Object.freeze(Object.values(REASONS));

/**
 * Which reasons need somebody to say where the film physically went. A print
 * that was lost has no disposal, by definition; one that was deaccessioned
 * went somewhere and the archive has to be able to say where.
 */
const NEEDS_DISPOSAL = Object.freeze([REASONS.RETURNED, REASONS.DEACCESSIONED, REASONS.DESTROYED]);

const DISPOSAL_METHODS = Object.freeze([
  'returned',
  'transferred',
  'sold',
  'scrapped',
  'incinerated',
  'buried-in-store',
]);

function isReason(value) {
  return ALL_REASONS.includes(value);
}

function needsDisposal(reason) {
  return NEEDS_DISPOSAL.includes(reason);
}

/**
 * Everything wrong with a retirement, in one answer. A person filling this in
 * is at a bench with the can open, and telling them one problem at a time
 * means three trips back to the terminal.
 */
function problemsWith({ element, reason, disposal = null, retiredOn }) {
  const problems = [];

  if (!isReason(reason)) {
    return [`${reason} is not a reason this archive retires a print for`];
  }
  if (element.status === 'retired') problems.push('that print is already retired');
  if (isCommitted(element.status)) {
    problems.push('that print is out, bring it home before retiring it');
  }
  if (!retiredOn) problems.push('a retirement needs the date it happened');

  if (needsDisposal(reason)) {
    if (!disposal) {
      problems.push(`${reason} needs a disposal saying where the film went`);
    } else {
      if (!DISPOSAL_METHODS.includes(disposal.method)) {
        problems.push(`${disposal.method} is not a way this archive disposes of film`);
      }
      if (!disposal.witness) problems.push('a disposal needs the person who witnessed it');
      if (disposal.method === 'transferred' && !disposal.to) {
        problems.push('a transfer needs to say who it went to');
      }
    }
  } else if (disposal) {
    problems.push(`${reason} does not take a disposal record`);
  }

  return problems;
}

function assertRetirable(input) {
  const problems = problemsWith(input);
  if (problems.length > 0) {
    throw new RuleRefusedError('that print cannot be retired like that', { problems });
  }
  return input;
}

/** One line for the provenance, which is what somebody reads in ten years. */
function describeRetirement({ reason, disposal, retiredOn }) {
  const where = disposal
    ? `, ${disposal.method}${disposal.to ? ` to ${disposal.to}` : ''}, witnessed by ${disposal.witness}`
    : '';
  return `retired on ${retiredOn}: ${reason}${where}`;
}

module.exports = {
  REASONS,
  ALL_REASONS,
  NEEDS_DISPOSAL,
  DISPOSAL_METHODS,
  isReason,
  needsDisposal,
  problemsWith,
  assertRetirable,
  describeRetirement,
};
