'use strict';

const crypto = require('crypto');
const { licenceTermsSchema } = require('./schemas');
const { PROMPT_VERSION, systemPrompt, userPrompt } = require('./prompts/licenceTerms');
const { ValidationError } = require('../lib/errors');

/**
 * Reads a licence letter into a draft rights window.
 *
 * The result is never a live licence. A model that has misread a date by a
 * year and a programmer who trusts it is how a title gets shown outside its
 * window, so everything here lands as a draft for somebody to activate.
 */

function fingerprint({ contractText, model, promptVersion }) {
  return crypto
    .createHash('sha256')
    .update(`${promptVersion} ${model} ${contractText.trim()}`)
    .digest('hex');
}

function assertReadable(contractText) {
  const text = String(contractText || '').trim();
  if (text.length < 40) {
    throw new ValidationError('there is not enough of a letter here to read', [
      { key: 'contractText', problem: 'shorter than forty characters' },
    ]);
  }
  if (text.length > 60000) {
    throw new ValidationError('that letter is longer than the desk sends in one go', [
      { key: 'contractText', problem: 'longer than sixty thousand characters' },
    ]);
  }
  return text;
}

async function extractLicenceTerms({
  client,
  contractText,
  title,
  rightsHolder,
  defaultCurrency = 'GBP',
  onRetry = null,
}) {
  const text = assertReadable(contractText);

  const answer = await client.completeJson({
    system: systemPrompt(),
    user: userPrompt({ contractText: text, title, rightsHolder, defaultCurrency }),
    maxTokens: 2000,
    onRetry,
  });

  const parsed = licenceTermsSchema.safeParse(answer.data);
  if (!parsed.success) {
    throw new ValidationError(
      'the model answered with terms this desk cannot use',
      parsed.error.issues.map((issue) => ({
        key: issue.path.join('.') || 'answer',
        problem: issue.message,
      })),
    );
  }

  return {
    extracted: parsed.data,
    // The cache key uses the model that was asked for, not the dated build the
    // API answered with: two calls a fortnight apart get the same key and the
    // second one costs nothing.
    fingerprint: fingerprint({
      contractText: text,
      model: client.model,
      promptVersion: PROMPT_VERSION,
    }),
    promptVersion: PROMPT_VERSION,
    requestedModel: client.model,
    model: answer.model,
    usage: answer.usage,
    elapsedMs: answer.elapsedMs,
  };
}

/**
 * Turns a validated extraction into the payload the rights service takes.
 * Nulls the model used to say "not stated" are dropped rather than written as
 * nulls, so a window created from a letter looks like one typed in by hand.
 */
function toWindowInput(extracted, { titleId, rightsHolderId }) {
  const terms = { kind: extracted.terms.kind, currency: extracted.terms.currency };
  for (const field of ['flatFeeMinor', 'percentageBps', 'minimumGuaranteeMinor', 'capMinor']) {
    if (extracted.terms[field] !== null) terms[field] = extracted.terms[field];
  }
  terms.houseNutDeductible = extracted.terms.houseNutDeductible;

  const input = {
    titleId,
    rightsHolderId,
    territory: extracted.territory,
    exhibitionTypes: extracted.exhibitionTypes,
    startsOn: extracted.startsOn,
    endsOn: extracted.endsOn,
    blackouts: extracted.blackouts.map((blackout) => ({
      startsOn: blackout.startsOn,
      endsOn: blackout.endsOn,
      ...(blackout.reason ? { reason: blackout.reason } : {}),
    })),
    terms,
  };

  if (extracted.holdbackUntil) input.holdbackUntil = extracted.holdbackUntil;
  if (extracted.maxScreenings) input.maxScreenings = extracted.maxScreenings;
  if (extracted.maxScreeningsPerVenue) {
    input.maxScreeningsPerVenue = extracted.maxScreeningsPerVenue;
  }
  return input;
}

module.exports = {
  extractLicenceTerms,
  toWindowInput,
  fingerprint,
  assertReadable,
  PROMPT_VERSION,
};
