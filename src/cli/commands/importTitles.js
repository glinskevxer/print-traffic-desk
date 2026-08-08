'use strict';

const fs = require('fs');
const titles = require('../../services/titleService');
const { table } = require('../table');

module.exports = {
  name: 'import-titles',
  describe: 'take a catalogue export and put the films on file',
  options: {
    file: { type: 'string', required: true, describe: 'the csv to read' },
    holder: { type: 'string', required: true, describe: 'the licensor these titles belong to' },
    dryRun: { type: 'boolean', alias: 'd', describe: 'say what would go in and change nothing' },
  },
  async run({ options, out }) {
    if (!fs.existsSync(options.file)) {
      out(`printdesk import-titles: there is no file at ${options.file}`);
      return 66;
    }

    const text = fs.readFileSync(options.file, 'utf8');
    const outcome = await titles.importTitles(text, {
      rightsHolderId: options.holder,
      dryRun: options.dryRun,
    });

    out(
      table(
        [outcome],
        [
          { header: 'read', pick: (row) => row.read, align: 'right' },
          {
            header: options.dryRun ? 'would add' : 'added',
            pick: (row) => (options.dryRun ? row.wouldAdd : row.added),
            align: 'right',
          },
          { header: 'already on file', pick: (row) => row.skipped.length, align: 'right' },
        ],
      ),
    );
    for (const slug of outcome.slugs || []) out(`  ${slug}`);
    return 0;
  },
};
