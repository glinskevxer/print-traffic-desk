'use strict';

/**
 * Walks an express app and lists what it will actually answer.
 *
 * Express keeps this in a stack of layers with the paths as regular
 * expressions, and there is no supported way to read it back. The unsupported
 * way is fine for a test that checks the published description against the
 * routes, and it is only ever used by that test and by the route listing on
 * the command line, so a change in express breaks a test rather than the desk.
 */

const IGNORED_METHODS = new Set(['_all']);

function pathFromLayer(layer) {
  if (layer.route) return layer.route.path;
  if (!layer.regexp) return '';

  // Express stores a mounted router's prefix as a regexp. The fast_slash flag
  // means it was mounted at the root.
  if (layer.regexp.fast_slash) return '';

  const source = layer.regexp.source
    .replace('^\\/', '/')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\\\//g, '/')
    .replace(/\$$/, '');

  return source.startsWith('/') ? source : `/${source}`;
}

function methodsOf(route) {
  return Object.keys(route.methods)
    .filter((method) => !IGNORED_METHODS.has(method))
    .map((method) => method.toUpperCase())
    .sort();
}

function walk(stack, prefix, found) {
  for (const layer of stack) {
    if (layer.route) {
      const path = normalise(`${prefix}${layer.route.path}`);
      for (const method of methodsOf(layer.route)) {
        found.push({ method, path });
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      walk(layer.handle.stack, `${prefix}${pathFromLayer(layer)}`, found);
    }
  }
  return found;
}

function normalise(path) {
  const collapsed = path.replace(/\/{2,}/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) return collapsed.slice(0, -1);
  return collapsed;
}

/** Every method and path the app answers, sorted so the list is stable. */
function routesOf(app) {
  const found = walk(app._router.stack, '', []);
  const seen = new Set();

  return found
    .filter((route) => {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** The same list in the shape openapi uses, so the two can be compared. */
function asOpenapiPaths(routes) {
  return routes.map((route) => ({
    method: route.method.toLowerCase(),
    path: route.path.replace(/:(\w+)/g, '{$1}'),
  }));
}

module.exports = { routesOf, asOpenapiPaths, pathFromLayer, normalise };
