'use strict';

const { models } = require('../../src/models');

let counter = 0;

function nextBarcode() {
  counter += 1;
  return `PE-${String(counter).padStart(6, '0')}`;
}

function resetFactoryCounter() {
  counter = 0;
}

async function makeRightsHolder(overrides = {}) {
  const { RightsHolder } = models();
  return RightsHolder.create({
    name: `Holder ${Math.random().toString(36).slice(2, 8)}`,
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
  const slug = overrides.slug || `title-${Math.random().toString(36).slice(2, 8)}`;
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
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
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

module.exports = {
  nextBarcode,
  resetFactoryCounter,
  makeRightsHolder,
  makeTitle,
  makeVenue,
  makePrintElement,
};
