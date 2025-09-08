'use strict';

/**
 * What a call costs, in hundredths of a US cent per token, so the ledger stays
 * in whole numbers. Prices are per million tokens as published, converted once
 * here rather than in every caller.
 *
 * These are list prices at the time each model was added and they are only
 * used to keep the desk's own spend in view. The invoice is the invoice.
 */

const PER_MILLION_USD_CENTS = Object.freeze({
  'gpt-4o-mini': { input: 15, output: 60 },
  'gpt-4o': { input: 250, output: 1000 },
  'gpt-4-turbo': { input: 1000, output: 3000 },
  'gpt-3.5-turbo': { input: 50, output: 150 },
});

const UNKNOWN_MODEL_RATE = Object.freeze({ input: 250, output: 1000 });

/** A dated model name like gpt-4o-mini-2024-07-18 is priced as its family. */
function familyOf(model) {
  const known = Object.keys(PER_MILLION_USD_CENTS)
    .filter((name) => String(model).startsWith(name))
    .sort((a, b) => b.length - a.length);
  return known[0] || null;
}

function rateFor(model) {
  const family = familyOf(model);
  return family ? PER_MILLION_USD_CENTS[family] : UNKNOWN_MODEL_RATE;
}

/**
 * Cost in hundredths of a cent. A single extraction is well under a cent, and
 * rounding it to a cent per call hid a month of spend behind a column of zeros.
 */
function costOf({ model, promptTokens = 0, completionTokens = 0 }) {
  const rate = rateFor(model);
  const input = Math.round((promptTokens * rate.input * 100) / 1000000);
  const output = Math.round((completionTokens * rate.output * 100) / 1000000);
  return { inputHundredthCents: input, outputHundredthCents: output, totalHundredthCents: input + output };
}

function isKnownModel(model) {
  return familyOf(model) !== null;
}

/** For a report: hundredths of a cent as a decimal string in dollars. */
function toDollars(hundredthCents) {
  const sign = hundredthCents < 0 ? '-' : '';
  const digits = String(Math.abs(hundredthCents)).padStart(5, '0');
  return `${sign}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

module.exports = {
  PER_MILLION_USD_CENTS,
  UNKNOWN_MODEL_RATE,
  familyOf,
  rateFor,
  costOf,
  isKnownModel,
  toDollars,
};
