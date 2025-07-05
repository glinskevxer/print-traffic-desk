'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { makeTitle, makeRightsHolder } = require('../../helpers/factories');
const { paginate, pageEnvelope } = require('../../../src/lib/pagination');

describe('paging a collection', () => {
  let Title;
  let holderId;

  beforeAll(async () => {
    ({ Title } = await useDatabase());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    holderId = (await makeRightsHolder())._id;
    for (const slug of ['a-nos-amours', 'black-narcissus', 'celine-and-julie', 'daisies', 'el-sur']) {
      // eslint-disable-next-line no-await-in-loop
      await makeTitle({ slug, rightsHolder: holderId });
    }
  });

  it('walks the whole collection without repeating or dropping a row', async () => {
    const seen = [];
    let cursor;
    let guard = 0;

    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await paginate(Title, { sortField: 'slug', limit: 2, cursor });
      seen.push(...page.items.map((item) => item.slug));
      cursor = page.nextCursor;
      guard += 1;
    } while (cursor && guard < 10);

    expect(seen).toEqual([
      'a-nos-amours',
      'black-narcissus',
      'celine-and-julie',
      'daisies',
      'el-sur',
    ]);
  });

  it('reports there is no more once the page is short', async () => {
    const page = await paginate(Title, { sortField: 'slug', limit: 50 });

    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('walks backwards when asked', async () => {
    const page = await paginate(Title, { sortField: 'slug', order: 'desc', limit: 2 });

    expect(page.items.map((i) => i.slug)).toEqual(['el-sur', 'daisies']);
    expect(page.hasMore).toBe(true);
  });

  it('does not skip a row inserted behind the cursor', async () => {
    const first = await paginate(Title, { sortField: 'slug', limit: 2 });
    await makeTitle({ slug: 'aaa-inserted-behind', rightsHolder: holderId });

    const second = await paginate(Title, { sortField: 'slug', limit: 10, cursor: first.nextCursor });

    expect(second.items.map((i) => i.slug)).toEqual(['celine-and-julie', 'daisies', 'el-sur']);
  });

  it('pages a field full of ties without losing a row', async () => {
    await clearCollections();
    const holder = await makeRightsHolder();
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await makeTitle({ slug: `tie-${i}`, year: 1948, rightsHolder: holder._id });
    }

    const seen = [];
    let cursor;
    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await paginate(Title, { sortField: 'year', limit: 2, cursor });
      seen.push(...page.items.map((item) => item.slug));
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(6);
  });

  it('narrows to a filter before it pages', async () => {
    const page = await paginate(Title, {
      filter: { slug: { $in: ['daisies', 'el-sur'] } },
      sortField: 'slug',
      limit: 10,
    });

    expect(page.items.map((i) => i.slug)).toEqual(['daisies', 'el-sur']);
  });

  it('wraps a page in the envelope every list endpoint returns', async () => {
    const page = await paginate(Title, { sortField: 'slug', limit: 2 });
    const envelope = pageEnvelope(page);

    expect(envelope.items).toHaveLength(2);
    expect(envelope.items[0].id).toMatch(/^ttl_/);
    expect(envelope.page.hasMore).toBe(true);
    expect(typeof envelope.page.nextCursor).toBe('string');
  });

  it('rejects a limit outside the range before it touches the database', async () => {
    const { Title: Model } = models();

    await expect(paginate(Model, { limit: 5000 })).rejects.toThrow(/between 1 and 200/);
  });
});
