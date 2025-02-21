'use strict';

const { ValidationError } = require('../../lib/errors');

/**
 * Parsed input lands on req.valid, never back on req.body. Overwriting the
 * express request means a later middleware cannot tell what the caller
 * actually sent, which made one refund bug take two days to find.
 */
function parseOrThrow(schema, value, source) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => ({
    source,
    key: issue.path.join('.') || source,
    problem: issue.message,
  }));
  throw new ValidationError(`the ${source} is not acceptable`, issues);
}

function validate({ body, query, params } = {}) {
  return function runValidation(req, _res, next) {
    try {
      req.valid = {
        body: body ? parseOrThrow(body, req.body, 'body') : undefined,
        query: query ? parseOrThrow(query, req.query, 'query') : undefined,
        params: params ? parseOrThrow(params, req.params, 'path') : undefined,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Collects every failure across body, query and path in one answer. A client
 * fixing one field at a time across three round trips is a bad desk.
 */
function validateAll({ body, query, params } = {}) {
  return function runValidation(req, _res, next) {
    const issues = [];
    const valid = {};

    for (const [source, schema, value] of [
      ['body', body, req.body],
      ['query', query, req.query],
      ['path', params, req.params],
    ]) {
      if (!schema) continue;
      const result = schema.safeParse(value);
      if (result.success) {
        valid[source === 'path' ? 'params' : source] = result.data;
      } else {
        issues.push(
          ...result.error.issues.map((issue) => ({
            source,
            key: issue.path.join('.') || source,
            problem: issue.message,
          })),
        );
      }
    }

    if (issues.length > 0) {
      const sources = [...new Set(issues.map((issue) => issue.source))].join(' and ');
      return next(new ValidationError(`the ${sources} is not acceptable`, issues));
    }
    req.valid = valid;
    return next();
  };
}

module.exports = { validate, validateAll, parseOrThrow };
