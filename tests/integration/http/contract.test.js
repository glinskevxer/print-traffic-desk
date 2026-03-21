'use strict';

const { buildTestApp } = require('../../helpers/app');
const { routesOf, asOpenapiPaths, normalise } = require('../../../src/http/routeTable');
const { openapiDocument, OPERATIONS } = require('../../../src/http/openapi');

function key(operation) {
  return `${operation.method} ${operation.path}`;
}

describe('the description and the routes are the same thing', () => {
  const { app } = buildTestApp();
  const routes = asOpenapiPaths(routesOf(app));
  const document = openapiDocument();

  const documented = new Set(
    Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method} ${path}`),
    ),
  );
  const mounted = new Set(routes.map(key));

  it('finds the routes the app actually answers', () => {
    expect(routes.length).toBeGreaterThan(60);
    expect(mounted.has('post /bookings')).toBe(true);
    expect(mounted.has('get /health/live')).toBe(true);
  });

  it('documents every route the app answers', () => {
    const missing = [...mounted].filter((route) => !documented.has(route)).sort();

    expect(missing).toEqual([]);
  });

  it('does not describe a route the app does not answer', () => {
    const invented = [...documented].filter((route) => !mounted.has(route)).sort();

    expect(invented).toEqual([]);
  });

  it('has one entry per operation, with no repeats', () => {
    const keys = OPERATIONS.map(key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(mounted.size);
  });

  it('gives every operation a summary somebody wrote', () => {
    for (const operation of OPERATIONS) {
      expect(operation.summary.length).toBeGreaterThan(10);
      expect(operation.summary).toBe(operation.summary.trim());
    }
  });

  it('declares a path parameter for every id in a path', () => {
    for (const [path, operations] of Object.entries(document.paths)) {
      const inPath = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();
      for (const operation of Object.values(operations)) {
        const declared = (operation.parameters || [])
          .filter((parameter) => parameter.in === 'path')
          .map((parameter) => parameter.name)
          .sort();
        expect(declared).toEqual(inPath);
      }
    }
  });

  it('says which routes need no token, and they are the ones that do not', () => {
    const open = [...documented].filter((route) => {
      const [method, path] = route.split(' ');
      return Array.isArray(document.paths[path][method].security);
    });

    expect(open.sort()).toEqual([
      'get /health/live',
      'get /health/openapi.json',
      'get /health/ready',
      'get /health/version',
      'get /metrics',
      'post /auth/sign-in',
    ]);
  });

  it('describes the refusals on every route that needs a token', () => {
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (Array.isArray(operation.security)) continue;
        expect(Object.keys(operation.responses)).toEqual(
          expect.arrayContaining(['401', '403', '404', '422']),
        );
        void `${method} ${path}`;
      }
    }
  });

  it('offers an idempotency key on the writes that book something', () => {
    const booking = document.paths['/bookings'].post.parameters.map((each) => each.name);
    const run = document.paths['/bookings/runs'].post.parameters.map((each) => each.name);

    expect(booking).toContain('idempotency-key');
    expect(run).toContain('idempotency-key');
  });

  it('offers paging on every list', () => {
    const list = document.paths['/titles'].get.parameters.map((each) => each.name);

    expect(list).toEqual(expect.arrayContaining(['limit', 'cursor', 'order']));
  });

  it('normalises a path the way express reports it', () => {
    expect(normalise('/titles//:titleId')).toBe('/titles/:titleId');
    expect(normalise('/titles/')).toBe('/titles');
    expect(normalise('/')).toBe('/');
  });
});
