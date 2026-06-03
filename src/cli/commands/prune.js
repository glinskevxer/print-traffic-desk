'use strict';

const retention = require('../../services/retentionService');
const { table } = require('../table');

module.exports = {
  name: 'prune',
  describe: 'throw away the operational chaff, keeping what a distributor can ask for',
  options: {
    only: { type: 'string', describe: `just one of ${Object.keys(retention.PRUNERS).join(', ')}` },
    limit: { type: 'number', default: 1000, describe: 'how many rows to look at in one pass' },
    days: { type: 'number', describe: 'override the retention for the collection named by --only' },
  },
  async run({ options, out }) {
    const days = options.only && options.days ? { [options.only]: options.days } : {};
    const outcome = await retention.prune({ only: options.only, limit: options.limit, days });

    const rows = Object.entries(outcome).map(([collection, result]) => ({
      collection,
      ...result,
      kept: result.examined - result.deleted,
    }));

    out(
      table(rows, [
        { header: 'collection', pick: (row) => row.collection },
        { header: 'looked at', pick: (row) => row.examined, align: 'right' },
        { header: 'deleted', pick: (row) => row.deleted, align: 'right' },
        { header: 'kept', pick: (row) => row.kept, align: 'right' },
      ]),
    );
    return 0;
  },
};
