'use strict';

const { createLogger } = require('../../lib/logger');
const { createApp } = require('../../http/app');
const { routesOf } = require('../../http/routeTable');
const { openRouters, guardedRouters } = require('../../http/routers');
const { OPERATIONS } = require('../../http/openapi');
const { table } = require('../table');

/**
 * What this build answers. Useful on a machine where somebody is not sure
 * which version is deployed, and it is the same list the contract test checks
 * against the published description.
 */
module.exports = {
  name: 'routes',
  needsDatabase: false,
  describe: 'list what this build of the desk answers',
  options: {
    open: { type: 'boolean', describe: 'only the routes that need no token' },
    grep: { type: 'string', describe: 'only routes whose path contains this' },
  },
  async run({ options, out }) {
    const app = createApp({
      log: createLogger({ level: 'silent' }),
      authenticateWith: (_req, _res, next) => next(),
    });

    const openPrefixes = openRouters().map((router) => router.path);
    const summaries = new Map(
      OPERATIONS.map((operation) => [`${operation.method} ${operation.path}`, operation.summary]),
    );

    const rows = routesOf(app)
      .map((route) => {
        const documented = route.path.replace(/:(\w+)/g, '{$1}');
        return {
          method: route.method,
          path: route.path,
          open: openPrefixes.some((prefix) => prefix !== '/' && route.path.startsWith(prefix)),
          summary: summaries.get(`${route.method.toLowerCase()} ${documented}`) || '',
        };
      })
      .filter((row) => (options.open ? row.open : true))
      .filter((row) => (options.grep ? row.path.includes(options.grep) : true));

    out(
      table(rows, [
        { header: 'method', pick: (row) => row.method },
        { header: 'path', pick: (row) => row.path },
        { header: 'token', pick: (row) => (row.open ? '' : 'needed') },
        { header: 'what it does', pick: (row) => row.summary },
      ]),
    );
    out(`\n${rows.length} routes, ${guardedRouters().length} guarded routers`);
    return 0;
  },
};
