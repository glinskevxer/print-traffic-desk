'use strict';

const bookings = require('../../services/bookingService');

/**
 * Run every few minutes. A hold nobody confirmed keeps a print committed, and
 * a shelf full of committed prints for screenings that were never sold is how
 * a repertory circuit runs out of copies it actually has.
 */
module.exports = {
  name: 'lapse-holds',
  describe: 'release the holds nobody confirmed',
  options: {
    dryRun: { type: 'boolean', alias: 'd', describe: 'say what would lapse and change nothing' },
  },
  async run({ options, out }) {
    if (options.dryRun) {
      const { models } = require('../../models');
      const expired = await models().Booking.find({
        status: 'held',
        holdExpiresAt: { $lte: new Date() },
      });
      out(`${expired.length} holds would lapse`);
      for (const booking of expired) out(`  ${booking.reference} ${booking.localDate}`);
      return 0;
    }

    const lapsed = await bookings.lapseExpiredHolds();
    out(`lapsed ${lapsed.length} holds`);
    for (const reference of lapsed) out(`  ${reference}`);
    return 0;
  },
};
