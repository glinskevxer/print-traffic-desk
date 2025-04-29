'use strict';

const { evaluateSelfContained } = require('./rules');
const { exclusivityRule } = require('./exclusivity');
const { breadth } = require('./territories');
const { daysBetween } = require('../../lib/dates');

/**
 * Given every licence that might cover a screening, decide whether it can go
 * ahead and under which one.
 *
 * The rule that surprises people: a window that passes on its own can still be
 * refused, because exclusivity is a fact about somebody else's licence. That is
 * why exclusivity is evaluated once for the request and folded into every
 * candidate rather than being asked of each window in turn.
 */

function evaluateWindow(window, request, exclusivityOutcome) {
  const outcomes = [...evaluateSelfContained(window, request), exclusivityOutcome];
  return {
    windowId: window.publicId,
    territory: window.territory,
    ok: outcomes.every((outcome) => outcome.ok),
    outcomes,
    refusals: outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.code),
  };
}

/**
 * The tightest licence wins: narrowest territory, then the window that closes
 * soonest, then the id so the answer never depends on document order.
 */
function preferenceOrder(a, b) {
  const byTerritory = breadth(a.territory) - breadth(b.territory);
  if (byTerritory !== 0) return byTerritory;

  const byClosing = daysBetween(b.endsOn, a.endsOn);
  if (byClosing !== 0) return byClosing;

  return String(a.publicId).localeCompare(String(b.publicId));
}

function clearScreening({ windows = [], exclusiveWindows = [], request }) {
  const exclusivityOutcome = exclusivityRule(exclusiveWindows, request);

  const evaluations = windows.map((window) => evaluateWindow(window, request, exclusivityOutcome));
  const byId = new Map(windows.map((window) => [window.publicId, window]));

  const clearedWindows = evaluations
    .filter((evaluation) => evaluation.ok)
    .map((evaluation) => byId.get(evaluation.windowId))
    .sort(preferenceOrder);

  if (clearedWindows.length > 0) {
    const chosen = clearedWindows[0];
    return {
      cleared: true,
      window: chosen,
      windowId: chosen.publicId,
      evaluations,
      alternatives: clearedWindows.slice(1).map((window) => window.publicId),
      refusalCodes: [],
    };
  }

  return {
    cleared: false,
    window: null,
    windowId: null,
    evaluations,
    alternatives: [],
    refusalCodes: summariseRefusal(evaluations),
  };
}

/**
 * What to tell the venue. When every candidate failed the same rule that is the
 * answer; when they failed different ones the desk lists them all, because
 * "there is no licence at all" and "there is one but it is blacked out" are
 * different phone calls.
 */
function summariseRefusal(evaluations) {
  if (evaluations.length === 0) return ['no-licence'];
  const codes = new Set();
  for (const evaluation of evaluations) {
    for (const code of evaluation.refusals) codes.add(code);
  }
  return [...codes].sort();
}

/** The sentences behind a refusal, deduplicated, for the response body. */
function refusalDetails(evaluations) {
  const seen = new Set();
  const details = [];
  for (const evaluation of evaluations) {
    for (const outcome of evaluation.outcomes) {
      if (outcome.ok) continue;
      const key = `${outcome.code}:${outcome.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      details.push({ window: evaluation.windowId, code: outcome.code, detail: outcome.detail });
    }
  }
  return details;
}

module.exports = { clearScreening, evaluateWindow, preferenceOrder, summariseRefusal, refusalDetails };
