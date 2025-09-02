'use strict';

const { REGION_CODES } = require('../../domain/rights/territories');
const { EXHIBITION_TYPES, TERM_KINDS } = require('../../models/rightsWindow');

const PROMPT_VERSION = 'licence-terms/3';

/**
 * The vocabulary is written into the prompt from the same constants the
 * validator uses, so the two cannot drift. When a new term kind is added the
 * model is told about it in the same commit that starts accepting it.
 */
function systemPrompt() {
  return [
    'You read theatrical licence letters for a repertory film booking desk and',
    'return what they actually say as JSON. You never infer a term that is not',
    'written down.',
    '',
    'Rules:',
    `- territory is one ISO 3166-1 alpha-2 code or one of ${REGION_CODES.join(', ')}.`,
    `- exhibitionTypes is a non empty subset of ${EXHIBITION_TYPES.join(', ')}.`,
    '- dates are YYYY-MM-DD. If a letter gives a season rather than dates, put the',
    '  season in unclear and leave the dates as the ones it does give.',
    `- terms.kind is one of ${TERM_KINDS.join(', ')}.`,
    '- money is whole minor units: 250.00 GBP is 25000, not 250.',
    '- percentages are basis points: 35% is 3500.',
    '- exclusivity.scope is none unless the letter grants exclusivity, and then it',
    '  names the house in heldByVenueCode.',
    '- confidence is your own reading of how much of this was stated plainly,',
    '  from 0 to 1. A letter you had to interpret is below 0.7.',
    '- anything you could not read goes in unclear as { field, why }. Never guess',
    '  a number to fill a field.',
  ].join('\n');
}

/**
 * The context block tells the model what the desk already knows, so it does
 * not have to find the title or the distributor in the letter.
 */
function userPrompt({ contractText, title, rightsHolder, defaultCurrency }) {
  return [
    'Title being licensed:',
    `  ${title.title} (${title.year}), slug ${title.slug}`,
    'Licensor:',
    `  ${rightsHolder.name}, paid in ${rightsHolder.remittanceCurrency}`,
    `Desk default currency: ${defaultCurrency}`,
    '',
    'Licence letter follows between the markers.',
    '--- BEGIN LETTER ---',
    contractText,
    '--- END LETTER ---',
    '',
    'Answer with one JSON object and nothing else.',
  ].join('\n');
}

module.exports = { PROMPT_VERSION, systemPrompt, userPrompt };
