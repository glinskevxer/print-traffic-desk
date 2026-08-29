'use strict';

const pino = require('pino');
const { isDeskError } = require('./errors');

/**
 * Everything that must never appear in a log line.
 *
 * The list grew every time something was added that carried a secret, which is
 * the wrong way round, so there is now a test that walks the whole desk and
 * fails if a known secret reaches a line. This list is what that test holds the
 * desk to, not a list of what somebody remembered.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["idempotency-key"]',
  'req.headers["x-printdesk-signature"]',
  'headers.authorization',
  'headers["x-api-key"]',
  'headers["x-printdesk-signature"]',
  'apiKey',
  'openaiApiKey',
  'secret',
  'secretHash',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'presented',
  '*.apiKey',
  '*.secret',
  '*.password',
  '*.token',
  'body.password',
  'body.newPassword',
  'body.currentPassword',
  'operator.secret',
];

function serialiseError(err) {
  if (!err) return err;
  // A library's error message can carry the thing it was given. The desk's own
  // errors never do, but the ones it wraps are not the desk's.
  const base = {
    type: err.name,
    message: scrubSecrets(err.message),
    stack: scrubSecrets(err.stack),
  };
  if (isDeskError(err)) {
    base.code = err.code;
    base.status = err.status;
    base.details = err.details;
    base.retryable = err.retryable;
  }
  if (err.cause) {
    base.cause = { type: err.cause.name, message: err.cause.message };
  }
  return base;
}

/** Whether the pretty printer is actually installed in this build. */
function prettyAvailable() {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch (err) {
    return false;
  }
}

function createLogger({ level = 'info', pretty = false, service = 'printdesk', destination } = {}) {
  const options = {
    level,
    base: { service },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    serializers: { err: serialiseError, error: serialiseError },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // pino-pretty is a development dependency, so a production image built with
  // --omit=dev does not have it. Asking for pretty logs there used to take the
  // process down on the first line it tried to write; now it falls back to the
  // json a log collector wants anyway and says so once.
  if (pretty && prettyAvailable()) {
    return pino({
      ...options,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    });
  }

  const log = destination ? pino(options, destination) : pino(options);
  if (pretty) log.warn('pino-pretty is not installed, writing json instead');
  return log;
}

let rootLogger = null;

function logger() {
  if (!rootLogger) {
    const { config } = require('../config/env');
    const cfg = config();
    rootLogger = createLogger({
      level: cfg.logging.level,
      pretty: cfg.logging.pretty,
      service: cfg.serviceName,
    });
  }
  return rootLogger;
}

function setLoggerForTests(instance) {
  rootLogger = instance;
}

/**
 * A last look before anything is written. Redaction covers the paths it knows,
 * and this catches the shape of a secret wherever it turns up: a key pasted
 * into a free text note, a token in an error message from a library.
 */
// Kept without the global flag. A shared global regexp carries its own
// lastIndex from call to call, so every other test of the same pattern
// answered false and the sweep looked like it was passing.
const SECRET_SHAPES = Object.freeze([
  { name: 'operator token', pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/ },
  { name: 'machine key', pattern: /\bpdk_[0-9a-f]{8}_[\w-]{20,}/ },
  { name: 'openai key', pattern: /\bsk-[\w-]{20,}/ },
  { name: 'stored password', pattern: /\bscrypt\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}/ },
]);
function scrubSecrets(text) {
  let scrubbed = String(text);
  for (const shape of SECRET_SHAPES) {
    scrubbed = scrubbed.replace(new RegExp(shape.pattern.source, 'g'), `[redacted ${shape.name}]`);
  }
  return scrubbed;
}

function findSecretShapes(text) {
  return SECRET_SHAPES.filter((shape) => shape.pattern.test(String(text))).map(
    (shape) => shape.name,
  );
}

module.exports = {
  createLogger,
  prettyAvailable,
  logger,
  setLoggerForTests,
  serialiseError,
  scrubSecrets,
  findSecretShapes,
  SECRET_SHAPES,
  REDACTED_PATHS,
};
