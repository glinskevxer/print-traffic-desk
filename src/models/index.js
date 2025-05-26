'use strict';

const { getConnection } = require('../db/connection');

const definitions = [
  require('./rightsHolder'),
  require('./title'),
  require('./venue'),
  require('./printElement'),
  require('./inspectionReport'),
  require('./auditEvent'),
  require('./rightsWindow'),
  require('./shipment'),
];

const registered = new WeakMap();

/**
 * Models are bound to a connection rather than to mongoose's default one, so a
 * test can hold two databases open at once without the schemas fighting.
 */
function registerModels(connection) {
  if (registered.has(connection)) return registered.get(connection);

  const models = {};
  for (const definition of definitions) {
    models[definition.name] = connection.model(
      definition.name,
      definition.schema,
      definition.collection,
    );
  }
  registered.set(connection, models);
  return models;
}

function models() {
  return registerModels(getConnection());
}

async function syncIndexes() {
  const built = models();
  const results = [];
  for (const [name, model] of Object.entries(built)) {
    // eslint-disable-next-line no-await-in-loop
    await model.syncIndexes();
    results.push(name);
  }
  return results;
}

module.exports = { registerModels, models, syncIndexes, definitions };
