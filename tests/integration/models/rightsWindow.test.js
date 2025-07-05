'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { makeRightsWindow, makeVenue } = require('../../helpers/factories');

describe('rights window model', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  afterEach(async () => {
    await clearCollections();
  });

  it('stores a licence statement with its terms', async () => {
    const window = await makeRightsWindow();

    expect(window.publicId).toMatch(/^rw_/);
    expect(window.terms.kind).toBe('flat');
    expect(window.exclusivity.scope).toBe('none');
    expect(window.screeningsUsed).toBe(0);
  });

  it('takes a named region as a territory', async () => {
    const window = await makeRightsWindow({ territory: 'NORDIC' });

    expect(window.territory).toBe('NORDIC');
  });

  it('refuses a territory that is neither a code nor a region', async () => {
    await expect(makeRightsWindow({ territory: 'Scandinavia' })).rejects.toThrow(
      /alpha-2 code or a named region/,
    );
  });

  it('refuses a window that ends before it starts', async () => {
    await expect(
      makeRightsWindow({ startsOn: '2025-06-01', endsOn: '2025-05-01' }),
    ).rejects.toThrow(/cannot end before it starts/);
  });

  it('refuses a holdback that outlasts the window', async () => {
    await expect(
      makeRightsWindow({ startsOn: '2025-01-01', endsOn: '2025-06-01', holdbackUntil: '2025-07-01' }),
    ).rejects.toThrow(/licences nothing/);
  });

  it('refuses an exclusive window with nobody holding it', async () => {
    await expect(
      makeRightsWindow({ exclusivity: { scope: 'city' } }),
    ).rejects.toThrow(/name the house holding it/);
  });

  it('takes an exclusive window that names the house', async () => {
    const venue = await makeVenue({ code: 'GB-LON-PRINCE' });

    const window = await makeRightsWindow({
      exclusivity: { scope: 'city', heldBy: venue._id },
    });

    expect(window.isExclusive()).toBe(true);
  });

  it('counts down the screenings a capped window has left', async () => {
    const window = await makeRightsWindow({ maxScreenings: 3, screeningsUsed: 1 });

    expect(window.screeningsRemaining).toBe(2);
    expect(window.isExhausted()).toBe(false);

    window.screeningsUsed = 3;
    expect(window.screeningsRemaining).toBe(0);
    expect(window.isExhausted()).toBe(true);
  });

  it('leaves an uncapped window uncapped', async () => {
    const window = await makeRightsWindow();

    expect(window.screeningsRemaining).toBeNull();
    expect(window.isExhausted()).toBe(false);
  });

  it('refuses a window with no kind of exhibition at all', async () => {
    await expect(makeRightsWindow({ exhibitionTypes: [] })).rejects.toThrow(/at least one kind/);
  });

  it('refuses a percentage outside the basis point range', async () => {
    await expect(
      makeRightsWindow({ terms: { kind: 'percentage', currency: 'GBP', percentageBps: 12000 } }),
    ).rejects.toThrow(/percentageBps/);
  });

  it('holds blackout ranges with the reason they were imposed', async () => {
    const window = await makeRightsWindow({
      blackouts: [{ startsOn: '2025-05-01', endsOn: '2025-05-14', reason: 'Cannes' }],
    });

    expect(window.blackouts[0].reason).toBe('Cannes');
  });
});
