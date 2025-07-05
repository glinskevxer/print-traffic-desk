'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');

let Title;
let RightsHolder;

async function makeHolder(overrides = {}) {
  return RightsHolder.create({
    name: 'Curzon Artificial Eye',
    kind: 'distributor',
    remittanceCurrency: 'GBP',
    territoriesRepresented: ['GB', 'IE'],
    contacts: [{ name: 'Bookings desk', email: 'bookings@example.test', role: 'bookings' }],
    ...overrides,
  });
}

describe('title and rights holder models', () => {
  beforeAll(async () => {
    ({ Title, RightsHolder } = await useDatabase());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  afterEach(async () => {
    await clearCollections();
  });

  it('stamps a prefixed public id on save', async () => {
    const holder = await makeHolder();

    expect(holder.publicId).toMatch(/^rh_[0-9A-Z]{16}$/);
  });

  it('hides the mongo id from the serialised form', async () => {
    const holder = await makeHolder();
    const json = holder.toJSON();

    expect(json.id).toBe(holder.publicId);
    expect(json._id).toBeUndefined();
    expect(json.publicId).toBeUndefined();
  });

  it('refuses two rights holders with the same name whatever the case', async () => {
    await makeHolder();

    await expect(makeHolder({ name: 'curzon artificial eye' })).rejects.toThrow(/duplicate key/);
  });

  it('refuses a territory that is not a code the desk knows', async () => {
    await expect(makeHolder({ territoriesRepresented: ['Britain'] })).rejects.toThrow(
      /ISO 3166-1 alpha-2/,
    );
  });

  it('refuses a contact address that is not an address', async () => {
    await expect(
      makeHolder({ contacts: [{ name: 'Desk', email: 'bookings at example', role: 'bookings' }] }),
    ).rejects.toThrow(/not an address/);
  });

  it('picks the contact for a role and falls back to the first', async () => {
    const holder = await makeHolder({
      contacts: [
        { name: 'Bookings', email: 'b@example.test', role: 'bookings' },
        { name: 'Accounts', email: 'a@example.test', role: 'accounts' },
      ],
    });

    expect(holder.contactFor('accounts').name).toBe('Accounts');
    expect(holder.contactFor('legal').name).toBe('Bookings');
  });

  it('stores a title against its rights holder', async () => {
    const holder = await makeHolder();
    const title = await Title.create({
      slug: 'the-red-shoes',
      title: 'The Red Shoes',
      year: 1948,
      countries: ['GB'],
      originalLanguages: ['en'],
      runtimeMinutes: 135,
      credits: [
        { name: 'Michael Powell', role: 'director' },
        { name: 'Emeric Pressburger', role: 'director' },
        { name: 'Jack Cardiff', role: 'cinematographer' },
      ],
      rightsHolder: holder._id,
    });

    expect(title.publicId).toMatch(/^ttl_/);
    expect(title.directors).toEqual(['Michael Powell', 'Emeric Pressburger']);
    expect(title.displayTitle).toBe('The Red Shoes (1948)');
    expect(title.isBookable()).toBe(false);
  });

  it('refuses a slug that is not lower case hyphenated', async () => {
    const holder = await makeHolder();

    await expect(
      Title.create({ slug: 'The Red Shoes', title: 'x', year: 1948, rightsHolder: holder._id }),
    ).rejects.toThrow(/lower case words joined by hyphens/);
  });

  it('refuses a year before cinema existed', async () => {
    const holder = await makeHolder();

    await expect(
      Title.create({ slug: 'ur-film', title: 'x', year: 1600, rightsHolder: holder._id }),
    ).rejects.toThrow(/year/);
  });

  it('will not store a title without a rights holder', async () => {
    await expect(Title.create({ slug: 'orphan', title: 'Orphan', year: 1970 })).rejects.toThrow(
      /rightsHolder/,
    );
  });

  it('keeps slugs unique', async () => {
    const holder = await makeHolder();
    const base = { slug: 'peeping-tom', title: 'Peeping Tom', year: 1960, rightsHolder: holder._id };
    await Title.create(base);

    await expect(Title.create(base)).rejects.toThrow(/duplicate key/);
  });

  it('finds a record by its public id', async () => {
    const holder = await makeHolder();

    const found = await RightsHolder.byPublicId(holder.publicId);

    expect(found.name).toBe('Curzon Artificial Eye');
    expect(await RightsHolder.byPublicId('rh_0000000000000000')).toBeNull();
  });
});
