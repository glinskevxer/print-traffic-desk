'use strict';

/**
 * Venue codes were typed in lower case for the first three months and the
 * uppercase setter only arrived with the shipping work, so the older rows
 * never went through it.
 */
module.exports = {
  id: '002-normalise-venue-codes',
  describe: 'upper case the venue codes typed in before the setter existed',
  async up({ models }) {
    const { Venue } = models;
    const venues = await Venue.find({ code: /[a-z]/ });

    for (const venue of venues) {
      venue.code = venue.code.toUpperCase();
      // eslint-disable-next-line no-await-in-loop
      await venue.save();
    }
    return { updated: venues.length };
  },
};
