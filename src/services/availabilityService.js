'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { rankCandidates } = require('../domain/elements/selection');
const { planRoundTrip } = require('../domain/traffic/routing');
const { spansFromShipments, isFreeBetween } = require('../domain/traffic/availability');
const { addDays } = require('../lib/dates');
const rightsService = require('./rightsService');

/**
 * "Where could we show this, and when." The same three questions a booking
 * asks, asked of every house at once and answered without holding anything.
 *
 * A programmer plans a season by asking this and reading the refusals, so the
 * answer is deliberately long: it says which houses cannot take it and why,
 * not just which ones can.
 */

const LOOKAHEAD_DAYS = 21;

async function freeElementsFor({ title, span }) {
  const { PrintElement, Shipment, Venue } = models();

  const elements = await PrintElement.find({
    title: title._id,
    status: { $in: ['available', 'intake'] },
  });
  if (elements.length === 0) return { free: [], territoryOf: () => null };

  const shipments = await Shipment.find({ element: { $in: elements.map((each) => each._id) } });
  const byElement = new Map();
  for (const shipment of shipments) {
    const key = String(shipment.element);
    if (!byElement.has(key)) byElement.set(key, []);
    byElement.get(key).push(shipment);
  }

  const free = elements.filter((element) =>
    isFreeBetween(
      spansFromShipments(byElement.get(String(element._id)) || []),
      span.startsOn,
      span.endsOn,
    ),
  );

  const locations = await Venue.find({ _id: { $in: free.map((each) => each.currentLocation) } });
  const byId = new Map(locations.map((each) => [String(each._id), each]));

  return {
    free,
    locations: byId,
    territoryOf: (element) => {
      const at = byId.get(String(element.currentLocation));
      return at ? at.territory : null;
    },
  };
}

/**
 * One house's answer. Rights first, then a print, then the calendar, because
 * that is the order the house can do something about them: a licence can be
 * asked for, a print cannot be conjured, and a date can be moved.
 */
function assessVenue({ licences, venue, localDate, exhibitionType, elements, today }) {
  const decision = rightsService.decide({ licences, venue, localDate, exhibitionType });

  if (!decision.cleared) {
    return {
      venue: { id: venue.publicId, code: venue.code, name: venue.name, city: venue.city },
      available: false,
      because: 'rights',
      refusals: decision.details,
    };
  }

  const { runnable, rejected } = rankCandidates(elements.free, {
    venue,
    territoryOf: elements.territoryOf,
  });

  if (runnable.length === 0) {
    return {
      venue: { id: venue.publicId, code: venue.code, name: venue.name, city: venue.city },
      available: false,
      because: 'no-print',
      windowId: decision.windowId,
      refusals: rejected.flatMap((each) =>
        each.problems.map((problem) => ({ print: each.element.barcode, ...problem })),
      ),
    };
  }

  const best = runnable[0];
  const origin = elements.locations.get(String(best.element.currentLocation));
  const plan = planRoundTrip({
    fromTerritory: origin ? origin.territory : venue.territory,
    toTerritory: venue.territory,
    outboundLeadDays: origin ? origin.outboundLeadDays : 1,
    inboundLeadDays: venue.inboundLeadDays,
    inspectionDays: best.element.needsInspection() ? 3 : 0,
    screeningLocalDate: localDate,
    holdDaysAfterScreening: 1,
    today,
    restrictions: best.element.handlingRestrictions,
    baseStock: best.element.baseStock,
  });

  if (!plan.feasible) {
    return {
      venue: { id: venue.publicId, code: venue.code, name: venue.name, city: venue.city },
      available: false,
      because: 'calendar',
      windowId: decision.windowId,
      print: { id: best.element.publicId, barcode: best.element.barcode },
      refusals: [{ code: plan.outbound.reason, detail: plan.outbound.detail }],
      shortfallDays: plan.outbound.shortfallDays,
    };
  }

  return {
    venue: { id: venue.publicId, code: venue.code, name: venue.name, city: venue.city },
    available: true,
    windowId: decision.windowId,
    print: {
      id: best.element.publicId,
      barcode: best.element.barcode,
      grade: best.element.conditionGrade,
      playableSound: best.playableSound,
    },
    dispatchOn: plan.outbound.dates.dispatchOn,
    backOn: plan.inbound.dates.backOn,
    slackDays: plan.outbound.slackDays,
  };
}

async function housesFor({ titleId, localDate, exhibitionType = 'repertory', territory, today }) {
  const { Title, Venue } = models();
  const title = await required(Title, titleId);

  const filter = { active: true };
  if (territory) filter.territory = territory;
  const venues = await Venue.find(filter).sort({ code: 1 });

  const span = { startsOn: today || localDate, endsOn: addDays(localDate, LOOKAHEAD_DAYS) };
  const [elements, licences] = await Promise.all([
    freeElementsFor({ title, span }),
    rightsService.licencesFor(title.publicId),
  ]);

  // Each house is an independent question, so they go together. A circuit has
  // tens of houses, not thousands, and asking them one at a time turned a
  // season planning screen into four seconds of waiting.
  // The licences are loaded once and the engine runs in memory per house, so
  // a season planning screen is two queries and a loop rather than two queries
  // per house.
  const houses = venues.map((venue) =>
    assessVenue({
      licences,
      venue,
      localDate,
      exhibitionType,
      elements,
      today: today || localDate,
    }),
  );

  return {
    title: { id: title.publicId, slug: title.slug, year: title.year },
    localDate,
    exhibitionType,
    printsFree: elements.free.length,
    houses,
    availableCount: houses.filter((house) => house.available).length,
  };
}

module.exports = { housesFor, assessVenue, freeElementsFor, LOOKAHEAD_DAYS };
