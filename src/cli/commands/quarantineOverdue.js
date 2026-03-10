'use strict';

const inspections = require('../../services/inspectionService');
const { models } = require('../../models');

/**
 * Run weekly, after the inspection queue has been worked. Anything still that
 * far past its interval is not a print the desk can quote a condition for.
 */
module.exports = {
  name: 'quarantine-overdue',
  describe: 'take badly overdue prints off the shelf and tell whoever owns them',
  options: {
    limit: { type: 'number', default: 50, describe: 'how many to take in one pass' },
    dryRun: { type: 'boolean', alias: 'd', describe: 'list what would go and change nothing' },
  },
  async run({ options, out }) {
    if (options.dryRun) {
      const { PrintElement } = models();
      const candidates = await PrintElement.find({
        status: { $in: ['available', 'intake'] },
        $expr: {
          $gte: [
            '$screeningsSinceInspection',
            { $multiply: ['$inspectionIntervalScreenings', inspections.OVERDUE_MULTIPLE] },
          ],
        },
      }).limit(options.limit);

      out(`${candidates.length} prints would be quarantined`);
      for (const element of candidates) {
        out(`  ${element.barcode}  ${element.screeningsSinceInspection} screenings since a look`);
      }
      return 0;
    }

    const taken = await inspections.quarantineOverdue({ limit: options.limit });
    out(`quarantined ${taken.length} prints`);
    for (const id of taken) out(`  ${id}`);
    return 0;
  },
};
