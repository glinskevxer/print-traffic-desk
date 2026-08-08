'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const { makeRightsHolder } = require('../../helpers/factories');
const { resetConfigForTests } = require('../../../src/config/env');
const titles = require('../../../src/services/titleService');
const { run } = require('../../../src/cli/index');

const HEADER = 'title,year,slug,director,countries,languages,runtimeMinutes\n';
const DAISIES = 'Daisies,1966,daisies,Vera Chytilova,CZ,cs,74\n';
const RED_SHOES =
  '"The Red Shoes",1948,the-red-shoes,Michael Powell|Emeric Pressburger,GB,en,135\n';

function collector() {
  const lines = [];
  return {
    lines,
    out: (line) => lines.push(String(line)),
    err: (line) => lines.push(String(line)),
  };
}

describe('taking a catalogue export', () => {
  let holder;

  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
    resetConfigForTests();
  });

  beforeEach(async () => {
    await useDatabase();
    await clearCollections();
    holder = await makeRightsHolder({ name: 'Park Circus' });
  });

  it('puts every film on file with what the sheet said', async () => {
    const outcome = await titles.importTitles(HEADER + DAISIES + RED_SHOES, {
      rightsHolderId: holder.publicId,
    });

    expect(outcome).toMatchObject({ read: 2, added: 2, skipped: [] });
    const daisies = await models().Title.findOne({ slug: 'daisies' });
    expect(daisies.year).toBe(1966);
    expect(daisies.countries).toEqual(['CZ']);
    expect(daisies.originalLanguages).toEqual(['cs']);
    expect(daisies.runtimeMinutes).toBe(74);
  });

  it('reads two directors separated the way a spreadsheet does it', async () => {
    await titles.importTitles(HEADER + RED_SHOES, { rightsHolderId: holder.publicId });

    const film = await models().Title.findOne({ slug: 'the-red-shoes' });
    expect(film.directors).toEqual(['Michael Powell', 'Emeric Pressburger']);
  });

  it('slugs a film the sheet did not slug', async () => {
    await titles.importTitles('title,year\nCeline and Julie Go Boating,1974\n', {
      rightsHolderId: holder.publicId,
    });

    expect(await models().Title.findOne({ slug: 'celine-and-julie-go-boating-1974' })).toBeTruthy();
  });

  it('leaves a film already on file exactly as it is', async () => {
    await titles.importTitles(HEADER + DAISIES, { rightsHolderId: holder.publicId });

    const outcome = await titles.importTitles(
      HEADER + 'Daisies,1999,daisies,Somebody Else,CZ,cs,10\n',
      { rightsHolderId: holder.publicId },
    );

    expect(outcome).toMatchObject({ added: 0, skipped: ['daisies'] });
    expect((await models().Title.findOne({ slug: 'daisies' })).year).toBe(1966);
  });

  it('refuses a file missing the columns it needs', async () => {
    await expect(
      titles.importTitles('name,made\nDaisies,1966\n', { rightsHolderId: holder.publicId }),
    ).rejects.toThrow(/missing columns/);
  });

  it('names the line of every row it cannot read, and writes none of them', async () => {
    let caught;
    try {
      await titles.importTitles(HEADER + DAISIES + ',nineteen,,,,,\n', {
        rightsHolderId: holder.publicId,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught.details.rows[0].line).toBe(3);
    expect(caught.details.rows[0].problems).toEqual(
      expect.arrayContaining(['title is missing', 'nineteen is not a year a film was made in']),
    );
    expect(await models().Title.countDocuments()).toBe(0);
  });

  it('changes nothing on a dry run', async () => {
    const outcome = await titles.importTitles(HEADER + DAISIES, {
      rightsHolderId: holder.publicId,
      dryRun: true,
    });

    expect(outcome).toMatchObject({ read: 1, added: 0, wouldAdd: 1, dryRun: true });
    expect(await models().Title.countDocuments()).toBe(0);
  });

  it('runs from the command line against a file', async () => {
    const file = path.join(os.tmpdir(), `printdesk-titles-${process.pid}.csv`);
    fs.writeFileSync(file, HEADER + DAISIES + RED_SHOES);
    const { lines, out, err } = collector();

    expect(
      await run(['import-titles', '--file', file, '--holder', holder.publicId], { out, err }),
    ).toBe(0);

    expect(lines.join('\n')).toContain('the-red-shoes');
    fs.unlinkSync(file);
  });

  it('says so when there is no file there', async () => {
    const { lines, out, err } = collector();

    expect(
      await run(['import-titles', '--file', '/nowhere/at/all.csv', '--holder', holder.publicId], {
        out,
        err,
      }),
    ).toBe(66);
    expect(lines.join('\n')).toContain('there is no file at');
  });
});
