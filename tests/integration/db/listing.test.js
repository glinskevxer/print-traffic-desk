'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const {
  listWith,
  guardDuplicates,
  isDuplicateKey,
  indexNameOf,
} = require('../../../src/db/listing');
const { makeTitle, makeRightsHolder } = require('../../helpers/factories');
const { ConflictError, ValidationError } = require('../../../src/lib/errors');

describe('the shape every list call shares', () => {
  let Title;
  let holder;

  beforeAll(async () => {
    ({ Title } = await useDatabase());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    holder = await makeRightsHolder();
    for (const slug of ['a-nos-amours', 'black-narcissus', 'celine-and-julie']) {
      await makeTitle({ slug, rightsHolder: holder._id });
    }
  });

  it('pages on the sort field the service named', async () => {
    const page = await listWith(Title, { query: { limit: 2 }, sortField: 'slug' });

    expect(page.items.map((each) => each.slug)).toEqual(['a-nos-amours', 'black-narcissus']);
    expect(page.hasMore).toBe(true);
  });

  it('lets the caller override the sort field', async () => {
    const page = await listWith(Title, {
      query: { sortBy: 'slug', order: 'desc', limit: 1 },
      sortField: 'createdAt',
    });

    expect(page.items[0].slug).toBe('celine-and-julie');
  });

  it('narrows to the filter the service built', async () => {
    const page = await listWith(Title, {
      filter: { slug: 'daisies' },
      query: {},
      sortField: 'slug',
    });

    expect(page.items).toEqual([]);
  });

  it('carries a cursor through', async () => {
    const first = await listWith(Title, { query: { limit: 1 }, sortField: 'slug' });
    const second = await listWith(Title, {
      query: { limit: 1, cursor: first.nextCursor },
      sortField: 'slug',
    });

    expect(second.items[0].slug).toBe('black-narcissus');
  });
});

describe('turning a duplicate key into something a client can read', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('hands the answer back when there is no collision', async () => {
    const result = await guardDuplicates(async () => 'made it', { message: 'x' });

    expect(result).toBe('made it');
  });

  it('turns a collision into a conflict with the message the service wrote', async () => {
    await makeRightsHolder({ name: 'Park Circus' });

    let caught;
    try {
      await guardDuplicates(() => makeRightsHolder({ name: 'Park Circus' }), {
        message: 'Park Circus is already on file',
        details: { name: 'Park Circus' },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    expect(caught.message).toBe('Park Circus is already on file');
    expect(caught.details.name).toBe('Park Circus');
    expect(caught.details.index).toBe('name');
  });

  it('leaves every other failure exactly as it was', async () => {
    await expect(
      guardDuplicates(
        async () => {
          throw new ValidationError('not a duplicate', []);
        },
        { message: 'should not be used' },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('knows a duplicate key from anything else', () => {
    expect(isDuplicateKey({ code: 11000 })).toBe(true);
    expect(isDuplicateKey({ code: 121 })).toBe(false);
    expect(isDuplicateKey(null)).toBe(false);
  });

  it('names the index that fired, however the driver reported it', () => {
    expect(indexNameOf({ keyPattern: { code: 1 } })).toBe('code');
    expect(indexNameOf({ keyPattern: { a: 1, b: 1 } })).toBe('a+b');
    expect(indexNameOf({ message: 'E11000 duplicate key error index: db.coll.$slug_1 dup' })).toBe(
      'db.coll.$slug_1',
    );
    expect(indexNameOf({ message: 'no index here' })).toBeNull();
  });
});
