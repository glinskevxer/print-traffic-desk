'use strict';

const { models } = require('../../src/models');

/**
 * One counter for the whole worker, not per test file. Jest resets the module
 * registry between files but keeps the process, and the suites in one worker
 * share a database, so a per file counter handed out the same barcode twice
 * and the run failed on a duplicate key roughly one time in fifteen.
 */
const COUNTER_KEY = 'printdesk-factory-counter';

function nextNumber() {
  globalThis[COUNTER_KEY] = (globalThis[COUNTER_KEY] || 0) + 1;
  return globalThis[COUNTER_KEY];
}

function nextBarcode() {
  return `PE-${String(nextNumber()).padStart(6, '0')}`;
}

function resetFactoryCounter() {
  globalThis[COUNTER_KEY] = 0;
}

/** Four characters of a venue code, unique inside the run rather than random. */
function nextSuffix() {
  return String(nextNumber()).padStart(4, '0').slice(-4);
}

async function makeRightsHolder(overrides = {}) {
  const { RightsHolder } = models();
  return RightsHolder.create({
    name: `Holder ${nextNumber()}`,
    kind: 'distributor',
    remittanceCurrency: 'GBP',
    territoriesRepresented: ['GB', 'IE'],
    contacts: [{ name: 'Bookings', email: 'bookings@example.test', role: 'bookings' }],
    ...overrides,
  });
}

async function makeTitle(overrides = {}) {
  const { Title } = models();
  const rightsHolder = overrides.rightsHolder || (await makeRightsHolder())._id;
  const slug = overrides.slug || `title-${nextNumber()}`;
  return Title.create({
    slug,
    title: 'The Red Shoes',
    year: 1948,
    countries: ['GB'],
    originalLanguages: ['en'],
    runtimeMinutes: 135,
    credits: [{ name: 'Michael Powell', role: 'director' }],
    status: 'bookable',
    ...overrides,
    rightsHolder,
  });
}

async function makeVenue(overrides = {}) {
  const { Venue } = models();
  const suffix = nextSuffix();
  return Venue.create({
    code: `GB-LON-${suffix}`,
    name: 'Prince Charles Cinema',
    territory: 'GB',
    city: 'London',
    timezone: 'Europe/London',
    address: { line1: '7 Leicester Place', city: 'London', postcode: 'WC2H 7BY', territory: 'GB' },
    booth: {
      gauges: ['35mm'],
      soundFormats: ['optical-mono', 'dolby-a', 'dolby-sr'],
      speeds: [24],
      changeoverCapable: true,
      reelCapacity: 8,
    },
    seats: 288,
    boxOfficeCurrency: 'GBP',
    houseNutMinor: 42000,
    inboundLeadDays: 2,
    outboundLeadDays: 1,
    ...overrides,
  });
}

async function makePrintElement(overrides = {}) {
  const { PrintElement } = models();
  const title = overrides.title || (await makeTitle())._id;
  const venue = overrides.currentLocation || (await makeVenue())._id;
  const owner = overrides.owner || (await makeRightsHolder())._id;
  return PrintElement.create({
    barcode: nextBarcode(),
    kind: 'release-print',
    gauge: '35mm',
    baseStock: 'polyester',
    aspectRatio: '1.37:1',
    soundFormat: 'optical-mono',
    footage: 12150,
    reelCount: 6,
    status: 'available',
    conditionGrade: 'B',
    inspectionIntervalScreenings: 6,
    lastInspectedOn: '2025-01-04',
    ...overrides,
    title,
    owner,
    custodian: overrides.custodian || venue,
    currentLocation: venue,
  });
}

async function makeRightsWindow(overrides = {}) {
  const { RightsWindow } = models();
  const title = overrides.title || (await makeTitle())._id;
  const rightsHolder = overrides.rightsHolder || (await makeRightsHolder())._id;
  return RightsWindow.create({
    territory: 'GB',
    exhibitionTypes: ['repertory'],
    startsOn: '2025-01-01',
    endsOn: '2025-12-31',
    terms: { kind: 'flat', currency: 'GBP', flatFeeMinor: 25000 },
    status: 'active',
    ...overrides,
    title,
    rightsHolder,
  });
}

module.exports = {
  nextBarcode,
  nextNumber,
  resetFactoryCounter,
  makeRightsHolder,
  makeTitle,
  makeVenue,
  makePrintElement,
  makeRightsWindow,
};
