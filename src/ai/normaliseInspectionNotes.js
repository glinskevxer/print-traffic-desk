'use strict';

const crypto = require('crypto');
const { inspectionNotesSchema } = require('./schemas');
const { PROMPT_VERSION, systemPrompt, userPrompt } = require('./prompts/inspectionNotes');
const { ValidationError } = require('../lib/errors');

/**
 * Turns a bench note into findings the grader can score. The result is offered
 * to an inspector to file, never filed on its own: a misread shrinkage figure
 * quarantines a print that is fine, or worse, releases one that is not.
 */

function fingerprint({ noteText, model, promptVersion }) {
  return crypto
    .createHash('sha256')
    .update(`${promptVersion} ${model} ${noteText.trim()}`)
    .digest('hex');
}

function assertReadable(noteText) {
  const text = String(noteText || '').trim();
  if (text.length < 10) {
    throw new ValidationError('there is not enough of a note here to read', [
      { key: 'noteText', problem: 'shorter than ten characters' },
    ]);
  }
  if (text.length > 20000) {
    throw new ValidationError('that note is longer than a bench note ever is', [
      { key: 'noteText', problem: 'longer than twenty thousand characters' },
    ]);
  }
  return text;
}

/** Findings on reels the print does not have are dropped, not corrected. */
function dropImpossibleReels(findings, reelCount) {
  const kept = [];
  const dropped = [];
  for (const finding of findings) {
    if (finding.reel <= reelCount) kept.push(finding);
    else dropped.push(finding);
  }
  return { kept, dropped };
}

async function normaliseInspectionNotes({ client, noteText, element, onRetry = null }) {
  const text = assertReadable(noteText);

  const answer = await client.completeJson({
    system: systemPrompt(),
    user: userPrompt({ noteText: text, element }),
    maxTokens: 2000,
    onRetry,
  });

  const parsed = inspectionNotesSchema.safeParse(answer.data);
  if (!parsed.success) {
    throw new ValidationError(
      'the model answered with findings this desk cannot use',
      parsed.error.issues.map((issue) => ({
        key: issue.path.join('.') || 'answer',
        problem: issue.message,
      })),
    );
  }

  const { kept, dropped } = dropImpossibleReels(parsed.data.findings, element.reelCount);
  const unclear = [
    ...parsed.data.unclear,
    ...dropped.map((finding) => ({
      field: 'findings',
      why: `a ${finding.code} was reported on reel ${finding.reel} of a ${element.reelCount} reel print`,
    })),
  ];

  return {
    extracted: { ...parsed.data, findings: kept, unclear },
    fingerprint: fingerprint({
      noteText: text,
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

/** Turns an extraction into what the inspection service takes to file. */
function toInspectionInput(extracted, { inspector, kind = 'routine' }) {
  const measurements = {};
  for (const field of ['shrinkagePercent', 'adStripLevel', 'warpMillimetres']) {
    if (extracted.measurements[field] !== null) {
      measurements[field] = extracted.measurements[field];
    }
  }

  return {
    inspector,
    kind,
    source: 'extracted',
    findings: extracted.findings.map((finding) => ({
      reel: finding.reel,
      code: finding.code,
      severity: finding.severity,
      ...(finding.footageMark !== null ? { footageMark: finding.footageMark } : {}),
      ...(finding.note ? { note: finding.note } : {}),
    })),
    measurements,
  };
}

module.exports = {
  normaliseInspectionNotes,
  toInspectionInput,
  dropImpossibleReels,
  fingerprint,
  assertReadable,
  PROMPT_VERSION,
};
