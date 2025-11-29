'use strict';

/**
 * The first prints were catalogued before the inspection interval existed, so
 * they have none and needsInspection() reads them as never due. Six is the
 * interval the archive has always used on paper.
 */
module.exports = {
  id: '001-backfill-element-inspection-interval',
  describe: 'give every print an inspection interval',
  async up({ models }) {
    const { PrintElement } = models;
    const result = await PrintElement.updateMany(
      { inspectionIntervalScreenings: { $in: [null, undefined] } },
      { $set: { inspectionIntervalScreenings: 6 } },
    );
    return { updated: result.modifiedCount };
  },
};
