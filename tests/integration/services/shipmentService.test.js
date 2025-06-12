'use strict';

const { openTestConnection, closeTestConnection, clearCollections } = require('../../helpers/db');
const { registerModels, syncIndexes, models } = require('../../../src/models');
const { makePrintElement, makeVenue } = require('../../helpers/factories');
const service = require('../../../src/services/shipmentService');

describe('print traffic', () => {
  let home;
  let away;
  let element;

  beforeAll(async () => {
    const conn = await openTestConnection();
    registerModels(conn);
    await syncIndexes();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    home = await makeVenue({ code: 'GB-LON-VAULT', outboundLeadDays: 1 });
    away = await makeVenue({ code: 'GB-GLA-GFT', city: 'Glasgow', inboundLeadDays: 2 });
    element = await makePrintElement({
      currentLocation: home._id,
      custodian: home._id,
      status: 'available',
      lastInspectedOn: '2025-05-01',
      screeningsSinceInspection: 0,
    });
  });

  const plan = (overrides = {}) => ({
    elementId: element.publicId,
    toVenueId: away.publicId,
    leg: 'outbound',
    screeningLocalDate: '2025-06-20',
    today: '2025-05-15',
    ...overrides,
  });

  it('plans a leg and works its own dates out', async () => {
    const { shipment } = await service.planLeg(plan());

    expect(shipment.status).toBe('planned');
    expect(shipment.plannedArrivalOn).toBe('2025-06-18');
    expect(shipment.plannedDispatchOn < shipment.plannedArrivalOn).toBe(true);
    expect(shipment.cans).toBe(element.reelCount);
  });

  it('refuses a second open leg on the same print', async () => {
    await service.planLeg(plan());

    await expect(service.planLeg(plan())).rejects.toThrow(/already has a leg open/);
  });

  it('refuses to ship a print to where it already is', async () => {
    await expect(service.planLeg(plan({ toVenueId: home.publicId }))).rejects.toThrow(
      /already at that house/,
    );
  });

  it('refuses a service the element may not travel by', async () => {
    const restricted = await makePrintElement({
      currentLocation: home._id,
      custodian: home._id,
      status: 'available',
      handlingRestrictions: ['hand-carry-only'],
    });

    await expect(
      service.planLeg(plan({ elementId: restricted.publicId, service: 'road-freight' })),
    ).rejects.toThrow(/not permitted for this element/);
  });

  it('leaves bench time in the plan for a print that is due a look', async () => {
    const overdue = await makePrintElement({
      currentLocation: home._id,
      custodian: home._id,
      status: 'available',
      screeningsSinceInspection: 12,
      inspectionIntervalScreenings: 6,
    });

    const { plan: made } = await service.planLeg(plan({ elementId: overdue.publicId }));

    expect(made.dates.inspectionStartsOn < made.dates.readyBy).toBe(true);
  });

  it('refuses a date the work can no longer start for', async () => {
    await expect(
      service.planLeg(plan({ screeningLocalDate: '2025-05-16', today: '2025-05-15', service: 'road-freight' })),
    ).rejects.toThrow(/already past/);
  });

  it('sends the element on the road when the leg is despatched', async () => {
    const { shipment } = await service.planLeg(plan());

    const result = await service.dispatch(shipment.publicId, {
      dispatchedOn: '2025-06-16',
      carrier: 'Film Freight Ltd',
      trackingReference: 'FF-4471',
    });

    expect(result.shipment.status).toBe('in-transit');
    expect(result.element.status).toBe('in-transit');
  });

  it('will not despatch a leg twice', async () => {
    const { shipment } = await service.planLeg(plan());
    await service.dispatch(shipment.publicId, { dispatchedOn: '2025-06-16' });

    await expect(
      service.dispatch(shipment.publicId, { dispatchedOn: '2025-06-17' }),
    ).rejects.toThrow(/only a planned leg/);
  });

  it('puts the print on loan when it lands somewhere that is not home', async () => {
    const { shipment } = await service.planLeg(plan());
    await service.dispatch(shipment.publicId, { dispatchedOn: '2025-06-16' });

    const result = await service.markArrived(shipment.publicId, {
      arrivedOn: '2025-06-18',
      arrivalCheck: { checkedBy: 'A. Novak', cansReceived: 6, sealsIntact: true },
    });

    expect(result.element.status).toBe('on-loan');
    expect(String(result.element.currentLocation)).toBe(String(away._id));
  });

  it('puts the print back on the shelf when it lands at its own custodian', async () => {
    element.currentLocation = away._id;
    element.status = 'on-loan';
    await element.save();

    const { shipment } = await service.planLeg(
      plan({ toVenueId: home.publicId, leg: 'return', screeningLocalDate: '2025-06-20', today: '2025-06-20' }),
    );
    await service.dispatch(shipment.publicId, { dispatchedOn: '2025-06-23' });
    const result = await service.markArrived(shipment.publicId, { arrivedOn: '2025-06-25' });

    expect(result.element.status).toBe('available');
    expect(String(result.element.currentLocation)).toBe(String(home._id));
  });

  it('will not land a leg that never left', async () => {
    const { shipment } = await service.planLeg(plan());

    await expect(
      service.markArrived(shipment.publicId, { arrivedOn: '2025-06-18' }),
    ).rejects.toThrow(/not on the road/);
  });

  it('records what turned up and what did not', async () => {
    const { shipment } = await service.planLeg(plan());
    await service.dispatch(shipment.publicId, { dispatchedOn: '2025-06-16' });

    const result = await service.markArrived(shipment.publicId, {
      arrivedOn: '2025-06-18',
      arrivalCheck: { checkedBy: 'A. Novak', cansReceived: 5, sealsIntact: false, notes: 'reel 4 missing' },
    });

    expect(result.shipment.arrivalCheck.cansReceived).toBe(5);
  });

  it('retires the element when a leg is reported lost', async () => {
    const { shipment } = await service.planLeg(plan());
    await service.dispatch(shipment.publicId, { dispatchedOn: '2025-06-16' });

    const result = await service.markLost(shipment.publicId, {
      reportedOn: '2025-06-25',
      reason: 'carrier cannot trace the consignment',
    });

    expect(result.shipment.status).toBe('lost');
    expect(result.element.status).toBe('retired');
    expect(result.element.provenance).toMatch(/lost in transit/);
  });

  it('marks a leg delayed without moving the print', async () => {
    const { shipment } = await service.planLeg(plan());
    await service.dispatch(shipment.publicId, { dispatchedOn: '2025-06-16' });

    const delayed = await service.markDelayed(shipment.publicId, 'held at the depot');

    expect(delayed.status).toBe('delayed');
  });

  it('lists the legs that should have landed by now', async () => {
    const { shipment } = await service.planLeg(plan());
    await service.dispatch(shipment.publicId, { dispatchedOn: '2025-06-16' });

    const overdue = await service.overdueArrivals('2025-06-20');

    expect(overdue.map((each) => each.publicId)).toEqual([shipment.publicId]);
    expect(await service.overdueArrivals('2025-06-17')).toHaveLength(0);
  });

  it('writes an audit line for every step of a leg', async () => {
    const { AuditEvent } = models();
    const { shipment } = await service.planLeg(plan());
    await service.dispatch(shipment.publicId, { dispatchedOn: '2025-06-16' });
    await service.markArrived(shipment.publicId, { arrivedOn: '2025-06-18' });

    const trail = await AuditEvent.find({ subjectId: shipment.publicId }).sort({ at: 1 });

    expect(trail.map((event) => event.action)).toEqual([
      'shipment.planned',
      'shipment.dispatched',
      'shipment.arrived',
    ]);
  });
});

describe('what an element is spoken for', () => {
  let home;
  let away;
  let element;

  beforeAll(async () => {
    const conn = await openTestConnection();
    registerModels(conn);
    await syncIndexes();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    home = await makeVenue({ code: 'GB-LON-VAULT' });
    away = await makeVenue({ code: 'GB-GLA-GFT', city: 'Glasgow' });
    element = await makePrintElement({
      currentLocation: home._id,
      custodian: home._id,
      status: 'available',
    });
  });

  it('has nothing against a print that has never travelled', async () => {
    expect(await service.commitmentsFor(element.publicId)).toEqual([]);
    expect(await service.isElementFree(element.publicId, '2025-06-01', '2025-06-30')).toBe(true);
  });

  it('holds the print for the span of a planned leg', async () => {
    const { shipment } = await service.planLeg({
      elementId: element.publicId,
      toVenueId: away.publicId,
      leg: 'outbound',
      screeningLocalDate: '2025-06-20',
      today: '2025-05-15',
    });

    const spans = await service.commitmentsFor(element.publicId);

    expect(spans).toHaveLength(1);
    expect(spans[0].reference).toBe(shipment.publicId);
    expect(await service.isElementFree(element.publicId, '2025-06-17', '2025-06-19')).toBe(false);
  });

  it('offers the next date the print is free', async () => {
    await service.planLeg({
      elementId: element.publicId,
      toVenueId: away.publicId,
      leg: 'outbound',
      screeningLocalDate: '2025-06-20',
      today: '2025-05-15',
    });

    const next = await service.nextFreeDate(element.publicId, '2025-06-16', 3);

    expect(next > '2025-06-18').toBe(true);
  });

  it('refuses to answer for a print that is not catalogued', async () => {
    await expect(service.commitmentsFor('elem_0000000000000000')).rejects.toThrow(/does not exist/);
  });
});
