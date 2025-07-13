'use strict';

const { RuleRefusedError } = require('../../lib/errors');
const { exponentFor } = require('../../lib/money');

/**
 * What a set of licence terms has to say to be a deal. The shape a kind needs
 * is not a field list, which is why this is a rule and not a schema: a
 * percentage deal without a rate is as broken as a flat deal without a fee.
 */

const KINDS = Object.freeze(['flat', 'percentage', 'greater-of', 'split-after-nut']);

const NEEDS_FEE = Object.freeze(['flat', 'greater-of']);
const NEEDS_RATE = Object.freeze(['percentage', 'greater-of', 'split-after-nut']);

function problemsWith(terms) {
  const problems = [];

  if (!KINDS.includes(terms.kind)) {
    return [`${terms.kind} is not a kind of deal this desk settles`];
  }
  exponentFor(terms.currency);

  if (NEEDS_FEE.includes(terms.kind) && !isPresent(terms.flatFeeMinor)) {
    problems.push('a flat fee is needed');
  }
  if (NEEDS_RATE.includes(terms.kind) && !terms.percentageBps) {
    problems.push('a percentage in basis points is needed');
  }
  if (terms.kind === 'split-after-nut' && !terms.houseNutDeductible) {
    problems.push('a split after the nut has to deduct the nut');
  }
  if (terms.kind === 'flat' && terms.percentageBps) {
    problems.push('a flat deal cannot also carry a percentage');
  }
  if (isPresent(terms.capMinor) && isPresent(terms.flatFeeMinor) && terms.flatFeeMinor > terms.capMinor) {
    problems.push('the flat fee is already above the cap');
  }
  if (
    isPresent(terms.capMinor) &&
    isPresent(terms.minimumGuaranteeMinor) &&
    terms.minimumGuaranteeMinor > terms.capMinor
  ) {
    problems.push('the minimum guarantee is above the cap');
  }
  return problems;
}

function isPresent(value) {
  return value !== undefined && value !== null;
}

function assertTermsComplete(terms) {
  const problems = problemsWith(terms);
  if (problems.length > 0) {
    throw new RuleRefusedError(`these ${terms.kind} terms are incomplete`, { problems });
  }
  return terms;
}

/** One line a booking desk can read down the phone. */
function describeTerms(terms) {
  const rate = terms.percentageBps ? `${terms.percentageBps / 100}%` : null;
  const fee = isPresent(terms.flatFeeMinor) ? `${terms.flatFeeMinor} ${terms.currency}` : null;

  const base = {
    flat: () => `flat ${fee}`,
    percentage: () => `${rate} of the gross`,
    'greater-of': () => `the greater of ${fee} and ${rate}`,
    'split-after-nut': () => `${rate} of the gross after the house nut`,
  }[terms.kind]();

  const extras = [];
  if (terms.houseNutDeductible && terms.kind !== 'split-after-nut') extras.push('after the nut');
  if (isPresent(terms.minimumGuaranteeMinor)) {
    extras.push(`minimum ${terms.minimumGuaranteeMinor} ${terms.currency}`);
  }
  if (isPresent(terms.capMinor)) extras.push(`capped at ${terms.capMinor} ${terms.currency}`);

  return extras.length > 0 ? `${base}, ${extras.join(', ')}` : base;
}

module.exports = { KINDS, problemsWith, assertTermsComplete, describeTerms, isPresent };
