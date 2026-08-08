'use strict';

const { parseArgs, usageFor } = require('./args');
const { config } = require('../config/env');
const { logger } = require('../lib/logger');
const { connect, disconnect } = require('../db/connection');
const { registerModels } = require('../models');
const { runWithContext } = require('../lib/context');
const { isDeskError } = require('../lib/errors');

/**
 * The desk's command line. Everything an operator does on a schedule lives
 * here rather than in a route, because a cron that has to authenticate against
 * its own API is a cron that stops working the day somebody rotates a key.
 */

const COMMANDS = [
  require('./commands/migrate'),
  require('./commands/importTitles'),
  require('./commands/seed'),
  require('./commands/reindex'),
  require('./commands/lapseHolds'),
  require('./commands/expireWindows'),
  require('./commands/chaseTraffic'),
  require('./commands/buildStatements'),
  require('./commands/routes'),
  require('./commands/report'),
  require('./commands/quarantineOverdue'),
  require('./commands/outbox'),
  require('./commands/prune'),
];

const BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));

function usage() {
  const lines = ['printdesk <command> [options]', '', 'Commands:'];
  for (const command of COMMANDS) {
    lines.push(`  ${command.name.padEnd(18)}${command.describe}`);
  }
  lines.push('', 'Run printdesk <command> --help for what a command takes.');
  return lines.join('\n');
}

/**
 * Commands are run with a connection open and an actor in the context, so the
 * audit trail says which command changed something rather than nothing.
 */
async function run(argv, { out = console.log, err = console.error } = {}) {
  const [name, ...rest] = argv;

  if (!name || name === 'help' || name === '--help') {
    out(usage());
    return 0;
  }

  const command = BY_NAME.get(name);
  if (!command) {
    err(`printdesk: there is no ${name} command`);
    err(usage());
    return 64;
  }

  if (rest.includes('--help')) {
    out(usageFor(command));
    return 0;
  }

  const log = logger();
  let parsed;
  try {
    parsed = parseArgs(rest, command.options || {});
  } catch (parseError) {
    err(`printdesk ${name}: ${parseError.message}`);
    return 64;
  }

  const cfg = config();

  // Not every command talks to the database. Connecting anyway meant `routes`
  // could not be run on a machine that had no mongo, which is exactly the
  // machine somebody is on when they want to know what a build answers.
  const needsDatabase = command.needsDatabase !== false;
  if (needsDatabase) {
    registerModels(await connect(cfg.mongo, log));
  }

  try {
    const result = await runWithContext(
      { actor: `cli:${name}`, source: 'cli', requestId: null },
      () => command.run({ ...parsed, cfg, log, out }),
    );
    return result === undefined ? 0 : result;
  } catch (runError) {
    if (isDeskError(runError)) {
      err(`printdesk ${name}: ${runError.message}`);
      if (runError.details) err(JSON.stringify(runError.details, null, 2));
      return 1;
    }
    log.error({ err: runError }, 'command failed');
    return 70;
  } finally {
    if (needsDatabase) await disconnect();
  }
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      logger().fatal({ err }, 'the command line failed');
      process.exit(70);
    });
}

module.exports = { run, usage, COMMANDS, BY_NAME };
