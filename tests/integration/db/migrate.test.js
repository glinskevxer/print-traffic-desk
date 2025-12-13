'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { loadMigrations, pending, migrate, status } = require('../../../src/db/migrate');
const { runWithContext } = require('../../../src/lib/context');
const { makePrintElement, makeVenue } = require('../../helpers/factories');
const { DeskError } = require('../../../src/lib/errors');

function scratchDirectory(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'printdesk-migrations-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), body);
  }
  return directory;
}

describe('migrations', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  it('loads the real migrations in file order', () => {
    const loaded = loadMigrations();

    expect(loaded.length).toBeGreaterThanOrEqual(3);
    expect(loaded[0].id).toBe('001-backfill-element-inspection-interval');
    expect(loaded.map((each) => each.id)).toEqual([...loaded.map((each) => each.id)].sort());
  });

  it('refuses a file that is not a migration', () => {
    const directory = scratchDirectory({ '001-nothing.js': 'module.exports = {};' });

    expect(() => loadMigrations(directory)).toThrow(DeskError);
  });

  it('refuses a migration whose id does not match its file', () => {
    const directory = scratchDirectory({
      '001-one.js': "module.exports = { id: 'something-else', describe: 'x', up: async () => {} };",
    });

    expect(() => loadMigrations(directory)).toThrow(/declares the id something-else/);
  });

  it('runs everything on a fresh database and nothing on a second pass', async () => {
    const first = await migrate();
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(first.every((each) => each.applied)).toBe(true);

    expect(await migrate()).toEqual([]);
    expect(await pending()).toEqual([]);
  });

  it('records what ran, when, and who ran it', async () => {
    await runWithContext({ actor: 'cli:migrate' }, () => migrate());

    const { Migration } = models();
    const record = await Migration.findOne({ id: '001-backfill-element-inspection-interval' });
    expect(record.appliedBy).toBe('cli:migrate');
    expect(record.appliedAt).toBeInstanceOf(Date);
    expect(record.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('changes nothing on a dry run', async () => {
    const planned = await migrate({ dryRun: true });

    expect(planned.every((each) => each.applied === false)).toBe(true);
    expect(await models().Migration.countDocuments()).toBe(0);
  });

  it('backfills the inspection interval on the prints that lack one', async () => {
    const element = await makePrintElement();
    await models().PrintElement.collection.updateOne(
      { _id: element._id },
      { $unset: { inspectionIntervalScreenings: '' } },
    );

    const results = await migrate();

    const backfill = results.find((each) => each.id.startsWith('001'));
    expect(backfill.outcome.updated).toBe(1);
    expect((await models().PrintElement.findById(element._id)).inspectionIntervalScreenings).toBe(
      6,
    );
  });

  it('upper cases the venue codes that were typed in lower case', async () => {
    const venue = await makeVenue({ code: 'GB-LON-PRINCE' });
    await models().Venue.collection.updateOne(
      { _id: venue._id },
      { $set: { code: 'gb-lon-prince' } },
    );

    const results = await migrate();

    expect(results.find((each) => each.id.startsWith('002')).outcome.updated).toBe(1);
    expect((await models().Venue.findById(venue._id)).code).toBe('GB-LON-PRINCE');
  });

  it('drops the legacy hold index only when it is there', async () => {
    const results = await migrate();

    expect(results.find((each) => each.id.startsWith('003')).outcome.dropped).toBe(0);
  });

  it('reports what has run and what has not', async () => {
    const before = await status();
    expect(before.every((each) => each.applied === false)).toBe(true);

    await migrate();

    const after = await status();
    expect(after.every((each) => each.applied === true)).toBe(true);
  });

  it('carries on from where it stopped', async () => {
    const { Migration } = models();
    await Migration.create({
      id: '001-backfill-element-inspection-interval',
      describe: 'already done by hand',
    });

    const results = await migrate();

    expect(results.map((each) => each.id)).not.toContain(
      '001-backfill-element-inspection-interval',
    );
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});
