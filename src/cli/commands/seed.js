'use strict';

const { models } = require('../../models');
const authService = require('../../services/authService');

/**
 * Enough of a desk to book something on. Not fixtures for the tests: this is
 * what a new install gets so somebody can see the thing work before they type
 * a real catalogue in.
 */

const HOLDERS = [
  {
    name: 'Park Circus',
    kind: 'distributor',
    remittanceCurrency: 'GBP',
    territoriesRepresented: ['GB', 'IE'],
  },
  {
    name: 'BFI National Archive',
    kind: 'archive',
    remittanceCurrency: 'GBP',
    territoriesRepresented: ['GB'],
  },
];

const VENUES = [
  {
    code: 'GB-LON-PRINCE',
    name: 'Prince Charles Cinema',
    city: 'London',
    seats: 288,
    booth: {
      gauges: ['35mm', '70mm'],
      soundFormats: ['optical-mono', 'dolby-sr'],
      reelCapacity: 8,
    },
  },
  {
    code: 'GB-GLA-GFT',
    name: 'Glasgow Film Theatre',
    city: 'Glasgow',
    seats: 404,
    booth: { gauges: ['35mm', '16mm'], soundFormats: ['optical-mono', 'dolby-a'], reelCapacity: 6 },
  },
  {
    code: 'GB-BER-VAULT',
    name: 'Berkhamsted Film Store',
    city: 'Berkhamsted',
    seats: 1,
    booth: { gauges: ['35mm', '16mm'], soundFormats: ['optical-mono'], nitrateCertified: true },
  },
];

const TITLES = [
  {
    slug: 'the-red-shoes',
    title: 'The Red Shoes',
    year: 1948,
    runtimeMinutes: 135,
    director: 'Michael Powell',
  },
  { slug: 'daisies', title: 'Daisies', year: 1966, runtimeMinutes: 74, director: 'Vera Chytilova' },
  { slug: 'el-sur', title: 'El Sur', year: 1983, runtimeMinutes: 95, director: 'Victor Erice' },
];

async function seedHolders(RightsHolder) {
  const created = [];
  for (const holder of HOLDERS) {
    // eslint-disable-next-line no-await-in-loop
    const record = await RightsHolder.findOneAndUpdate(
      { name: holder.name },
      {
        $setOnInsert: {
          ...holder,
          contacts: [
            { name: 'Bookings', email: `bookings@${holder.name.split(' ')[0].toLowerCase()}.test` },
          ],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    created.push(record);
  }
  return created;
}

module.exports = {
  name: 'seed',
  describe: 'put a small catalogue and a first operator on a fresh desk',
  options: {
    adminEmail: { type: 'string', describe: 'create an admin operator with this address' },
    adminPassword: { type: 'string', describe: 'the password for that operator' },
  },
  async run({ options, out }) {
    const { RightsHolder, Title, Venue, PrintElement } = models();

    const holders = await seedHolders(RightsHolder);
    out(`rights holders: ${holders.length}`);

    const venues = await Promise.all(
      VENUES.map((venue) =>
        Venue.findOneAndUpdate(
          { code: venue.code },
          {
            $setOnInsert: {
              ...venue,
              territory: 'GB',
              timezone: 'Europe/London',
              boxOfficeCurrency: 'GBP',
              address: {
                line1: `1 ${venue.city} Street`,
                city: venue.city,
                postcode: 'AA1 1AA',
                territory: 'GB',
              },
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ),
      ),
    );
    out(`venues: ${venues.length}`);

    const vault = venues.find((venue) => venue.code === 'GB-BER-VAULT');
    let barcode = 100000;
    let elements = 0;

    for (const title of TITLES) {
      // eslint-disable-next-line no-await-in-loop
      const record = await Title.findOneAndUpdate(
        { slug: title.slug },
        {
          $setOnInsert: {
            slug: title.slug,
            title: title.title,
            year: title.year,
            runtimeMinutes: title.runtimeMinutes,
            countries: ['GB'],
            credits: [{ name: title.director, role: 'director' }],
            rightsHolder: holders[0]._id,
            status: 'bookable',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      barcode += 1;
      // eslint-disable-next-line no-await-in-loop
      const existing = await PrintElement.countDocuments({ title: record._id });
      if (existing > 0) continue;

      // eslint-disable-next-line no-await-in-loop
      await PrintElement.create({
        barcode: `PE-${String(barcode).padStart(6, '0')}`,
        title: record._id,
        owner: holders[0]._id,
        custodian: vault._id,
        currentLocation: vault._id,
        kind: 'release-print',
        gauge: '35mm',
        baseStock: 'polyester',
        aspectRatio: '1.37:1',
        soundFormat: 'optical-mono',
        footage: Math.round(title.runtimeMinutes * 90),
        reelCount: Math.max(1, Math.round(title.runtimeMinutes / 20)),
        status: 'available',
        conditionGrade: 'B',
      });
      elements += 1;
    }
    out(`titles: ${TITLES.length}, print elements added: ${elements}`);

    if (options.adminEmail && options.adminPassword) {
      await authService.createOperator({
        email: options.adminEmail,
        name: 'Desk administrator',
        role: 'admin',
        password: options.adminPassword,
      });
      out(`admin operator: ${options.adminEmail}`);
    }

    return 0;
  },
};
