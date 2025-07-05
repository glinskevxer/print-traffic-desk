'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { makePrintElement, makeVenue } = require('../../helpers/factories');

describe('shipment model', () => {
  let Shipment;

  beforeAll(async () => {
    ({ Shipment } = await useDatabase());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  afterEach(async () => {
    await clearCollections();
  });

  async function leg(overrides = {}) {
    const element = await makePrintElement();
    const destination = await makeVenue({ code: 'GB-LON-BFI' });
    return Shipment.create({
      element: element._id,
      fromVenue: element.currentLocation,
      toVenue: destination._id,
      leg: 'outbound',
      service: 'road-freight',
      plannedDispatchOn: '2025-06-16',
      plannedArrivalOn: '2025-06-18',
      cans: 6,
      ...overrides,
    });
  }

  it('stores a leg as planned', async () => {
    const shipment = await leg();

    expect(shipment.publicId).toMatch(/^shp_/);
    expect(shipment.status).toBe('planned');
    expect(shipment.isOpen()).toBe(true);
  });

  it('refuses a leg that arrives before it leaves', async () => {
    await expect(leg({ plannedArrivalOn: '2025-06-15' })).rejects.toThrow(/before it leaves/);
  });

  it('refuses a leg that goes nowhere', async () => {
    const element = await makePrintElement();

    await expect(
      models().Shipment.create({
        element: element._id,
        fromVenue: element.currentLocation,
        toVenue: element.currentLocation,
        leg: 'transfer',
        service: 'courier',
        plannedDispatchOn: '2025-06-16',
        plannedArrivalOn: '2025-06-17',
      }),
    ).rejects.toThrow(/has to go somewhere else/);
  });

  it('refuses a service the desk does not book', async () => {
    await expect(leg({ service: 'pigeon' })).rejects.toThrow(/service/);
  });

  it('refuses an arrival recorded before the despatch', async () => {
    await expect(leg({ dispatchedOn: '2025-06-17', arrivedOn: '2025-06-16' })).rejects.toThrow(
      /before it leaves/,
    );
  });

  it('knows a leg is late once it has actually gone', async () => {
    const shipment = await leg({ status: 'in-transit' });

    expect(shipment.isLate('2025-06-19')).toBe(true);
    expect(shipment.isLate('2025-06-17')).toBe(false);
  });

  it('does not call a planned leg late, only a moving one', async () => {
    const shipment = await leg({ status: 'planned' });

    expect(shipment.isLate('2025-07-01')).toBe(false);
  });

  it('closes a leg once it is delivered', async () => {
    const shipment = await leg({ status: 'delivered', arrivedOn: '2025-06-18' });

    expect(shipment.isOpen()).toBe(false);
    expect(shipment.isLate('2026-01-01')).toBe(false);
  });

  it('records what actually turned up', async () => {
    const shipment = await leg({
      status: 'delivered',
      arrivalCheck: { checkedBy: 'A. Novak', cansReceived: 5, sealsIntact: false, notes: 'one can missing' },
    });

    expect(shipment.arrivalCheck.cansReceived).toBe(5);
    expect(shipment.arrivalCheck.sealsIntact).toBe(false);
  });
});
