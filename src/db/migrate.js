'use strict';

const fs = require('fs');
const path = require('path');
const { models } = require('../models');
const { currentActor } = require('../lib/context');
const { DeskError, CODES } = require('../lib/errors');

/**
 * Migrations run in file order, once each, and are recorded before the next
 * one starts. There is no down: a migration that has to be undone is undone by
 * a new migration, because the desk has one database and no way to test a
 * rollback against the data that made it necessary.
 */

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function loadMigrations(directory = MIGRATIONS_DIR) {
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.js'))
    .sort();

  const loaded = files.map((file) => {
     
    const migration = require(path.join(directory, file));
    if (!migration.id || typeof migration.up !== 'function') {
      throw new DeskError(`${file} is not a migration`, { code: CODES.CONFIG_INVALID, status: 500 });
    }
    if (migration.id !== path.basename(file, '.js')) {
      throw new DeskError(`${file} declares the id ${migration.id}`, {
        code: CODES.CONFIG_INVALID,
        status: 500,
      });
    }
    return migration;
  });

  const seen = new Set();
  for (const migration of loaded) {
    if (seen.has(migration.id)) {
      throw new DeskError(`two migrations claim the id ${migration.id}`, {
        code: CODES.CONFIG_INVALID,
        status: 500,
      });
    }
    seen.add(migration.id);
  }
  return loaded;
}

async function appliedIds() {
  const { Migration } = models();
  const rows = await Migration.find({}, 'id').sort({ id: 1 });
  return new Set(rows.map((row) => row.id));
}

async function pending(directory) {
  const applied = await appliedIds();
  return loadMigrations(directory).filter((migration) => !applied.has(migration.id));
}

/**
 * Runs what has not run. Each one is recorded as soon as it finishes, so a
 * failure halfway through a set leaves the earlier ones marked done rather
 * than replaying them on the next attempt.
 */
async function migrate({ directory, dryRun = false, onProgress = () => {} } = {}) {
  const { Migration } = models();
  const outstanding = await pending(directory);
  const results = [];

  for (const migration of outstanding) {
    if (dryRun) {
      results.push({ id: migration.id, describe: migration.describe, applied: false });
      continue;
    }

    const startedAt = Date.now();
    onProgress({ id: migration.id, state: 'starting' });

    // eslint-disable-next-line no-await-in-loop
    const outcome = await migration.up({ models: models() });
    const elapsedMs = Date.now() - startedAt;

    // eslint-disable-next-line no-await-in-loop
    await Migration.create({
      id: migration.id,
      describe: migration.describe,
      elapsedMs,
      appliedBy: currentActor(),
    });

    onProgress({ id: migration.id, state: 'done', elapsedMs, outcome });
    results.push({ id: migration.id, describe: migration.describe, applied: true, elapsedMs, outcome });
  }

  return results;
}

async function status(directory) {
  const applied = await appliedIds();
  return loadMigrations(directory).map((migration) => ({
    id: migration.id,
    describe: migration.describe,
    applied: applied.has(migration.id),
  }));
}

module.exports = { MIGRATIONS_DIR, loadMigrations, pending, migrate, status, appliedIds };
