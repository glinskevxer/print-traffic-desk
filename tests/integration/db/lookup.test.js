'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { required, requiredById, requireAll, labelFor } = require('../../../src/db/lookup');
const { makeTitle, makeVenue } = require('../../helpers/factories');
const { NotFoundError } = require('../../../src/lib/errors');

describe('looking a record up', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  afterEach(async () => {
    await clearCollections();
  });

  it('gives every model the label a client sees', () => {
    const { PrintElement, RightsHolder, Title } = models();

    expect(labelFor(PrintElement)).toBe('print element');
    expect(labelFor(RightsHolder)).toBe('rights holder');
    expect(labelFor(Title)).toBe('title');
  });

  it('hands back the record when it is there', async () => {
    const title = await makeTitle();

    const found = await required(models().Title, title.publicId);

    expect(found.publicId).toBe(title.publicId);
  });

  it('raises the not found with the label and the id', async () => {
    let caught;
    try {
      await required(models().PrintElement, 'elem_0000000000000000');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NotFoundError);
    expect(caught.details).toEqual({
      resource: 'print element',
      identifier: 'elem_0000000000000000',
    });
  });

  it('looks up by the mongo id where the caller already holds one', async () => {
    const venue = await makeVenue();

    expect((await requiredById(models().Venue, venue._id)).code).toBe(venue.code);
  });

  it('raises for a mongo id that is not there', async () => {
    const venue = await makeVenue();
    const id = venue._id;
    await models().Venue.deleteOne({ _id: id });

    await expect(requiredById(models().Venue, id)).rejects.toThrow(/venue .* does not exist/);
  });

  it('resolves several references in one go', async () => {
    const title = await makeTitle();
    const venue = await makeVenue();
    const { Title, Venue } = models();

    const resolved = await requireAll([
      ['title', Title, title.publicId],
      ['venue', Venue, venue.publicId],
    ]);

    expect(resolved.title.publicId).toBe(title.publicId);
    expect(resolved.venue.code).toBe(venue.code);
  });

  it('skips a reference the caller did not give', async () => {
    const title = await makeTitle();
    const { Title, Venue } = models();

    const resolved = await requireAll([
      ['title', Title, title.publicId],
      ['venue', Venue, undefined],
    ]);

    expect(Object.keys(resolved)).toEqual(['title']);
  });

  it('names the first thing missing and lists the rest', async () => {
    const { Title, Venue } = models();

    let caught;
    try {
      await requireAll([
        ['title', Title, 'ttl_0000000000000000'],
        ['venue', Venue, 'ven_0000000000000000'],
      ]);
    } catch (err) {
      caught = err;
    }

    expect(caught.details.resource).toBe('title');
    expect(caught.details.alsoMissing).toEqual([
      { resource: 'venue', identifier: 'ven_0000000000000000' },
    ]);
  });
});
