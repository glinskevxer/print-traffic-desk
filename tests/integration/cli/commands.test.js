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
const {
  makeTitle,
  makeRightsHolder,
  makeRightsWindow,
  makeVenue,
  makePrintElement,
} = require('../../helpers/factories');

function collector() {
  const lines = [];
  return {
    lines,
    out: (line) => lines.push(String(line)),
    err: (line) => lines.push(String(line)),
  };
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

describe('the commands that report and change things', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await useDatabase();
    await clearCollections();
    process.env.MONGO_URI = testDatabaseUri();
    resetConfigForTests();
  });

  it('runs the migrations and then says there is nothing to run', async () => {
    const first = collector();
    expect(await run(['migrate'], first)).toBe(0);
    expect(first.lines.join('\n')).toMatch(/ran \d+ migrations/);

    const second = collector();
    expect(await run(['migrate'], second)).toBe(0);
    expect(second.lines.join('\n')).toContain('nothing to run');
  });

  it('lists what has run and what has not', async () => {
    const before = collector();
    await run(['migrate', '--status'], before);
    expect(before.lines.join('\n')).toContain('pending  001-backfill-element-inspection-interval');

    await run(['migrate'], collector());

    const after = collector();
    await run(['migrate', '--status'], after);
    expect(after.lines.join('\n')).toContain('applied  001-backfill-element-inspection-interval');
  });

  it('changes nothing on a dry run', async () => {
    const { lines, out, err } = collector();

    expect(await run(['migrate', '--dryRun'], { out, err })).toBe(0);
    expect(lines.join('\n')).toContain('would run');

    const status = collector();
    await run(['migrate', '--status'], status);
    expect(status.lines.join('\n')).not.toContain('applied');
  });

  it('says which holds would lapse without lapsing them', async () => {
    const { Booking } = models();
    const title = await makeTitle();
    const venue = await makeVenue();
    await Booking.create({
      reference: 'BK-2025-171-0001',
      title: title._id,
      venue: venue._id,
      screeningAt: new Date('2025-06-20T18:30:00Z'),
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      status: 'held',
      holdExpiresAt: new Date(Date.now() - 1000),
    });

    const dry = collector();
    expect(await run(['lapse-holds', '--dryRun'], dry)).toBe(0);
    expect(dry.lines.join('\n')).toContain('1 holds would lapse');
    expect(dry.lines.join('\n')).toContain('BK-2025-171-0001');

    await useDatabase();
    expect((await models().Booking.findOne({})).status).toBe('held');
  });

  it('chases a leg that should have landed', async () => {
    const home = await makeVenue({ code: 'GB-BER-VAULT' });
    const away = await makeVenue({ code: 'GB-GLA-GFT', city: 'Glasgow' });
    const element = await makePrintElement({ currentLocation: home._id, custodian: home._id });
    await models().Shipment.create({
      element: element._id,
      fromVenue: home._id,
      toVenue: away._id,
      leg: 'outbound',
      service: 'road-freight',
      plannedDispatchOn: '2025-06-10',
      plannedArrivalOn: '2025-06-12',
      status: 'in-transit',
      trackingReference: 'FF-9911',
    });

    const { lines, out, err } = collector();
    expect(await run(['chase', '--asOf', '2025-06-20'], { out, err })).toBe(0);
    expect(lines.join('\n')).toContain('legs that should have landed by 2025-06-20: 1');
    expect(lines.join('\n')).toContain('FF-9911');
  });

  it('lists the prints that are due a look', async () => {
    await makePrintElement({ screeningsSinceInspection: 20, inspectionIntervalScreenings: 6 });

    const { lines, out, err } = collector();
    await run(['chase', '--asOf', '2025-06-20', '--limit', '5'], { out, err });

    expect(lines.join('\n')).toContain('prints due an inspection: 1');
    expect(lines.join('\n')).toContain('20 screenings since a look');
  });

  it('skips a licensor whose period already has a statement', async () => {
    const holder = await makeRightsHolder({ name: 'Park Circus' });
    await models().RoyaltyStatement.create({
      rightsHolder: holder._id,
      periodStartsOn: '2025-06-01',
      periodEndsOn: '2025-06-30',
      currency: 'GBP',
      totalMinor: 0,
    });

    const { lines, out, err } = collector();
    await run(['statements', '--from', '2025-06-01', '--to', '2025-06-30'], { out, err });

    expect(lines.join('\n')).toContain('skipped, a statement for that period already exists');
  });

  it('answers a command that raises a desk error with a message and a code', async () => {
    const { lines, out, err } = collector();

    const code = await run(['expire-windows', '--asOf', 'not-a-date'], { out, err });

    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('printdesk expire-windows:');
  });
});

describe('commands that need nothing but the code', () => {
  it('lists what this build answers without a database', async () => {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:1/nowhere';
    resetConfigForTests();
    const { lines, out, err } = collector();

    expect(await run(['routes', '--grep', '/bookings'], { out, err })).toBe(0);
    expect(lines.join('\n')).toContain('POST');
    expect(lines.join('\n')).toContain('/bookings/runs');
    expect(lines.join('\n')).toMatch(/\d+ routes, \d+ guarded routers/);
  });

  it('lists only the open routes when asked', async () => {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:1/nowhere';
    resetConfigForTests();
    const { lines, out, err } = collector();

    await run(['routes', '--open'], { out, err });

    const text = lines.join('\n');
    expect(text).toContain('/health/live');
    expect(text).not.toContain('/bookings');
  });

  it('says what each route does, from the same table the description uses', async () => {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:1/nowhere';
    resetConfigForTests();
    const { lines, out, err } = collector();

    await run(['routes', '--grep', '/clearance'], { out, err });

    expect(lines.join('\n')).toContain('could this house show this title on this date');
  });
});
