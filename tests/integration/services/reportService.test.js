'use strict';

const request = require('supertest');
const { buildTestApp, stubOperator } = require('../../helpers/app');
const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { models } = require('../../../src/models');
const {
  makeTitle,
  makeVenue,
  makeRightsHolder,
  makePrintElement,
  makeRightsWindow,
} = require('../../helpers/factories');
const service = require('../../../src/services/reportService');
const bookings = require('../../../src/services/bookingService');
const inspections = require('../../../src/services/inspectionService');

describe('the numbers a licensor meeting asks for', () => {
  let app;
  let holder;
  let title;
  let venue;
  let vault;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    holder = await makeRightsHolder({ name: 'Park Circus' });
    title = await makeTitle({ rightsHolder: holder._id, status: 'bookable', slug: 'daisies' });
    venue = await makeVenue({ code: 'GB-LON-PRINCE', seats: 288 });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
  });

  async function settledScreening(localDate) {
    await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    const { booking } = await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate,
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });
    await bookings.confirmBooking(booking.publicId);
    await bookings.reportBoxOffice(booking.publicId, {
      grossMinor: 184000,
      currency: 'GBP',
      admissions: 210,
    });
    await bookings.settleBooking(booking.publicId, '2025-07-01');
    return booking;
  }

  it('has nothing to report with no live licences', async () => {
    const report = await service.licenceUtilisation({ asOf: '2025-06-01' });

    expect(report.windows).toEqual([]);
  });

  it('says how much of a capped licence is left', async () => {
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      maxScreenings: 10,
      screeningsUsed: 4,
    });

    const report = await service.licenceUtilisation({ asOf: '2025-06-01' });

    expect(report.windows[0]).toMatchObject({
      title: 'daisies',
      holder: 'Park Circus',
      cap: 10,
      used: 4,
      remaining: 6,
      usedShare: 40,
    });
  });

  it('leaves an uncapped licence uncapped rather than guessing a share', async () => {
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });

    const report = await service.licenceUtilisation({ asOf: '2025-06-01' });

    expect(report.windows[0].cap).toBeNull();
    expect(report.windows[0].usedShare).toBeNull();
    expect(report.windows[0].atRisk).toBe(false);
  });

  it('flags a licence with screenings left and no time to use them', async () => {
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      endsOn: '2025-06-20',
      maxScreenings: 10,
      screeningsUsed: 1,
    });

    const report = await service.licenceUtilisation({ asOf: '2025-06-01' });

    expect(report.windows[0].atRisk).toBe(true);
    expect(report.windows[0].daysLeft).toBe(19);
    expect(report.atRisk).toBe(1);
  });

  it('counts the licences nobody has programmed at all', async () => {
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id, maxScreenings: 5 });

    expect((await service.licenceUtilisation({ asOf: '2025-06-01' })).unused).toBe(1);
  });

  it('narrows to one licensor', async () => {
    const other = await makeRightsHolder({ name: 'BFI National Archive', kind: 'archive' });
    const otherTitle = await makeTitle({ rightsHolder: other._id, slug: 'el-sur' });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
    await makeRightsWindow({ title: otherTitle._id, rightsHolder: other._id });

    const report = await service.licenceUtilisation({
      asOf: '2025-06-01',
      rightsHolderId: other.publicId,
    });

    expect(report.windows).toHaveLength(1);
    expect(report.windows[0].holder).toBe('BFI National Archive');
  });

  it('adds up what a licensor titles did', async () => {
    await makeRightsWindow({
      title: title._id,
      rightsHolder: holder._id,
      terms: { kind: 'percentage', currency: 'GBP', percentageBps: 3500 },
    });
    await settledScreening('2025-06-20');
    await settledScreening('2025-06-21');

    const summary = await service.licensorSummary({
      rightsHolderId: holder.publicId,
      from: '2025-06-01',
      to: '2025-06-30',
    });

    expect(summary.totals).toEqual({
      screenings: 2,
      admissions: 420,
      grossMinor: 368000,
      royaltyMinor: 128800,
    });
    expect(summary.titles[0]).toMatchObject({ title: 'daisies', averageAdmissions: 210 });
    expect(summary.currency).toBe('GBP');
  });

  it('reports nothing for a licensor with no licences at all', async () => {
    const quiet = await makeRightsHolder({ name: 'Quiet Films' });

    const summary = await service.licensorSummary({
      rightsHolderId: quiet.publicId,
      from: '2025-06-01',
      to: '2025-06-30',
    });

    expect(summary.titles).toEqual([]);
    expect(summary.totals.screenings).toBe(0);
  });

  it('lists the licences about to lapse, soonest first', async () => {
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id, endsOn: '2025-06-10' });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id, endsOn: '2025-07-10' });
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id, endsOn: '2026-07-10' });

    const lapsing = await service.lapsingSoon({ asOf: '2025-06-01', withinDays: 60 });

    expect(lapsing.map((each) => each.endsOn)).toEqual(['2025-06-10', '2025-07-10']);
    expect(lapsing[0].daysLeft).toBe(9);
  });

  it('answers all three over http', async () => {
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id, maxScreenings: 4 });

    const utilisation = await request(app)
      .get('/reports/licence-utilisation?asOf=2025-06-01')
      .expect(200);
    expect(utilisation.body.windows).toHaveLength(1);

    const summary = await request(app)
      .get(
        `/reports/licensor-summary?rightsHolderId=${holder.publicId}&from=2025-06-01&to=2025-06-30`,
      )
      .expect(200);
    expect(summary.body.holder).toBe('Park Circus');

    const lapsing = await request(app)
      .get('/reports/lapsing-licences?asOf=2025-06-01&withinDays=365')
      .expect(200);
    expect(lapsing.body.windows).toHaveLength(1);
  });

  it('refuses a period that ends before it starts', async () => {
    await request(app)
      .get(
        `/reports/licensor-summary?rightsHolderId=${holder.publicId}&from=2025-07-01&to=2025-06-01`,
      )
      .expect(400);
  });

  it('does not aggregate a booking that has not settled', async () => {
    await makeRightsWindow({ title: title._id, rightsHolder: holder._id });
    await makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      status: 'available',
    });
    await bookings.requestBooking({
      titleId: title.publicId,
      venueId: venue.publicId,
      localDate: '2025-06-20',
      localTime: '19:30',
      exhibitionType: 'repertory',
      today: '2025-05-15',
    });

    const summary = await service.licensorSummary({
      rightsHolderId: holder.publicId,
      from: '2025-06-01',
      to: '2025-06-30',
    });

    expect(summary.totals.screenings).toBe(0);
    expect(await models().Booking.countDocuments()).toBe(1);
  });
});

describe('the state of the shelf', () => {
  let app;
  let holder;
  let title;
  let vault;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    holder = await makeRightsHolder({ name: 'BFI National Archive', kind: 'archive' });
    title = await makeTitle({ rightsHolder: holder._id, slug: 'the-red-shoes' });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
  });

  async function shelve(overrides = {}) {
    return makePrintElement({
      title: title._id,
      owner: holder._id,
      currentLocation: vault._id,
      custodian: vault._id,
      ...overrides,
    });
  }

  it('counts an empty shelf as empty', async () => {
    const summary = await service.shelfSummary();

    expect(summary.total).toBe(0);
    expect(summary.byStatus).toEqual({});
    expect(summary.dueInspection).toBe(0);
  });

  it('counts by status, grade and gauge', async () => {
    await shelve({ status: 'available', conditionGrade: 'A', gauge: '35mm' });
    await shelve({ status: 'available', conditionGrade: 'C', gauge: '16mm' });
    await shelve({ status: 'quarantined', conditionGrade: 'D', gauge: '35mm' });

    const summary = await service.shelfSummary();

    expect(summary.total).toBe(3);
    expect(summary.byStatus).toEqual({ available: 2, quarantined: 1 });
    expect(summary.byGrade).toEqual({ A: 1, C: 1, D: 1 });
    expect(summary.byGauge).toEqual({ '16mm': 1, '35mm': 2 });
  });

  it('calls a print nobody has graded ungraded rather than unknown', async () => {
    await shelve({ conditionGrade: null });

    expect((await service.shelfSummary()).byGrade).toEqual({ ungraded: 1 });
  });

  it('counts what is due a look', async () => {
    await shelve({ screeningsSinceInspection: 30, inspectionIntervalScreenings: 6 });
    await shelve({ screeningsSinceInspection: 1, inspectionIntervalScreenings: 6 });

    expect((await service.shelfSummary()).dueInspection).toBe(1);
  });

  it('narrows to one title', async () => {
    const other = await makeTitle({ rightsHolder: holder._id, slug: 'daisies' });
    await shelve({ status: 'available' });
    await makePrintElement({ title: other._id, owner: holder._id, status: 'available' });

    const summary = await service.shelfSummary({ titleId: title.publicId });

    expect(summary.total).toBe(1);
  });

  it('answers over http', async () => {
    await shelve({ status: 'available', conditionGrade: 'B' });

    const res = await request(app).get('/reports/shelf').expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.byGrade).toEqual({ B: 1 });
  });
});

describe('which prints are getting worse', () => {
  let app;
  let holder;
  let title;
  let vault;

  beforeAll(async () => {
    await useDatabase();
    ({ app } = buildTestApp());
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
    holder = await makeRightsHolder({ name: 'BFI National Archive', kind: 'archive' });
    title = await makeTitle({ rightsHolder: holder._id });
    vault = await makeVenue({ code: 'GB-BER-VAULT', city: 'Berkhamsted' });
  });

  async function inspect(element, when, findings) {
    return inspections.recordInspection(element.publicId, {
      inspector: 'R. Fitzgerald',
      kind: 'routine',
      inspectedAt: new Date(when),
      findings,
    });
  }

  it('needs more than one look to call anything a trend', async () => {
    const element = await makePrintElement({
      title: title._id,
      custodian: vault._id,
      currentLocation: vault._id,
    });
    await inspect(element, '2025-02-01T10:00:00Z', []);

    const trend = await service.conditionTrend({ from: '2025-01-01', to: '2025-12-31' });

    expect(trend.prints).toEqual([]);
  });

  it('says how many grades a print has lost', async () => {
    const element = await makePrintElement({
      title: title._id,
      custodian: vault._id,
      currentLocation: vault._id,
      footage: 2000,
    });
    await inspect(element, '2025-02-01T10:00:00Z', []);
    await inspect(element, '2025-09-01T10:00:00Z', [
      { reel: 1, code: 'PERF-TEAR', severity: 'severe' },
      { reel: 2, code: 'SPLICE-WEAK', severity: 'severe' },
      { reel: 3, code: 'BRITTLE', severity: 'severe' },
      { reel: 4, code: 'VINEGAR', severity: 'severe' },
    ]);

    const trend = await service.conditionTrend({ from: '2025-01-01', to: '2025-12-31' });

    expect(trend.prints[0]).toMatchObject({ from: 'A', to: 'D', inspections: 2 });
    expect(trend.prints[0].gradesLost).toBe(3);
    expect(trend.prints[0].days).toBe(212);
    expect(trend.worsening).toBe(1);
  });

  it('counts a print that held its grade as steady', async () => {
    const element = await makePrintElement({
      title: title._id,
      custodian: vault._id,
      currentLocation: vault._id,
    });
    await inspect(element, '2025-02-01T10:00:00Z', []);
    await inspect(element, '2025-09-01T10:00:00Z', []);

    const trend = await service.conditionTrend({ from: '2025-01-01', to: '2025-12-31' });

    expect(trend.steady).toBe(1);
    expect(trend.worsening).toBe(0);
  });

  it('leaves out inspections outside the period', async () => {
    const element = await makePrintElement({
      title: title._id,
      custodian: vault._id,
      currentLocation: vault._id,
    });
    await inspect(element, '2024-02-01T10:00:00Z', []);
    await inspect(element, '2025-09-01T10:00:00Z', []);

    const trend = await service.conditionTrend({ from: '2025-01-01', to: '2025-12-31' });

    expect(trend.prints).toEqual([]);
  });

  it('puts the worst first', async () => {
    const steady = await makePrintElement({
      title: title._id,
      custodian: vault._id,
      currentLocation: vault._id,
    });
    const failing = await makePrintElement({
      title: title._id,
      custodian: vault._id,
      currentLocation: vault._id,
      footage: 2000,
    });
    await inspect(steady, '2025-02-01T10:00:00Z', []);
    await inspect(steady, '2025-09-01T10:00:00Z', []);
    await inspect(failing, '2025-02-01T10:00:00Z', []);
    await inspect(failing, '2025-09-01T10:00:00Z', [
      { reel: 1, code: 'PERF-TEAR', severity: 'severe' },
    ]);

    const trend = await service.conditionTrend({ from: '2025-01-01', to: '2025-12-31' });

    expect(trend.prints[0].barcode).toBe(failing.barcode);
  });

  it('answers over http and needs an archivist', async () => {
    const res = await request(app)
      .get('/reports/condition-trend?from=2025-01-01&to=2025-12-31')
      .expect(200);

    expect(res.body.prints).toEqual([]);

    const { app: viewer } = buildTestApp({ operator: stubOperator({ role: 'viewer' }) });
    await request(viewer).get('/reports/condition-trend?from=2025-01-01&to=2025-12-31').expect(403);
  });
});
