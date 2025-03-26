'use strict';

const { RESTRICTIONS, mergeRestrictions } = require('../handling');
const {
  scoreFinding,
  restrictionsForFinding,
  summariseByArea,
  describeCode,
} = require('./damageCodes');

/**
 * Two things decide what a print may do, and they are not the same thing.
 *
 * The findings say how beaten up it is, spread over its own length so a short
 * reel with four tears is not flattered by a feature's footage. The
 * measurements say what the stock itself is doing, and those override the
 * findings: a print with no visible damage and 1.6% shrinkage still cannot go
 * through a gate.
 */

const GRADES = Object.freeze(['A', 'B', 'C', 'D']);

const DENSITY_BANDS = Object.freeze([
  { grade: 'A', below: 20 },
  { grade: 'B', below: 60 },
  { grade: 'C', below: 140 },
  { grade: 'D', below: Infinity },
]);

const SHRINKAGE = Object.freeze({ quarantineAt: 1.5, capCAt: 1.0, capBAt: 0.7 });
const AD_STRIP = Object.freeze({ quarantineAt: 2, capCAt: 1 });
const WARP_MM = Object.freeze({ quarantineAt: 5, capCAt: 3 });

function worse(a, b) {
  return GRADES.indexOf(a) >= GRADES.indexOf(b) ? a : b;
}

/** Damage score for every thousand feet of print, rounded to one decimal. */
function damageDensity(findings, footage) {
  if (!Number.isFinite(footage) || footage <= 0) {
    throw new TypeError('footage must be a positive number of feet');
  }
  const total = findings.reduce((sum, finding) => sum + scoreFinding(finding), 0);
  return Math.round((total / footage) * 1000 * 10) / 10;
}

function gradeFromDensity(density) {
  return DENSITY_BANDS.find((band) => density < band.below).grade;
}

/**
 * Reads the physical measurements. Returns the worst grade they allow, the
 * restrictions they force, and whether the element has to come off the shelf
 * altogether.
 */
function readMeasurements(measurements = {}) {
  const { shrinkagePercent = 0, adStripLevel = 0, warpMillimetres = 0 } = measurements;
  const outcome = { cap: 'A', restrictions: [], quarantine: false, reasons: [] };

  const capAt = (grade, reason) => {
    outcome.cap = worse(outcome.cap, grade);
    outcome.reasons.push(reason);
  };

  if (shrinkagePercent >= SHRINKAGE.quarantineAt) {
    outcome.quarantine = true;
    capAt('D', `shrinkage ${shrinkagePercent}% is past the ${SHRINKAGE.quarantineAt}% limit`);
  } else if (shrinkagePercent >= SHRINKAGE.capCAt) {
    capAt('C', `shrinkage ${shrinkagePercent}% needs a shrinkage gate`);
    outcome.restrictions.push(RESTRICTIONS.NO_PLATTER, RESTRICTIONS.REDUCED_SPEED);
  } else if (shrinkagePercent >= SHRINKAGE.capBAt) {
    capAt('B', `shrinkage ${shrinkagePercent}% is measurable`);
    outcome.restrictions.push(RESTRICTIONS.NO_PLATTER);
  }

  if (adStripLevel >= AD_STRIP.quarantineAt) {
    outcome.quarantine = true;
    capAt('D', `AD strip level ${adStripLevel} means active decay`);
  } else if (adStripLevel >= AD_STRIP.capCAt) {
    capAt('C', `AD strip level ${adStripLevel} means decay has started`);
    outcome.restrictions.push(RESTRICTIONS.NO_TRAVEL_ABROAD);
  }

  if (warpMillimetres >= WARP_MM.quarantineAt) {
    outcome.quarantine = true;
    capAt('D', `${warpMillimetres}mm of warp will not pass a gate`);
  } else if (warpMillimetres >= WARP_MM.capCAt) {
    capAt('C', `${warpMillimetres}mm of warp needs careful threading`);
    outcome.restrictions.push(RESTRICTIONS.NO_PLATTER);
  }

  return outcome;
}

/**
 * The whole assessment. Nothing here writes to a database: an inspector can
 * ask for the verdict of a report before filing it.
 */
function assessCondition({
  findings = [],
  measurements = {},
  footage,
  baseStock = 'polyester',
  existingRestrictions = [],
} = {}) {
  const density = damageDensity(findings, footage);
  const byArea = summariseByArea(findings);
  const reasons = [];

  let grade = gradeFromDensity(density);
  reasons.push(`damage density ${density} per 1000ft grades ${grade}`);

  let restrictions = [...existingRestrictions];
  for (const finding of findings) {
    restrictions = mergeRestrictions(restrictions, restrictionsForFinding(finding));
  }

  // A severe perforation finding is never better than a C whatever the density
  // says, because the next pass through a projector makes it worse.
  const severePerforation = findings.some(
    (finding) => finding.severity === 'severe' && describeCode(finding.code).area === 'perforation',
  );
  if (severePerforation) {
    grade = worse(grade, 'C');
    reasons.push('a severe perforation finding caps this print at C');
  }

  const measured = readMeasurements(measurements);
  if (measured.cap !== 'A') {
    grade = worse(grade, measured.cap);
  }
  reasons.push(...measured.reasons);
  restrictions = mergeRestrictions(restrictions, measured.restrictions);

  if (baseStock === 'nitrate') {
    restrictions = mergeRestrictions(restrictions, [RESTRICTIONS.NITRATE_BOOTH]);
    reasons.push('nitrate stock may only run in a certified booth');
  }

  let verdict;
  if (measured.quarantine || grade === 'D') {
    verdict = 'quarantine';
  } else if (restrictions.length > 0) {
    verdict = 'projectable-with-restrictions';
  } else {
    verdict = 'projectable';
  }

  return {
    grade,
    verdict,
    density,
    byArea,
    restrictions,
    reasons,
    quarantineForced: measured.quarantine,
  };
}

module.exports = {
  GRADES,
  DENSITY_BANDS,
  SHRINKAGE,
  AD_STRIP,
  WARP_MM,
  worse,
  damageDensity,
  gradeFromDensity,
  readMeasurements,
  assessCondition,
};
