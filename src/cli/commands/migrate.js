'use strict';

const { migrate, status } = require('../../db/migrate');

module.exports = {
  name: 'migrate',
  describe: 'run the migrations this database has not seen',
  options: {
    dryRun: { type: 'boolean', alias: 'd', describe: 'list what would run and change nothing' },
    status: { type: 'boolean', alias: 's', describe: 'list every migration and whether it ran' },
  },
  async run({ options, out }) {
    if (options.status) {
      for (const migration of await status()) {
        out(`${migration.applied ? 'applied' : 'pending'}  ${migration.id}  ${migration.describe}`);
      }
      return 0;
    }

    const results = await migrate({
      dryRun: options.dryRun,
      onProgress: ({ id, state, elapsedMs }) => {
        if (state === 'done') out(`  ${id} in ${elapsedMs}ms`);
      },
    });

    if (results.length === 0) {
      out('nothing to run, the database is up to date');
      return 0;
    }
    out(`${options.dryRun ? 'would run' : 'ran'} ${results.length} migrations`);
    return 0;
  },
};
