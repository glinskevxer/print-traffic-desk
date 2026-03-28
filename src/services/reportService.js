'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { daysBetween, addDays } = require('../lib/dates');

/**
 * The numbers the desk is asked for at a licensor meeting.
 *
 * Reports are read only and they aggregate in mongo rather than in javascript,
 * because a season's bookings is thousands of rows and pulling them into the
 * process to add them up is how a report screen started taking eight seconds.
 */

/**
 * How much of each licence has actually been used. A licence with two hundred
 * screenings left and three weeks to run is a licence somebody paid for and
 * nobody programmed.
 */
async function licenceUtilisation({ rightsHolderId = null, asOf, minRemaining = 0 } = {}) {
  const { RightsWindow, RightsHolder, Title } = models();

  const filter = { status: 'active' };
  if (rightsHolderId) {
    const holder = await required(RightsHolder, rightsHolderId);
    filter.rightsHolder = holder._id;
  }

  const windows = await RightsWindow.find(filter).sort({ endsOn: 1 });
  if (windows.length === 0) return { asOf, windows: [] };

  const titles = await Title.find(
    { _id: { $in: windows.map((each) => each.title) } },
    'slug title',
  );
  const holders = await RightsHolder.find(
    { _id: { $in: windows.map((each) => each.rightsHolder) } },
    'name',
  );
  const titleById = new Map(titles.map((each) => [String(each._id), each]));
  const holderById = new Map(holders.map((each) => [String(each._id), each]));

  const rows = windows
    .map((window) => {
      const title = titleById.get(String(window.title));
      const holder = holderById.get(String(window.rightsHolder));
      const remaining = window.maxScreenings === null ? null : window.screeningsRemaining;
      const daysLeft = daysBetween(asOf, window.endsOn);

      return {
        window: window.publicId,
        title: title ? title.slug : 'unknown',
        holder: holder ? holder.name : 'unknown',
        territory: window.territory,
        endsOn: window.endsOn,
        daysLeft,
        cap: window.maxScreenings,
        used: window.screeningsUsed,
        remaining,
        usedShare:
          window.maxScreenings === null
            ? null
            : Math.round((window.screeningsUsed / window.maxScreenings) * 100),
        // A licence with plenty left and no time to use it is the one worth a
        // phone call, so it is flagged rather than left to be spotted.
        atRisk: remaining !== null && remaining > 0 && daysLeft >= 0 && daysLeft <= 28,
      };
    })
    .filter((row) => row.remaining === null || row.remaining >= minRemaining);

  return {
    asOf,
    windows: rows,
    atRisk: rows.filter((row) => row.atRisk).length,
    unused: rows.filter((row) => row.used === 0).length,
  };
}

/**
 * What a licensor's titles actually did over a period: screenings, admissions
 * and what the desk owes. Straight out of an aggregation, because a busy
 * licensor has thousands of settled screenings a year.
 */
async function licensorSummary({ rightsHolderId, from, to }) {
  const { RightsHolder, RightsWindow, Booking, Title } = models();
  const holder = await required(RightsHolder, rightsHolderId);

  const windows = await RightsWindow.find({ rightsHolder: holder._id }, '_id');
  if (windows.length === 0)
    return { holder: holder.name, from, to, titles: [], totals: emptyTotals() };

  const rows = await Booking.aggregate([
    {
      $match: {
        rightsWindow: { $in: windows.map((each) => each._id) },
        status: 'settled',
        localDate: { $gte: from, $lte: to },
      },
    },
    {
      $group: {
        _id: '$title',
        screenings: { $sum: 1 },
        admissions: { $sum: '$boxOffice.admissions' },
        grossMinor: { $sum: '$boxOffice.grossMinor' },
        royaltyMinor: { $sum: '$royaltyMinor' },
      },
    },
    { $sort: { royaltyMinor: -1 } },
  ]);

  const titles = await Title.find({ _id: { $in: rows.map((row) => row._id) } }, 'slug title year');
  const titleById = new Map(titles.map((each) => [String(each._id), each]));

  const byTitle = rows.map((row) => {
    const title = titleById.get(String(row._id));
    return {
      title: title ? title.slug : 'unknown',
      year: title ? title.year : null,
      screenings: row.screenings,
      admissions: row.admissions,
      grossMinor: row.grossMinor,
      royaltyMinor: row.royaltyMinor,
      averageAdmissions: Math.round(row.admissions / row.screenings),
    };
  });

  return {
    holder: holder.name,
    currency: holder.remittanceCurrency,
    from,
    to,
    titles: byTitle,
    totals: byTitle.reduce(
      (running, row) => ({
        screenings: running.screenings + row.screenings,
        admissions: running.admissions + row.admissions,
        grossMinor: running.grossMinor + row.grossMinor,
        royaltyMinor: running.royaltyMinor + row.royaltyMinor,
      }),
      emptyTotals(),
    ),
  };
}

function emptyTotals() {
  return { screenings: 0, admissions: 0, grossMinor: 0, royaltyMinor: 0 };
}

/** Licences that will lapse inside a window, so somebody can renew them. */
async function lapsingSoon({ asOf, withinDays = 60 }) {
  const { RightsWindow } = models();
  const horizon = addDays(asOf, withinDays);

  const windows = await RightsWindow.find({
    status: 'active',
    endsOn: { $gte: asOf, $lte: horizon },
  }).sort({ endsOn: 1 });

  return windows.map((window) => ({
    window: window.publicId,
    territory: window.territory,
    endsOn: window.endsOn,
    daysLeft: daysBetween(asOf, window.endsOn),
    used: window.screeningsUsed,
    cap: window.maxScreenings,
  }));
}

/**
 * The state of the shelf: how many prints at each grade, how many off it, and
 * how many are overdue a look. Counted in mongo in one pass, because a large
 * archive holds tens of thousands of elements.
 */
async function shelfSummary({ titleId = null } = {}) {
  const { PrintElement, Title } = models();

  const match = {};
  if (titleId) {
    const title = await required(Title, titleId);
    match.title = title._id;
  }

  const [byStatus, byGrade, overdue, byGauge] = await Promise.all([
    PrintElement.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    PrintElement.aggregate([
      { $match: match },
      { $group: { _id: '$conditionGrade', count: { $sum: 1 } } },
    ]),
    PrintElement.countDocuments({ ...match, ...PrintElement.dueForInspectionFilter() }),
    PrintElement.aggregate([{ $match: match }, { $group: { _id: '$gauge', count: { $sum: 1 } } }]),
  ]);

  return {
    total: byStatus.reduce((sum, row) => sum + row.count, 0),
    byStatus: asCounts(byStatus),
    byGrade: asCounts(byGrade, 'ungraded'),
    byGauge: asCounts(byGauge),
    dueInspection: overdue,
  };
}

function asCounts(rows, nullKey = 'unknown') {
  return Object.fromEntries(
    rows
      .map((row) => [row._id === null || row._id === undefined ? nullKey : row._id, row.count])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

/**
 * Which prints are getting worse, and how fast. Two inspections apart in time
 * with a worse grade the second time is the signal; one inspection is a fact
 * and not a trend.
 */
async function conditionTrend({ from, to, minInspections = 2 } = {}) {
  const { InspectionReport, PrintElement } = models();

  const rows = await InspectionReport.aggregate([
    { $match: { inspectedAt: { $gte: new Date(from), $lte: new Date(`${to}T23:59:59.999Z`) } } },
    { $sort: { inspectedAt: 1 } },
    {
      $group: {
        _id: '$element',
        inspections: { $sum: 1 },
        first: { $first: '$assessment' },
        last: { $last: '$assessment' },
        firstAt: { $first: '$inspectedAt' },
        lastAt: { $last: '$inspectedAt' },
      },
    },
    { $match: { inspections: { $gte: minInspections } } },
  ]);

  const elements = await PrintElement.find(
    { _id: { $in: rows.map((row) => row._id) } },
    'barcode gauge status',
  );
  const elementById = new Map(elements.map((each) => [String(each._id), each]));

  const GRADES = ['A', 'B', 'C', 'D'];
  const trend = rows
    .map((row) => {
      const element = elementById.get(String(row._id));
      const moved = GRADES.indexOf(row.last.grade) - GRADES.indexOf(row.first.grade);

      return {
        element: element ? element.publicId : null,
        barcode: element ? element.barcode : 'unknown',
        inspections: row.inspections,
        from: row.first.grade,
        to: row.last.grade,
        gradesLost: moved,
        densityFrom: row.first.density,
        densityTo: row.last.density,
        days: Math.round((row.lastAt - row.firstAt) / 86400000),
      };
    })
    .sort((a, b) => b.gradesLost - a.gradesLost || b.densityTo - a.densityTo);

  return {
    from,
    to,
    prints: trend,
    worsening: trend.filter((row) => row.gradesLost > 0).length,
    steady: trend.filter((row) => row.gradesLost === 0).length,
  };
}

module.exports = {
  licenceUtilisation,
  licensorSummary,
  lapsingSoon,
  shelfSummary,
  conditionTrend,
};
