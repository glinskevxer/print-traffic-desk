'use strict';

const rights = require('../../services/rightsService');
const { localDateOf, assertIsoDate } = require('../../lib/dates');

/**
 * Run nightly. A licence whose end date has gone by still reads as active
 * until something says otherwise, and the clearance engine would keep clearing
 * screenings under it.
 */
module.exports = {
  name: 'expire-windows',
  describe: 'move licences past their end date to expired',
  options: {
    asOf: { type: 'string', describe: 'treat this date as today' },
    zone: { type: 'string', default: 'Europe/London', describe: 'zone the date is read in' },
  },
  async run({ options, out }) {
    // A date this command cannot read would compare as a string in mongo and
    // quietly expire everything or nothing, so it is checked before it is used.
    const today = options.asOf
      ? assertIsoDate(options.asOf, 'asOf')
      : localDateOf(new Date(), options.zone);
    const expired = await rights.expireFinishedWindows(today);

    out(`expired ${expired} licences as of ${today}`);
    return 0;
  },
};
