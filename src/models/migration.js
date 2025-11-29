'use strict';

const { Schema } = require('mongoose');

/**
 * What has been run against this database. Deliberately not using the base
 * plugin: a migration record has no public id, is never served, and has to be
 * readable by a version of the code that predates whatever the plugin does.
 */
const migrationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, maxlength: 80 },
    describe: { type: String, required: true, maxlength: 200 },
    appliedAt: { type: Date, required: true, default: Date.now },
    elapsedMs: { type: Number, min: 0, default: 0 },
    appliedBy: { type: String, default: null, maxlength: 160 },
  },
  { versionKey: false },
);

migrationSchema.index({ appliedAt: -1 });

module.exports = { name: 'Migration', schema: migrationSchema, collection: 'migrations' };
