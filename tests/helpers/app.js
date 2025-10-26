'use strict';

const { Writable } = require('stream');
const { createApp } = require('../../src/http/app');
const { createLogger } = require('../../src/lib/logger');
const { withContext } = require('../../src/lib/context');

/**
 * An operator the tests act as. The real token middleware is covered by its
 * own tests; everything else takes an operator as given and tests what the
 * route does, which is what those files are about.
 */
function stubOperator({ role = 'admin', email = 'desk@archive.test', venue = null } = {}) {
  return {
    publicId: 'op_TESTOPERATOR000',
    email,
    name: 'Test Operator',
    role,
    venue,
    isHouseBound() {
      return this.venue !== null && this.role !== 'admin';
    },
  };
}

function stubAuthentication(operator) {
  return function attachOperator(req, _res, next) {
    if (!operator) return next();
    req.operator = operator;
    req.claims = { sub: operator.publicId, role: operator.role, exp: 4102444800 };
    return withContext({ actor: operator.email, role: operator.role }, () => next());
  };
}

/** An app wired to a silent logger whose lines the test can read back. */
function buildTestApp({ operator = stubOperator(), ...options } = {}) {
  const lines = [];
  const destination = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  const log = createLogger({ level: 'debug', destination });

  const app = createApp({
    log,
    authenticateWith: stubAuthentication(operator),
    ...options,
  });
  return { app, lines, log, operator };
}

module.exports = { buildTestApp, stubOperator, stubAuthentication };
