'use strict';

const { Money, money, ROUNDING } = require('../../lib/money');
const { RuleRefusedError } = require('../../lib/errors');
const { assertTermsComplete, describeTerms, isPresent } = require('./terms');

/**
 * What the licensor is owed for one screening.
 *
 * Every step is recorded. Distributors query statements line by line and the
 * answer "the system worked it out" has never once ended a query, so the
 * workings come back with the number.
 */

function step(workings, label, amount) {
  workings.push({ label, amountMinor: amount.amountMinor, currency: amount.currency });
  return amount;
}

function assertSameCurrency(terms, boxOffice) {
  if (terms.currency !== boxOffice.currency) {
    throw new RuleRefusedError('the box office and the licence are in different currencies', {
      terms: terms.currency,
      boxOffice: boxOffice.currency,
    });
  }
}

/** The figure a percentage is taken of, which is not always the gross. */
function shareableBase(terms, boxOffice, workings) {
  const gross = money(boxOffice.grossMinor, boxOffice.currency);
  step(workings, 'box office gross', gross);

  if (!terms.houseNutDeductible) return gross;

  const nut = money(boxOffice.houseNutMinor || 0, boxOffice.currency);
  step(workings, 'house nut deducted', nut);
  const after = gross.minus(nut);
  return after.isNegative() ? Money.zero(boxOffice.currency) : after;
}

function computeRoyalty({ terms, boxOffice, rounding = ROUNDING.HALF_UP }) {
  assertTermsComplete(terms);
  assertSameCurrency(terms, boxOffice);

  const workings = [];
  const currency = terms.currency;
  const base = shareableBase(terms, boxOffice, workings);
  if (terms.houseNutDeductible) step(workings, 'shareable base', base);

  const percentageShare = terms.percentageBps
    ? base.timesBasisPoints(terms.percentageBps, rounding)
    : null;
  if (percentageShare) {
    step(workings, `${terms.percentageBps / 100}% share`, percentageShare);
  }

  const flatFee = isPresent(terms.flatFeeMinor) ? money(terms.flatFeeMinor, currency) : null;
  if (flatFee) step(workings, 'flat fee', flatFee);

  let amount;
  if (terms.kind === 'flat') {
    amount = flatFee;
  } else if (terms.kind === 'percentage' || terms.kind === 'split-after-nut') {
    amount = percentageShare;
  } else {
    amount = Money.max(flatFee, percentageShare);
    step(workings, 'greater of the two', amount);
  }

  if (isPresent(terms.minimumGuaranteeMinor)) {
    const guarantee = money(terms.minimumGuaranteeMinor, currency);
    if (guarantee.compare(amount) > 0) {
      amount = step(workings, 'minimum guarantee applied', guarantee);
    }
  }

  if (isPresent(terms.capMinor)) {
    const cap = money(terms.capMinor, currency);
    if (amount.compare(cap) > 0) {
      amount = step(workings, 'cap applied', cap);
    }
  }

  step(workings, 'payable', amount);

  const gross = money(boxOffice.grossMinor, currency);
  return {
    amountMinor: amount.amountMinor,
    currency,
    basis: describeTerms(terms),
    workings,
    exceedsGross: amount.compare(gross) > 0,
    venueKeepsMinor: gross.minus(amount).amountMinor,
  };
}

/** Adds up a run of screenings, refusing to mix currencies on one statement. */
function totalFor(lines, currency) {
  const wrong = lines.find((line) => line.currency !== currency);
  if (wrong) {
    throw new RuleRefusedError('a statement cannot mix currencies', {
      expected: currency,
      found: wrong.currency,
    });
  }
  return Money.sum(
    lines.map((line) => money(line.amountMinor, line.currency)),
    currency,
  ).amountMinor;
}

module.exports = { computeRoyalty, totalFor, shareableBase };
