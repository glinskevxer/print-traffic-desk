'use strict';

const { openTestConnection, closeTestConnection, clearCollections } = require('../../helpers/db');
const { registerModels, syncIndexes, models } = require('../../../src/models');
const { makePrintElement, makeTitle, makeVenue } = require('../../helpers/factories');

describe('print element model', () => {
  beforeAll(async () => {
    const conn = await openTestConnection();
    registerModels(conn);
    await syncIndexes();
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  afterEach(async () => {
    await clearCollections();
  });

  it('stores a print with its physical description', async () => {
    const element = await makePrintElement();

    expect(element.publicId).toMatch(/^elem_/);
    expect(element.barcode).toMatch(/^PE-\d{6}$/);
    expect(element.status).toBe('available');
    expect(element.handlingRestrictions).toEqual([]);
  });

  it('refuses a barcode that is not the printed shape', async () => {
    await expect(makePrintElement({ barcode: 'PE-12' })).rejects.toThrow(/six digits/);
  });

  it('refuses a gauge, stock or track outside the vocabulary', async () => {
    await expect(makePrintElement({ gauge: '32mm' })).rejects.toThrow(/gauge/);
    await expect(makePrintElement({ baseStock: 'vinyl' })).rejects.toThrow(/baseStock/);
    await expect(makePrintElement({ soundFormat: 'atmos' })).rejects.toThrow(/soundFormat/);
  });

  it('will not store an element without a title, an owner and a location', async () => {
    const { PrintElement } = models();

    await expect(
      PrintElement.create({
        barcode: 'PE-999999',
        kind: 'release-print',
        gauge: '35mm',
        baseStock: 'polyester',
        aspectRatio: '1.37:1',
        soundFormat: 'optical-mono',
        footage: 100,
        reelCount: 1,
      }),
    ).rejects.toThrow(/title|owner|custodian|currentLocation/);
  });

  it('works out running time from footage and gauge', async () => {
    const at35 = await makePrintElement({ gauge: '35mm', footage: 12150 });
    const at16 = await makePrintElement({ gauge: '16mm', footage: 4860 });

    expect(at35.runningMinutesAt24).toBeCloseTo(135, 5);
    expect(at16.runningMinutesAt24).toBeCloseTo(135, 5);
  });

  it('asks for an inspection once the interval is used up', async () => {
    const element = await makePrintElement({ screeningsSinceInspection: 5 });
    expect(element.needsInspection()).toBe(false);

    element.screeningsSinceInspection = 6;
    expect(element.needsInspection()).toBe(true);
  });

  it('asks for an inspection on anything never inspected', async () => {
    const element = await makePrintElement({ lastInspectedOn: null });

    expect(element.needsInspection()).toBe(true);
  });

  it('knows which statuses are still in circulation', async () => {
    const element = await makePrintElement({ status: 'quarantined' });
    expect(element.isCirculating()).toBe(false);

    element.status = 'in-transit';
    expect(element.isCirculating()).toBe(true);
  });

  it('reads its own restrictions', async () => {
    const element = await makePrintElement({ handlingRestrictions: ['no-platter'] });

    expect(element.hasRestriction('no-platter')).toBe(true);
    expect(element.hasRestriction('nitrate-booth')).toBe(false);
  });

  it('refuses a restriction that is not in the vocabulary', async () => {
    await expect(makePrintElement({ handlingRestrictions: ['be-careful'] })).rejects.toThrow(
      /handlingRestrictions/,
    );
  });

  it('keeps barcodes unique across the collection', async () => {
    const title = await makeTitle();
    const venue = await makeVenue();
    await makePrintElement({ barcode: 'PE-424242', title: title._id, currentLocation: venue._id });

    await expect(
      makePrintElement({ barcode: 'PE-424242', title: title._id, currentLocation: venue._id }),
    ).rejects.toThrow(/duplicate key/);
  });
});
