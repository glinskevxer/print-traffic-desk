'use strict';

/**
 * Every error the desk raises on purpose carries a stable machine code, an
 * HTTP status and an optional detail bag. Anything without those is a bug and
 * is allowed to reach the error handler untouched so it gets logged loudly.
 */

const CODES = Object.freeze({
  CONFIG_INVALID: 'config_invalid',
  VALIDATION_FAILED: 'validation_failed',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  UNPROCESSABLE: 'unprocessable',
  NOT_AUTHENTICATED: 'not_authenticated',
  FORBIDDEN: 'forbidden',
  RATE_LIMITED: 'rate_limited',
  UPSTREAM_FAILED: 'upstream_failed',
  INTERNAL: 'internal_error',
});

class DeskError extends Error {
  constructor(message, { code, status, details, cause, retryable = false } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code || CODES.INTERNAL;
    this.status = status || 500;
    this.details = details;
    this.retryable = retryable;
    this.expected = true;
    if (cause !== undefined) this.cause = cause;
    Error.captureStackTrace(this, new.target);
  }

  /** Body shape returned to clients. Never leaks a stack or a cause chain. */
  toPayload() {
    const body = { error: { code: this.code, message: this.message } };
    if (this.details !== undefined) body.error.details = this.details;
    return body;
  }
}

class ConfigError extends DeskError {
  constructor(message, details) {
    super(message, { code: CODES.CONFIG_INVALID, status: 500, details });
  }
}

class ValidationError extends DeskError {
  constructor(message, issues) {
    super(message, { code: CODES.VALIDATION_FAILED, status: 400, details: { issues } });
  }
}

class NotFoundError extends DeskError {
  constructor(resource, identifier) {
    super(`${resource} ${identifier} does not exist`, {
      code: CODES.NOT_FOUND,
      status: 404,
      details: { resource, identifier: String(identifier) },
    });
  }
}

class ConflictError extends DeskError {
  constructor(message, details) {
    super(message, { code: CODES.CONFLICT, status: 409, details });
  }
}

/**
 * The request was understood and is well formed, but the desk rules refuse it.
 * Clearance refusals and infeasible traffic plans land here, and they carry the
 * rule outcomes so a programmer can see which rule bit.
 */
class RuleRefusedError extends DeskError {
  constructor(message, details) {
    super(message, { code: CODES.UNPROCESSABLE, status: 422, details });
  }
}

class NotAuthenticatedError extends DeskError {
  constructor(message = 'credentials missing or not recognised') {
    super(message, { code: CODES.NOT_AUTHENTICATED, status: 401 });
  }
}

class ForbiddenError extends DeskError {
  constructor(message = 'this operator may not do that', details) {
    super(message, { code: CODES.FORBIDDEN, status: 403, details });
  }
}

class RateLimitedError extends DeskError {
  constructor(retryAfterSeconds) {
    super('too many requests', {
      code: CODES.RATE_LIMITED,
      status: 429,
      details: { retryAfterSeconds },
      retryable: true,
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class UpstreamError extends DeskError {
  constructor(message, { service, status, retryable = true, cause } = {}) {
    super(message, {
      code: CODES.UPSTREAM_FAILED,
      status: 502,
      details: { service, upstreamStatus: status },
      retryable,
      cause,
    });
    this.service = service;
  }
}

function isDeskError(value) {
  return value instanceof DeskError;
}

/** True when a caller is allowed to try the same thing again unchanged. */
function isRetryable(value) {
  return Boolean(value && value.retryable === true);
}

module.exports = {
  CODES,
  DeskError,
  ConfigError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RuleRefusedError,
  NotAuthenticatedError,
  ForbiddenError,
  RateLimitedError,
  UpstreamError,
  isDeskError,
  isRetryable,
};
