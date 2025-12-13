'use strict';

const { fastestPermitted, estimateTransit } = require('./carriers');
const { workingDayAcross, workingDayIn } = require('./calendars');
const { subtractWorkingDays, addWorkingDays, daysBetween, isBefore } = require('../../lib/dates');

/**
 * Traffic planning runs backwards. The screening is fixed, so the desk asks
 * what has to be true on each earlier day for the cans to be in the booth in
 * time, and the answer is either a date to book the carrier on or a reason it
 * cannot be done.
 *
 * Every step counts working days, and the working days of a leg are the days
 * both ends are open, which is why a Friday screening in Paris after a Thursday
 * French holiday is not the same problem as the same screening in Manchester.
 */

function infeasible(reason, detail) {
  return { feasible: false, reason, detail };
}

/**
 * The plan for getting one element to one venue for one date.
 *
 * inspectionDays is the bench time before despatch. It is only spent when the
 * element is actually due a look, because an archive that inspects everything
 * before every loan cannot turn a print round inside a week.
 */
function planOutbound({
  fromTerritory,
  toTerritory,
  outboundLeadDays = 1,
  inboundLeadDays = 2,
  inspectionDays = 0,
  screeningLocalDate,
  today,
  restrictions = [],
  baseStock = 'polyester',
  service = null,
}) {
  const quote = service
    ? estimateTransit({ fromTerritory, toTerritory, service })
    : fastestPermitted({ fromTerritory, toTerritory, restrictions, baseStock });

  if (!quote) {
    return infeasible(
      'no-service',
      'nothing this element is allowed to travel by reaches that house',
    );
  }

  const laneOpen = workingDayAcross([fromTerritory, toTerritory]);
  const originOpen = workingDayIn(fromTerritory);

  // The print has to be in the building before the house needs it in the booth.
  const arriveBy = subtractWorkingDays(
    screeningLocalDate,
    inboundLeadDays,
    workingDayIn(toTerritory),
  );
  const dispatchOn = subtractWorkingDays(arriveBy, quote.totalDays, laneOpen);
  const readyBy = subtractWorkingDays(dispatchOn, outboundLeadDays, originOpen);
  const inspectionStartsOn = subtractWorkingDays(readyBy, inspectionDays, originOpen);

  if (isBefore(inspectionStartsOn, today)) {
    return {
      ...infeasible(
        'too-late',
        `work would have to start on ${inspectionStartsOn}, which is already past`,
      ),
      shortfallDays: Math.abs(daysBetween(inspectionStartsOn, today)),
      quote,
      dates: { arriveBy, dispatchOn, readyBy, inspectionStartsOn },
    };
  }

  return {
    feasible: true,
    quote,
    service: quote.service,
    dates: {
      inspectionStartsOn,
      readyBy,
      dispatchOn,
      arriveBy,
      screeningLocalDate,
    },
    slackDays: daysBetween(today, inspectionStartsOn),
  };
}

/**
 * The leg home. A venue holds the print for a stated number of days after the
 * screening, then it goes back, and the desk needs to know when the shelf gets
 * it so the next booking can be planned against a real date.
 */
function planReturn({
  fromTerritory,
  toTerritory,
  screeningLocalDate,
  holdDaysAfterScreening = 1,
  outboundLeadDays = 1,
  restrictions = [],
  baseStock = 'polyester',
  service = null,
}) {
  const quote = service
    ? estimateTransit({ fromTerritory, toTerritory, service })
    : fastestPermitted({ fromTerritory, toTerritory, restrictions, baseStock });

  if (!quote) return infeasible('no-service', 'the element has no permitted way home');

  const laneOpen = workingDayAcross([fromTerritory, toTerritory]);
  const dispatchOn = addWorkingDays(
    screeningLocalDate,
    holdDaysAfterScreening + outboundLeadDays,
    workingDayIn(fromTerritory),
  );
  const backOn = addWorkingDays(dispatchOn, quote.totalDays, laneOpen);

  return { feasible: true, quote, service: quote.service, dates: { dispatchOn, backOn } };
}

/**
 * Out and back as one answer, because the question a programmer actually asks
 * is "can I have it, and when is it free again".
 */
function planRoundTrip(options) {
  const outbound = planOutbound(options);
  if (!outbound.feasible) return { feasible: false, outbound, inbound: null };

  const inbound = planReturn({
    fromTerritory: options.toTerritory,
    toTerritory: options.fromTerritory,
    screeningLocalDate: options.screeningLocalDate,
    holdDaysAfterScreening: options.holdDaysAfterScreening,
    outboundLeadDays: options.inboundLeadDays,
    restrictions: options.restrictions,
    baseStock: options.baseStock,
    service: options.service,
  });

  return {
    feasible: true,
    outbound,
    inbound,
    committedFrom: outbound.dates.inspectionStartsOn,
    committedUntil: inbound.dates.backOn,
  };
}

/** The span an element is unavailable for anything else because of one booking. */
function commitmentWindow(plan) {
  if (!plan.feasible) return null;
  return { startsOn: plan.committedFrom, endsOn: plan.committedUntil };
}

module.exports = { planOutbound, planReturn, planRoundTrip, commitmentWindow, infeasible };
