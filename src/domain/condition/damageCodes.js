'use strict';

const { RESTRICTIONS } = require('../handling');

/**
 * The inspection vocabulary. An inspector writes a footage mark, a reel and one
 * of these codes, and nothing else counts: free text findings cannot be graded
 * and were how two prints went out with unrecorded perforation damage.
 */

const SEVERITIES = Object.freeze(['minor', 'moderate', 'severe']);

const SEVERITY_MULTIPLIER = Object.freeze({ minor: 1, moderate: 3, severe: 9 });

const AREAS = Object.freeze(['perforation', 'splice', 'emulsion', 'base', 'edge', 'chemical', 'sound']);

/**
 * weight is the damage a single moderate finding of this kind contributes.
 * A perforation tear tears further every time the print runs, so it is scored
 * far above a base scratch that only looks bad.
 */
const DAMAGE_CODES = Object.freeze({
  'PERF-TEAR': { area: 'perforation', weight: 12, label: 'torn perforation' },
  'PERF-WEAR': { area: 'perforation', weight: 5, label: 'worn perforations' },
  'PERF-STRETCH': { area: 'perforation', weight: 8, label: 'stretched perforations' },
  'SPLICE-TAPE': { area: 'splice', weight: 3, label: 'tape splice' },
  'SPLICE-WEAK': { area: 'splice', weight: 9, label: 'weak cement splice' },
  'SPLICE-FRAME-LOSS': { area: 'splice', weight: 4, label: 'splice with frames missing' },
  'SCRATCH-BASE': { area: 'base', weight: 2, label: 'base side scratch' },
  'SCRATCH-EMULSION': { area: 'emulsion', weight: 6, label: 'emulsion side scratch' },
  'TRAM-LINES': { area: 'base', weight: 5, label: 'continuous tram lines' },
  'EDGE-WAVE': { area: 'edge', weight: 7, label: 'edge wave' },
  'BUCKLE': { area: 'base', weight: 8, label: 'buckled section' },
  'BRITTLE': { area: 'base', weight: 10, label: 'brittle stock' },
  'VINEGAR': { area: 'chemical', weight: 11, label: 'vinegar odour' },
  'MOULD': { area: 'chemical', weight: 9, label: 'mould growth' },
  'WATER-STAIN': { area: 'chemical', weight: 4, label: 'water staining' },
  'COLOUR-FADE': { area: 'emulsion', weight: 3, label: 'dye fading' },
  'SOUND-SCRATCH': { area: 'sound', weight: 6, label: 'scratched sound track' },
  'SOUND-OXIDE-LOSS': { area: 'sound', weight: 8, label: 'magnetic oxide shedding' },
});

const ALL_CODES = Object.freeze(Object.keys(DAMAGE_CODES).sort());

/** What a severe finding of each kind forces on to the element for good. */
const SEVERE_RESTRICTIONS = Object.freeze({
  'PERF-TEAR': [RESTRICTIONS.NO_PLATTER, RESTRICTIONS.ARCHIVE_PROJECTIONIST_ONLY],
  'PERF-WEAR': [RESTRICTIONS.NO_PLATTER],
  'PERF-STRETCH': [RESTRICTIONS.NO_PLATTER, RESTRICTIONS.REDUCED_SPEED],
  'SPLICE-WEAK': [RESTRICTIONS.CHANGEOVER_ONLY, RESTRICTIONS.ARCHIVE_PROJECTIONIST_ONLY],
  'EDGE-WAVE': [RESTRICTIONS.NO_PLATTER],
  BUCKLE: [RESTRICTIONS.NO_PLATTER, RESTRICTIONS.REDUCED_SPEED],
  BRITTLE: [RESTRICTIONS.NO_PLATTER, RESTRICTIONS.ARCHIVE_PROJECTIONIST_ONLY, RESTRICTIONS.HAND_CARRY_ONLY],
  VINEGAR: [RESTRICTIONS.NO_TRAVEL_ABROAD],
  MOULD: [RESTRICTIONS.ARCHIVE_PROJECTIONIST_ONLY],
});

function isDamageCode(value) {
  return Object.prototype.hasOwnProperty.call(DAMAGE_CODES, value);
}

function isSeverity(value) {
  return SEVERITIES.includes(value);
}

function describeCode(code) {
  return DAMAGE_CODES[code] || null;
}

/** The damage one finding contributes, before it is spread over the footage. */
function scoreFinding({ code, severity }) {
  const definition = DAMAGE_CODES[code];
  if (!definition) throw new TypeError(`${code} is not an inspection code`);
  if (!isSeverity(severity)) throw new TypeError(`${severity} is not a severity`);
  return definition.weight * SEVERITY_MULTIPLIER[severity];
}

function restrictionsForFinding({ code, severity }) {
  if (severity !== 'severe') return [];
  return SEVERE_RESTRICTIONS[code] || [];
}

/** Groups a report's findings by the part of the print they sit in. */
function summariseByArea(findings) {
  const summary = Object.fromEntries(AREAS.map((area) => [area, 0]));
  for (const finding of findings) {
    const definition = DAMAGE_CODES[finding.code];
    if (!definition) continue;
    summary[definition.area] += scoreFinding(finding);
  }
  return summary;
}

module.exports = {
  SEVERITIES,
  SEVERITY_MULTIPLIER,
  AREAS,
  DAMAGE_CODES,
  ALL_CODES,
  SEVERE_RESTRICTIONS,
  isDamageCode,
  isSeverity,
  describeCode,
  scoreFinding,
  restrictionsForFinding,
  summariseByArea,
};
