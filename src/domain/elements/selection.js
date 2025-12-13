'use strict';

const { boothCompatibility } = require('./compatibility');

/**
 * Which print to send. The desk has more than one copy of the popular titles
 * and they are not interchangeable: a restoration is worth more than a battered
 * release print, and a print already in the right country saves four days.
 */

const GRADE_SCORE = Object.freeze({ A: 0, B: 10, C: 30, D: 100 });

const KIND_SCORE = Object.freeze({
  'restoration-print': 0,
  'archival-print': 5,
  'release-print': 10,
  'reversal-original': 60,
  interpositive: 80,
  internegative: 90,
  'dupe-negative': 95,
});

/**
 * Lower is better. The weights say what the desk actually prefers: never send
 * a duplicating element to a public screening, send the better condition print,
 * and all else equal send the one that has the shortest journey.
 */
function scoreCandidate(element, { venue, locationTerritory }) {
  const gradeScore = GRADE_SCORE[element.conditionGrade] ?? 20;
  const kindScore = KIND_SCORE[element.kind] ?? 50;
  const abroad = locationTerritory && locationTerritory !== venue.territory ? 25 : 0;
  const wear = Math.min(20, element.screeningsSinceInspection * 2);
  const restrictions = element.handlingRestrictions.length * 3;

  return gradeScore + kindScore + abroad + wear + restrictions;
}

/**
 * Filters to the prints this booth can actually run, then orders them. The
 * refusals are kept so the desk can tell a venue why the print they asked for
 * is not the one they are getting.
 */
function rankCandidates(elements, { venue, territoryOf = () => null }) {
  const runnable = [];
  const rejected = [];

  for (const element of elements) {
    const compatibility = boothCompatibility(element, venue);
    if (compatibility.compatible) {
      runnable.push({
        element,
        score: scoreCandidate(element, { venue, locationTerritory: territoryOf(element) }),
        playableSound: compatibility.playableSound,
      });
    } else {
      rejected.push({ element, problems: compatibility.problems });
    }
  }

  runnable.sort((a, b) => a.score - b.score || a.element.barcode.localeCompare(b.element.barcode));
  return { runnable, rejected };
}

function bestCandidate(elements, options) {
  const { runnable } = rankCandidates(elements, options);
  return runnable.length > 0 ? runnable[0] : null;
}

module.exports = { GRADE_SCORE, KIND_SCORE, scoreCandidate, rankCandidates, bestCandidate };
