'use strict';

const royalties = require('../../services/royaltyService');
const { models } = require('../../models');

/**
 * Builds a period statement for every licensor who had a settled screening in
 * it. Statements are built, never issued, from here: issuing is a decision
 * somebody makes after reading the lines.
 */
module.exports = {
  name: 'statements',
  describe: 'build the draft royalty statements for a period',
  options: {
    from: { type: 'string', required: true, describe: 'first day of the period' },
    to: { type: 'string', required: true, describe: 'last day of the period' },
    holder: { type: 'string', describe: 'only this licensor' },
  },
  async run({ options, out }) {
    const { RightsHolder } = models();
    const holders = options.holder
      ? await RightsHolder.find({ publicId: options.holder })
      : await RightsHolder.find({ active: true });

    let built = 0;
    for (const holder of holders) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const statement = await royalties.buildStatement({
          rightsHolderId: holder.publicId,
          periodStartsOn: options.from,
          periodEndsOn: options.to,
        });
        if (statement.lines.length === 0) continue;
        built += 1;
        out(
          `${holder.name}: ${statement.lines.length} screenings, ${statement.totalMinor} ${statement.currency}`,
        );
      } catch (err) {
        out(`${holder.name}: skipped, ${err.message}`);
      }
    }

    out(`built ${built} statements for ${options.from} to ${options.to}`);
    return 0;
  },
};
