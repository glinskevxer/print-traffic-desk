'use strict';

const shipments = require('../../services/shipmentService');
const inspections = require('../../services/inspectionService');
const { localDateOf } = require('../../lib/dates');

/**
 * The morning list. Two questions the traffic desk asks every day: what should
 * have landed and has not, and what is due a look before it goes out again.
 */
module.exports = {
  name: 'chase',
  describe: 'list the legs that are late and the prints due an inspection',
  options: {
    asOf: { type: 'string', describe: 'treat this date as today' },
    limit: { type: 'number', default: 25, describe: 'how many prints to list' },
  },
  async run({ options, out }) {
    const today = options.asOf || localDateOf(new Date(), 'Europe/London');

    const late = await shipments.overdueArrivals(today);
    out(`legs that should have landed by ${today}: ${late.length}`);
    for (const leg of late) {
      out(
        `  ${leg.publicId}  due ${leg.plannedArrivalOn}  ${leg.trackingReference || 'no tracking'}`,
      );
    }

    const due = await inspections.dueForInspection({ limit: options.limit });
    out(`prints due an inspection: ${due.length}`);
    for (const element of due) {
      out(`  ${element.barcode}  ${element.screeningsSinceInspection} screenings since a look`);
    }
    return 0;
  },
};
