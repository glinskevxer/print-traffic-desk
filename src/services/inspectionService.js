'use strict';

const { models } = require('../models');
const { required } = require('../db/lookup');
const { listWith } = require('../db/listing');
const { withTransaction } = require('../db/connection');
const { NotFoundError, RuleRefusedError } = require('../lib/errors');
const { assessCondition } = require('../domain/condition/grade');
const { withoutRestrictions } = require('../domain/handling');
const { assertTransition, statusAfterVerdict, isTerminal } = require('../domain/elements/status');
const { localDateOf } = require('../lib/dates');
const audit = require('../lib/audit');
const outbox = require('../lib/outbox');

async function loadElement(publicId, session = null) {
  const { PrintElement } = models();
  const element = await required(PrintElement, publicId, { session });
  return element;
}

/**
 * Runs the assessment without writing anything. An inspector on the bench
 * wants to know whether what they are looking at is going to quarantine the
 * print before they commit to filing it.
 */
async function previewInspection(elementPublicId, input) {
  const element = await loadElement(elementPublicId);
  const carried = withoutRestrictions(
    element.handlingRestrictions,
    input.restrictionsCleared || [],
  );

  return assessCondition({
    findings: input.findings || [],
    measurements: input.measurements || {},
    footage: input.footageInspected || element.footage,
    baseStock: element.baseStock,
    existingRestrictions: carried,
  });
}

/**
 * Files a report and moves the element with it. Both writes go in one
 * transaction: a filed quarantine that left the element available is how a
 * print with active decay was shipped to Bologna.
 */
async function recordInspection(elementPublicId, input) {
  const { InspectionReport, Venue } = models();

  return withTransaction(async (session) => {
    const element = await loadElement(elementPublicId, session);

    if (isTerminal(element.status)) {
      throw new RuleRefusedError('a retired element is not inspected again', {
        element: elementPublicId,
        status: element.status,
      });
    }

    const venue = input.atVenueId
      ? await Venue.byPublicId(input.atVenueId, { session })
      : await Venue.findById(element.currentLocation, null, { session });
    if (!venue) throw new NotFoundError('venue', input.atVenueId);

    const carried = withoutRestrictions(
      element.handlingRestrictions,
      input.restrictionsCleared || [],
    );
    const footage = input.footageInspected || element.footage;
    const assessment = assessCondition({
      findings: input.findings || [],
      measurements: input.measurements || {},
      footage,
      baseStock: element.baseStock,
      existingRestrictions: carried,
    });

    const nextStatus = statusAfterVerdict(element.status, assessment.verdict);
    assertTransition(element.status, nextStatus, { element: elementPublicId });

    const [report] = await InspectionReport.create(
      [
        {
          element: element._id,
          atVenue: venue._id,
          inspector: input.inspector,
          kind: input.kind,
          inspectedAt: input.inspectedAt || new Date(),
          findings: input.findings || [],
          measurements: input.measurements || {},
          footageInspected: footage,
          screeningsSinceLast: element.screeningsSinceInspection,
          restrictionsCleared: input.restrictionsCleared || [],
          source: input.source || 'manual',
          notes: input.notes,
          assessment: {
            grade: assessment.grade,
            verdict: assessment.verdict,
            density: assessment.density,
            restrictions: assessment.restrictions,
            reasons: assessment.reasons,
          },
        },
      ],
      { session },
    );

    const statusBefore = element.status;
    const gradeBefore = element.conditionGrade;

    element.conditionGrade = assessment.grade;
    element.handlingRestrictions = assessment.restrictions;
    element.screeningsSinceInspection = 0;
    element.lastInspectedOn = localDateOf(report.inspectedAt, venue.timezone);
    element.status = nextStatus;
    await element.save({ session });

    await audit.record(
      {
        action: 'element.inspected',
        subjectType: 'print-element',
        subjectId: element.publicId,
        changes: [
          { field: 'status', before: statusBefore, after: nextStatus },
          { field: 'conditionGrade', before: gradeBefore, after: assessment.grade },
        ].filter((change) => change.before !== change.after),
        metadata: {
          report: report.publicId,
          verdict: assessment.verdict,
          inspector: input.inspector,
        },
      },
      { session },
    );

    return { report, element, assessment };
  });
}

async function getInspection(publicId) {
  const { InspectionReport } = models();
  const report = await required(InspectionReport, publicId);
  return report;
}

async function listInspections(query = {}) {
  const { InspectionReport, PrintElement } = models();
  const filter = {};

  if (query.elementId) {
    const element = await required(PrintElement, query.elementId);
    filter.element = element._id;
  }
  if (query.verdict) filter['assessment.verdict'] = query.verdict;
  if (query.kind) filter.kind = query.kind;
  if (query.inspector) filter.inspector = query.inspector;

  return listWith(InspectionReport, {
    filter,
    query: { order: 'desc', ...query },
    sortField: 'inspectedAt',
  });
}

async function latestFor(elementPublicId) {
  const { InspectionReport } = models();
  const element = await loadElement(elementPublicId);
  return InspectionReport.findOne({ element: element._id }).sort({ inspectedAt: -1 });
}

/**
 * Elements the desk should be pulling in for a look, worst first.
 *
 * This used to read four times the page and filter in javascript, which was
 * wrong as soon as the shelf had more than four pages of healthy prints: the
 * overdue ones sorted last and never made the window.
 */
async function dueForInspection({ limit = 50 } = {}) {
  const { PrintElement } = models();

  return PrintElement.find({
    $and: [{ status: { $in: ['available', 'committed'] } }, PrintElement.dueForInspectionFilter()],
  })
    .sort({ screeningsSinceInspection: -1 })
    .limit(limit);
}

/**
 * How far past its interval a print has to be before the desk stops asking and
 * takes it off the shelf. Three times the interval is a print that has been
 * run twenty times without anybody opening the can.
 */
const OVERDUE_MULTIPLE = 3;

/**
 * Takes badly overdue prints off the shelf and tells whoever owns them.
 *
 * This is deliberately blunt. A print nobody has inspected in twenty
 * screenings is not a print the desk knows the condition of, and a booking
 * made against a condition grade from a year ago is a booking made on a guess.
 */
async function quarantineOverdue({ limit = 50, now = new Date() } = {}) {
  const { PrintElement, RightsHolder } = models();

  const overdue = await PrintElement.find({
    status: { $in: ['available', 'intake'] },
    $expr: {
      $gte: [
        '$screeningsSinceInspection',
        { $multiply: ['$inspectionIntervalScreenings', OVERDUE_MULTIPLE] },
      ],
    },
  }).limit(limit);

  const taken = [];
  for (const element of overdue) {
    // eslint-disable-next-line no-await-in-loop
    await withTransaction(async (session) => {
      const fresh = await PrintElement.findById(element._id, null, { session });
      if (!['available', 'intake'].includes(fresh.status)) return;

      const before = fresh.status;
      fresh.status = 'quarantined';
      fresh.provenance = `${fresh.provenance ? `${fresh.provenance}\n` : ''}quarantined on ${now
        .toISOString()
        .slice(0, 10)}: ${fresh.screeningsSinceInspection} screenings since the last inspection`;
      await fresh.save({ session });

      const owner = await RightsHolder.findById(fresh.owner, 'name', { session });
      await outbox.enqueue(
        {
          kind: 'element.quarantined',
          subjectType: 'print-element',
          subjectId: fresh.publicId,
          to: owner ? owner.name : 'unknown owner',
          channel: 'email',
          payload: {
            barcode: fresh.barcode,
            screeningsSinceInspection: fresh.screeningsSinceInspection,
            interval: fresh.inspectionIntervalScreenings,
          },
        },
        { session },
      );

      await audit.record(
        {
          action: 'element.quarantined-overdue',
          subjectType: 'print-element',
          subjectId: fresh.publicId,
          changes: [{ field: 'status', before, after: 'quarantined' }],
          metadata: { screeningsSinceInspection: fresh.screeningsSinceInspection },
        },
        { session },
      );

      taken.push(fresh.publicId);
    });
  }

  return taken;
}

module.exports = {
  quarantineOverdue,
  OVERDUE_MULTIPLE,
  previewInspection,
  recordInspection,
  getInspection,
  listInspections,
  latestFor,
  dueForInspection,
};
