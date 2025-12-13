'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const {
  makeTitle,
  makeRightsHolder,
  makeVenue,
  makeRightsWindow,
} = require('../../helpers/factories');
const service = require('../../../src/services/rightsService');

describe('rights windows', () => {
  let title;
  let holder;
  let prince;

  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    holder = await makeRightsHolder({ name: 'Park Circus', remittanceCurrency: 'GBP' });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable' });
    prince = await makeVenue({ code: 'GB-LON-PRINCE', city: 'London' });
  });

  const input = (overrides = {}) => ({
    titleId: title.publicId,
    rightsHolderId: holder.publicId,
    territory: 'GB',
    exhibitionTypes: ['repertory'],
    startsOn: '2025-01-01',
    endsOn: '2025-12-31',
    terms: { kind: 'flat', currency: 'GBP', flatFeeMinor: 25000 },
    ...overrides,
  });

  it('writes a licence as a draft, never live', async () => {
    const window = await service.createWindow(input());

    expect(window.status).toBe('draft');
    expect(window.publicId).toMatch(/^rw_/);
  });

  it('refuses terms that do not describe a deal', async () => {
    await expect(
      service.createWindow(input({ terms: { kind: 'percentage', currency: 'GBP' } })),
    ).rejects.toThrow(/incomplete/);
    let caught;
    try {
      await service.createWindow(input({ terms: { kind: 'flat', currency: 'GBP' } }));
    } catch (err) {
      caught = err;
    }
    expect(caught.details.problems).toEqual(['a flat fee is needed']);
  });

  it('refuses a licence in a currency the holder is not paid in', async () => {
    await expect(
      service.createWindow(input({ terms: { kind: 'flat', currency: 'EUR', flatFeeMinor: 100 } })),
    ).rejects.toThrow(/currency the holder is paid in/);
  });

  it('refuses a territory nobody licences', async () => {
    await expect(service.createWindow(input({ territory: 'Scandinavia' }))).rejects.toThrow(
      /not a territory/,
    );
  });

  it('activates a draft', async () => {
    const window = await service.createWindow(input());

    const activated = await service.activateWindow(window.publicId);

    expect(activated.status).toBe('active');
  });

  it('refuses to activate a second exclusive that clashes', async () => {
    const first = await service.createWindow(
      input({ exclusivity: { scope: 'city', heldByVenueId: prince.publicId } }),
    );
    await service.activateWindow(first.publicId);

    const bfi = await makeVenue({ code: 'GB-LON-BFI', city: 'London' });
    const second = await service.createWindow(
      input({ exclusivity: { scope: 'territory', heldByVenueId: bfi.publicId } }),
    );

    await expect(service.activateWindow(second.publicId)).rejects.toThrow(
      /another exclusive licence/,
    );
  });

  it('lets one house hold both a city and a territory exclusive', async () => {
    const first = await service.createWindow(
      input({ exclusivity: { scope: 'city', heldByVenueId: prince.publicId } }),
    );
    await service.activateWindow(first.publicId);

    const second = await service.createWindow(
      input({ exclusivity: { scope: 'territory', heldByVenueId: prince.publicId } }),
    );

    await expect(service.activateWindow(second.publicId)).resolves.toMatchObject({
      status: 'active',
    });
  });

  it('suspends a licence with a reason and refuses without one', async () => {
    const window = await service.createWindow(input());
    await service.activateWindow(window.publicId);

    await expect(service.suspendWindow(window.publicId)).rejects.toThrow(/needs a reason/);

    const suspended = await service.suspendWindow(window.publicId, 'invoice unpaid');
    expect(suspended.status).toBe('suspended');
    expect(suspended.suspendedReason).toBe('invoice unpaid');
  });

  it('will not activate an expired licence', async () => {
    const window = await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      status: 'expired',
    });

    await expect(service.activateWindow(window.publicId)).rejects.toThrow(/write a new one/);
  });

  it('sweeps windows whose end date has gone by', async () => {
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      startsOn: '2024-01-01',
      endsOn: '2024-12-31',
      status: 'active',
    });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id, status: 'active' });

    expect(await service.expireFinishedWindows('2025-06-01')).toBe(1);
  });

  it('clears a screening under the licence that fits', async () => {
    const window = await makeRightsWindow({ title: title._id, rightsHolder: holder._id });

    const decision = await service.clearScreeningRequest({
      titleId: title.publicId,
      venue: prince,
      localDate: '2025-04-17',
      exhibitionType: 'repertory',
    });

    expect(decision.cleared).toBe(true);
    expect(decision.windowId).toBe(window.publicId);
  });

  it('refuses a screening in a territory the licence does not reach', async () => {
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id, territory: 'FR' });

    const decision = await service.clearScreeningRequest({
      titleId: title.publicId,
      venue: prince,
      localDate: '2025-04-17',
      exhibitionType: 'repertory',
    });

    expect(decision.cleared).toBe(false);
    expect(decision.refusalCodes).toEqual(['territory']);
    expect(decision.details[0].detail).toMatch(/FR does not reach GB/);
  });

  it('refuses another house while an exclusive is live in the same city', async () => {
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      exclusivity: { scope: 'city', heldBy: prince._id },
    });
    const ica = await makeVenue({ code: 'GB-LON-ICA', city: 'London' });

    const decision = await service.clearScreeningRequest({
      titleId: title.publicId,
      venue: ica,
      localDate: '2025-04-17',
      exhibitionType: 'repertory',
    });

    expect(decision.cleared).toBe(false);
    expect(decision.details[0].detail).toMatch(/Prince Charles Cinema/);
  });

  it('clears the holder of that same exclusive', async () => {
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      exclusivity: { scope: 'city', heldBy: prince._id },
    });

    const decision = await service.clearScreeningRequest({
      titleId: title.publicId,
      venue: prince,
      localDate: '2025-04-17',
      exhibitionType: 'repertory',
    });

    expect(decision.cleared).toBe(true);
  });

  it('reads the local date off an instant in the venue zone', async () => {
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      startsOn: '2025-04-18',
      endsOn: '2025-04-18',
    });

    const decision = await service.clearScreeningAt({
      titleId: title.publicId,
      venue: prince,
      instant: new Date('2025-04-17T23:30:00Z'),
      exhibitionType: 'repertory',
    });

    expect(decision.request.localDate).toBe('2025-04-18');
    expect(decision.cleared).toBe(true);
  });

  it('filters the licence list by title, status and date', async () => {
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id, status: 'draft' });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id, status: 'active' });

    const active = await service.listWindows({ titleId: title.publicId, status: 'active' });
    expect(active.items).toHaveLength(1);

    const onDate = await service.listWindows({ onDate: '2025-06-01' });
    expect(onDate.items).toHaveLength(2);

    const outside = await service.listWindows({ onDate: '2027-01-01' });
    expect(outside.items).toHaveLength(0);
  });
});
