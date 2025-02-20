'use strict';

const { Writable } = require('stream');
const { createApp } = require('../../src/http/app');
const { createLogger } = require('../../src/lib/logger');

/** An app wired to a silent logger whose lines the test can read back. */
function buildTestApp(options = {}) {
  const lines = [];
  const destination = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  const log = createLogger({ level: 'debug', destination });
  return { app: createApp({ log, ...options }), lines, log };
}

module.exports = { buildTestApp };
