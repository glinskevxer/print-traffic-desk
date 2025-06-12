'use strict';

const { rangesOverlap, addDays, daysBetween, isBefore } = require('../../lib/dates');

/**
 * An element is spoken for from the day work starts on it to the day it is
 * back on its own shelf. That span is what the desk has to keep clear, and it
 * is longer than the screening by a week in both directions once transit and
 * bench time are counted.
 */

function span(startsOn, endsOn, reason, reference = null) {
  return { startsOn, endsOn, reason, reference };
}

/** The span a planned or moving leg keeps the element out of circulation for. */
function spanForShipment(shipment) {
  const from = shipment.dispatchedOn || shipment.plannedDispatchOn;
  const to = shipment.arrivedOn || shipment.plannedArrivalOn;
  return span(from, to, `${shipment.leg} leg`, shipment.publicId);
}

function spansFromShipments(shipments = []) {
  return shipments
    .filter((shipment) => !['cancelled', 'lost'].includes(shipment.status))
    .map(spanForShipment);
}

/**
 * Overlapping and touching spans become one. A print out on Monday and out
 * again from the same Monday is one continuous absence, and reporting it as
 * two makes the free gaps look real when they are not.
 */
function mergeSpans(spans) {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort(
    (a, b) => daysBetween(b.startsOn, a.startsOn) || daysBetween(b.endsOn, a.endsOn),
  );

  const merged = [sorted[0]];
  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (!isBefore(addDays(last.endsOn, 1), current.startsOn)) {
      last.endsOn = isBefore(last.endsOn, current.endsOn) ? current.endsOn : last.endsOn;
      last.reason = last.reason === current.reason ? last.reason : 'several commitments';
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function conflicts(spans, candidate) {
  return spans.filter((existing) => rangesOverlap(existing, candidate));
}

function isFreeBetween(spans, startsOn, endsOn) {
  return conflicts(spans, { startsOn, endsOn }).length === 0;
}

/**
 * The first date on or after `from` where the element is free for `days`
 * consecutive days. Used to answer "when could we have it instead".
 */
function nextFreeFrom(spans, from, days) {
  const merged = mergeSpans(spans);
  let cursor = from;
  let guard = 0;

  while (guard < 400) {
    const candidate = { startsOn: cursor, endsOn: addDays(cursor, Math.max(0, days - 1)) };
    const blocking = conflicts(merged, candidate);
    if (blocking.length === 0) return cursor;

    const latest = blocking.reduce((worst, each) =>
      isBefore(worst.endsOn, each.endsOn) ? each : worst,
    );
    cursor = addDays(latest.endsOn, 1);
    guard += 1;
  }
  return null;
}

/** How many days out of a period the element was spoken for. */
function daysCommitted(spans, startsOn, endsOn) {
  const merged = mergeSpans(spans);
  let total = 0;
  for (const each of merged) {
    const from = isBefore(each.startsOn, startsOn) ? startsOn : each.startsOn;
    const to = isBefore(endsOn, each.endsOn) ? endsOn : each.endsOn;
    const length = daysBetween(from, to) + 1;
    if (length > 0) total += length;
  }
  return total;
}

module.exports = {
  span,
  spanForShipment,
  spansFromShipments,
  mergeSpans,
  conflicts,
  isFreeBetween,
  nextFreeFrom,
  daysCommitted,
};
