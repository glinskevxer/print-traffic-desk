'use strict';

const { syncIndexes } = require('../../models');

/**
 * Production does not build its own indexes on boot: a rolling deploy where
 * three processes all decide to rebuild the same index at once takes the desk
 * down. This does it once, from a terminal, where somebody is watching.
 */
module.exports = {
  name: 'reindex',
  describe: 'build or repair every index the models declare',
  options: {},
  async run({ out }) {
    const built = await syncIndexes();
    out(`synced indexes for ${built.length} collections: ${built.join(', ')}`);
    return 0;
  },
};
