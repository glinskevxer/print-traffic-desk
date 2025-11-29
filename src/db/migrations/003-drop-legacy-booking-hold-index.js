'use strict';

/**
 * An early index on holdExpiresAt alone was replaced by the compound one on
 * status and holdExpiresAt. Mongo will not drop it on its own and it is
 * written to on every booking.
 */
module.exports = {
  id: '003-drop-legacy-booking-hold-index',
  describe: 'drop the standalone hold expiry index the compound one replaced',
  async up({ models }) {
    const { Booking } = models;
    const indexes = await Booking.collection.indexes();
    const legacy = indexes.find((index) => index.name === 'holdExpiresAt_1');

    if (!legacy) return { dropped: 0 };
    await Booking.collection.dropIndex('holdExpiresAt_1');
    return { dropped: 1 };
  },
};
