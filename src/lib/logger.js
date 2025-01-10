'use strict';

const pino = require('pino');
const { isDeskError } = require('./errors');

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers["x-api-key"]',
  'apiKey',
  'openaiApiKey',
  '*.apiKey',
  'operator.secret',
];

function serialiseError(err) {
  if (!err) return err;
  const base = {
    type: err.name,
    message: err.message,
    stack: err.stack,
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

function createLogger({ level = 'info', pretty = false, service = 'printdesk', destination } = {}) {
  const options = {
    level,
    base: { service },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    serializers: { err: serialiseError, error: serialiseError },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (pretty) {
    return pino({
      ...options,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    });
  }
  return destination ? pino(options, destination) : pino(options);
}

let rootLogger = null;

function logger() {
  if (!rootLogger) {
    // eslint-disable-next-line global-require
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

module.exports = { createLogger, logger, setLoggerForTests, serialiseError, REDACTED_PATHS };
