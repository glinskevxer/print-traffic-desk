'use strict';

const { models } = require('../models');
const { withTransaction } = require('../db/connection');
const { NotFoundError, RuleRefusedError } = require('../lib/errors');
const { paginate } = require('../lib/pagination');
const { assessCondition } = require('../domain/condition/grade');
const { withoutRestrictions } = require('../domain/handling');
const { assertTransition, statusAfterVerdict, isTerminal } = require('../domain/elements/status');
const { localDateOf } = require('../lib/dates');

async function loadElement(publicId, session = null) {
  const { PrintElement } = models();
  const element = await PrintElement.byPublicId(publicId, { session });
  if (!element) throw new NotFoundError('print element', publicId);
  return element;
}

/**
 * Runs the assessment without writing anything. An inspector on the bench
 * wants to know whether what they are looking at is going to quarantine the
 * print before they commit to filing it.
 */
async function previewInspection(elementPublicId, input) {
  const element = await loadElement(elementPublicId);
  const carried = withoutRestrictions(element.handlingRestrictions, input.restrictionsCleared || []);

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

    const carried = withoutRestrictions(element.handlingRestrictions, input.restrictionsCleared || []);
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

    element.conditionGrade = assessment.grade;
    element.handlingRestrictions = assessment.restrictions;
    element.screeningsSinceInspection = 0;
    element.lastInspectedOn = localDateOf(report.inspectedAt, venue.timezone);
    element.status = nextStatus;
    await element.save({ session });

    return { report, element, assessment };
  });
}

async function getInspection(publicId) {
  const { InspectionReport } = models();
  const report = await InspectionReport.byPublicId(publicId);
  if (!report) throw new NotFoundError('inspection report', publicId);
  return report;
}

async function listInspections(query = {}) {
  const { InspectionReport, PrintElement } = models();
  const filter = {};

  if (query.elementId) {
    const element = await PrintElement.byPublicId(query.elementId);
    if (!element) throw new NotFoundError('print element', query.elementId);
    filter.element = element._id;
  }
  if (query.verdict) filter['assessment.verdict'] = query.verdict;
  if (query.kind) filter.kind = query.kind;
  if (query.inspector) filter.inspector = query.inspector;

  return paginate(InspectionReport, {
    filter,
    sortField: 'inspectedAt',
    order: query.order || 'desc',
    limit: query.limit,
    cursor: query.cursor,
  });
}

async function latestFor(elementPublicId) {
  const { InspectionReport } = models();
  const element = await loadElement(elementPublicId);
  return InspectionReport.findOne({ element: element._id }).sort({ inspectedAt: -1 });
}

/** Elements the desk should be pulling in for a look, worst first. */
async function dueForInspection({ limit = 50 } = {}) {
  const { PrintElement } = models();
  const candidates = await PrintElement.find({
    status: { $in: ['available', 'committed'] },
  })
    .sort({ screeningsSinceInspection: -1 })
    .limit(limit * 4);

  return candidates.filter((element) => element.needsInspection()).slice(0, limit);
}

module.exports = {
  previewInspection,
  recordInspection,
  getInspection,
  listInspections,
  latestFor,
  dueForInspection,
};
