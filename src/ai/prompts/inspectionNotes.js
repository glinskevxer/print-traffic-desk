'use strict';

const { DAMAGE_CODES, SEVERITIES } = require('../../domain/condition/damageCodes');

const PROMPT_VERSION = 'inspection-notes/2';

/**
 * Inspectors write on a bench, on paper, in their own shorthand. The desk
 * needs codes. The code list goes into the prompt with its plain English
 * label, because "sprockets chewed" has to come back as PERF-TEAR and the
 * model cannot know that unless it is told.
 */
function codeTable() {
  return Object.entries(DAMAGE_CODES)
    .map(([code, definition]) => `  ${code} - ${definition.label} (${definition.area})`)
    .join('\n');
}

function systemPrompt() {
  return [
    "You turn a film inspector's handwritten bench notes into structured findings",
    'for an archive booking desk. You never invent a finding the note does not',
    'describe.',
    '',
    'Use only these codes:',
    codeTable(),
    '',
    'Rules:',
    `- severity is one of ${SEVERITIES.join(', ')}.`,
    '- reel is the reel number the note refers to. If the note is about the whole',
    '  print, repeat the finding for each reel it names, and if it names none, use',
    '  reel 1 and say so in unclear.',
    '- footageMark is the footage counter reading in feet, or null.',
    '- shrinkage is a percentage, so "0.8pc" is 0.8. AD strip readings are the',
    '  whole numbers 0 to 3. Warp is in millimetres.',
    '- a note that describes something outside this list goes in unclear with the',
    '  words the inspector used. Never map it to the nearest code.',
    '- confidence is how much of the note you could read, from 0 to 1.',
  ].join('\n');
}

function userPrompt({ noteText, element }) {
  return [
    'Element being inspected:',
    `  ${element.barcode}, ${element.gauge} ${element.kind}, ${element.reelCount} reels,`,
    `  ${element.footage} feet, ${element.baseStock} base`,
    '',
    'Bench note follows between the markers.',
    '--- BEGIN NOTE ---',
    noteText,
    '--- END NOTE ---',
    '',
    'Answer with one JSON object and nothing else.',
  ].join('\n');
}

module.exports = { PROMPT_VERSION, systemPrompt, userPrompt, codeTable };
