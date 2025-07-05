'use strict';

const { useDatabase, closeTestConnection, clearCollections } = require('../../helpers/db');
const { makePrintElement, makeVenue } = require('../../helpers/factories');
const service = require('../../../src/services/inspectionService');

describe('recording an inspection', () => {
  beforeAll(async () => {
    await useDatabase();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  beforeEach(async () => {
    await clearCollections();
  });

  const routine = (overrides = {}) => ({
    inspector: 'R. Fitzgerald',
    kind: 'routine',
    findings: [],
    measurements: {},
    ...overrides,
  });

  it('files a report and grades the element with it', async () => {
    const element = await makePrintElement({ conditionGrade: 'C', screeningsSinceInspection: 4 });

    const { report, element: updated } = await service.recordInspection(
      element.publicId,
      routine({ findings: [{ reel: 2, code: 'SPLICE-TAPE', severity: 'minor' }] }),
    );

    expect(report.publicId).toMatch(/^insp_/);
    expect(report.assessment.grade).toBe('A');
    expect(updated.conditionGrade).toBe('A');
    expect(updated.screeningsSinceInspection).toBe(0);
    expect(updated.lastInspectedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('quarantines the element when the verdict says so', async () => {
    const element = await makePrintElement({ status: 'available' });

    const { element: updated } = await service.recordInspection(
      element.publicId,
      routine({ measurements: { adStripLevel: 3 } }),
    );

    expect(updated.status).toBe('quarantined');
    expect(updated.conditionGrade).toBe('D');
  });

  it('releases an element from quarantine when it comes back clean', async () => {
    const element = await makePrintElement({ status: 'quarantined', conditionGrade: 'D' });

    const { element: updated } = await service.recordInspection(element.publicId, routine());

    expect(updated.status).toBe('available');
    expect(updated.conditionGrade).toBe('A');
  });

  it('leaves a committed element committed', async () => {
    const element = await makePrintElement({ status: 'committed' });

    const { element: updated } = await service.recordInspection(element.publicId, routine());

    expect(updated.status).toBe('committed');
  });

  it('carries restrictions forward and only clears what was named', async () => {
    const element = await makePrintElement({
      handlingRestrictions: ['no-platter', 'archive-projectionist-only'],
    });

    const { element: updated } = await service.recordInspection(
      element.publicId,
      routine({ restrictionsCleared: ['no-platter'] }),
    );

    expect(updated.handlingRestrictions).toEqual(['archive-projectionist-only']);
  });

  it('puts a new restriction on from a severe finding', async () => {
    const element = await makePrintElement();

    const { element: updated } = await service.recordInspection(
      element.publicId,
      routine({ findings: [{ reel: 1, code: 'PERF-TEAR', severity: 'severe' }] }),
    );

    expect(updated.handlingRestrictions).toContain('no-platter');
    expect(updated.conditionGrade).toBe('C');
  });

  it('will not inspect a retired element', async () => {
    const element = await makePrintElement({ status: 'retired' });

    await expect(service.recordInspection(element.publicId, routine())).rejects.toThrow(
      /not inspected again/,
    );
  });

  it('refuses an element that does not exist', async () => {
    await expect(service.recordInspection('elem_0000000000000000', routine())).rejects.toThrow(
      /does not exist/,
    );
  });

  it('records where the inspection happened, defaulting to where the print is', async () => {
    const element = await makePrintElement();

    const { report } = await service.recordInspection(element.publicId, routine());

    expect(String(report.atVenue)).toBe(String(element.currentLocation));
  });

  it('takes a venue other than the current location when one is given', async () => {
    const lab = await makeVenue({ code: 'GB-LON-LAB', name: 'Soho Film Lab' });
    const element = await makePrintElement();

    const { report } = await service.recordInspection(
      element.publicId,
      routine({ atVenueId: lab.publicId }),
    );

    expect(String(report.atVenue)).toBe(String(lab._id));
  });

  it('previews a verdict without writing anything', async () => {
    const element = await makePrintElement({ conditionGrade: 'A' });

    const preview = await service.previewInspection(element.publicId, {
      measurements: { shrinkagePercent: 1.6 },
    });

    expect(preview.verdict).toBe('quarantine');
    expect(await service.latestFor(element.publicId)).toBeNull();
  });

  it('remembers how many screenings the print had done since the last look', async () => {
    const element = await makePrintElement({ screeningsSinceInspection: 7 });

    const { report } = await service.recordInspection(element.publicId, routine());

    expect(report.screeningsSinceLast).toBe(7);
  });

  it('lists an element history newest first', async () => {
    const element = await makePrintElement();
    await service.recordInspection(
      element.publicId,
      routine({ inspectedAt: new Date('2025-01-10T10:00:00Z') }),
    );
    await service.recordInspection(
      element.publicId,
      routine({ kind: 'damage', inspectedAt: new Date('2025-03-10T10:00:00Z') }),
    );

    const page = await service.listInspections({ elementId: element.publicId });

    expect(page.items.map((r) => r.kind)).toEqual(['damage', 'routine']);
  });

  it('filters the history by verdict', async () => {
    const element = await makePrintElement();
    await service.recordInspection(element.publicId, routine());
    await service.recordInspection(element.publicId, routine({ measurements: { adStripLevel: 2 } }));

    const page = await service.listInspections({ verdict: 'quarantine' });

    expect(page.items).toHaveLength(1);
  });

  it('finds the elements that are due a look', async () => {
    const overdue = await makePrintElement({
      screeningsSinceInspection: 9,
      inspectionIntervalScreenings: 6,
    });
    await makePrintElement({ screeningsSinceInspection: 1, inspectionIntervalScreenings: 6 });
    await makePrintElement({ lastInspectedOn: null, status: 'quarantined' });

    const due = await service.dueForInspection();

    expect(due.map((e) => e.publicId)).toEqual([overdue.publicId]);
  });
});
