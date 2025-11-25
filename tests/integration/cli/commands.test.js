'use strict';

const {
  useDatabase,
  closeTestConnection,
  clearCollections,
  testDatabaseUri,
} = require('../../helpers/db');
const { models } = require('../../../src/models');
const { resetConfigForTests } = require('../../../src/config/env');
const { run, usage, BY_NAME } = require('../../../src/cli/index');
const { makeTitle, makeRightsHolder, makeRightsWindow } = require('../../helpers/factories');

function collector() {
  const lines = [];
  return { lines, out: (line) => lines.push(String(line)), err: (line) => lines.push(String(line)) };
}

describe('the command line', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
    resetConfigForTests();
  });

  beforeEach(async () => {
    // Every command closes the connection when it finishes, the way it does on
    // a real terminal, so each test opens its own again.
    await useDatabase();
    await clearCollections();
    process.env.MONGO_URI = testDatabaseUri();
    resetConfigForTests();
  });

  it('lists its commands when asked for nothing', async () => {
    const { lines, out, err } = collector();

    expect(await run([], { out, err })).toBe(0);
    expect(lines.join('\n')).toContain('printdesk <command>');
    expect(usage()).toContain('lapse-holds');
  });

  it('refuses a command it does not have', async () => {
    const { lines, out, err } = collector();

    expect(await run(['fly-to-the-moon'], { out, err })).toBe(64);
    expect(lines.join('\n')).toContain('there is no fly-to-the-moon command');
  });

  it('prints the help for one command without connecting', async () => {
    const { lines, out, err } = collector();

    expect(await run(['statements', '--help'], { out, err })).toBe(0);
    expect(lines.join('\n')).toContain('--from <string>');
  });

  it('refuses a command missing an option it needs', async () => {
    const { lines, out, err } = collector();

    expect(await run(['statements', '--from', '2025-06-01'], { out, err })).toBe(64);
    expect(lines.join('\n')).toContain('--to is needed');
  });

  it('gives every command a name and a description', () => {
    for (const command of BY_NAME.values()) {
      expect(command.name).toEqual(expect.any(String));
      expect(command.describe.length).toBeGreaterThan(10);
      expect(typeof command.run).toBe('function');
    }
  });

  it('seeds a fresh desk with something to book', async () => {
    const { lines, out, err } = collector();

    expect(await run(['seed'], { out, err })).toBe(0);

    await useDatabase();
    const { Title, Venue, PrintElement } = models();
    expect(await Title.countDocuments()).toBe(3);
    expect(await Venue.countDocuments()).toBe(3);
    expect(await PrintElement.countDocuments()).toBe(3);
    expect(lines.join('\n')).toContain('print elements added: 3');
  });

  it('seeds twice without doubling anything', async () => {
    const { out, err } = collector();
    await run(['seed'], { out, err });
    await run(['seed'], { out, err });

    await useDatabase();
    expect(await models().Title.countDocuments()).toBe(3);
  });

  it('builds the indexes on demand', async () => {
    const { lines, out, err } = collector();

    expect(await run(['reindex'], { out, err })).toBe(0);
    expect(lines.join('\n')).toMatch(/synced indexes for \d+ collections/);
  });

  it('expires the licences that have run out', async () => {
    const holder = await makeRightsHolder();
    const title = await makeTitle({ rightsHolder: holder._id });
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      startsOn: '2024-01-01',
      endsOn: '2024-12-31',
      status: 'active',
    });
    const { lines, out, err } = collector();

    expect(await run(['expire-windows', '--asOf', '2025-06-01'], { out, err })).toBe(0);
    expect(lines.join('\n')).toContain('expired 1 licences as of 2025-06-01');
  });

  it('says what is late and what is due a look', async () => {
    const { lines, out, err } = collector();

    expect(await run(['chase', '--asOf', '2025-06-20'], { out, err })).toBe(0);
    expect(lines.join('\n')).toContain('legs that should have landed by 2025-06-20: 0');
    expect(lines.join('\n')).toContain('prints due an inspection: 0');
  });

  it('lapses nothing when nothing has run out', async () => {
    const { lines, out, err } = collector();

    expect(await run(['lapse-holds'], { out, err })).toBe(0);
    expect(lines.join('\n')).toContain('lapsed 0 holds');
  });

  it('builds no statement for a period with no screenings in it', async () => {
    await makeRightsHolder({ name: 'Park Circus' });
    const { lines, out, err } = collector();

    expect(
      await run(['statements', '--from', '2025-06-01', '--to', '2025-06-30'], { out, err }),
    ).toBe(0);
    expect(lines.join('\n')).toContain('built 0 statements');
  });
});
