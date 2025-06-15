'use strict';

const crypto = require('crypto');
const { models } = require('../../models');
const { ConflictError, ValidationError } = require('../../lib/errors');
const { currentContext } = require('../../lib/context');

const HEADER = 'idempotency-key';
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/;

function hashRequest(req) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ path: req.path, body: req.body || {} }))
    .digest('hex');
}

/**
 * Wraps a write endpoint. Without a key the request goes straight through:
 * the desk does not force one, because half the bookings are typed in by hand
 * and a person does not retry the same form in 40 milliseconds.
 */
function idempotency({ required = false } = {}) {
  return async function enforceIdempotency(req, res, next) {
    const key = req.get(HEADER);

    if (!key) {
      if (!required) return next();
      return next(
        new ValidationError('this endpoint needs an idempotency key', [
          { key: HEADER, problem: 'missing' },
        ]),
      );
    }
    if (!KEY_PATTERN.test(key)) {
      return next(
        new ValidationError('that idempotency key is not one this desk accepts', [
          { key: HEADER, problem: 'expected 8 to 120 url safe characters' },
        ]),
      );
    }

    const { IdempotencyRecord } = models();
    const route = `${req.method} ${req.baseUrl}${req.route ? req.route.path : req.path}`;
    const requestHash = hashRequest(req);

    let record;
    try {
      record = await IdempotencyRecord.create({
        key,
        route,
        requestHash,
        actor: currentContext().actor,
      });
    } catch (err) {
      if (err.code !== 11000) return next(err);
      record = await IdempotencyRecord.findOne({ key, route });
    }

    if (record.state === 'completed') {
      if (record.requestHash !== requestHash) {
        return next(
          new ConflictError('that key was used for a different request', { key, route }),
        );
      }
      res.set('idempotent-replay', 'true');
      return res.status(record.status).json(record.body);
    }

    if (record.createdAt && Date.now() - record.createdAt.getTime() > 1000) {
      // Somebody else is still working on it, or died halfway. Either way the
      // caller has to wait rather than book a second screening.
      if (record.requestHash !== requestHash) {
        return next(new ConflictError('that key was used for a different request', { key, route }));
      }
      return next(new ConflictError('this request is already being processed', { key }));
    }

    hookResponse(res, async (status, body) => {
      if (status >= 400) {
        await IdempotencyRecord.deleteOne({ key, route });
        return;
      }
      await IdempotencyRecord.updateOne(
        { key, route },
        { $set: { state: 'completed', status, body, completedAt: new Date() } },
      );
    });

    return next();
  };
}

/** Captures whatever the handler answered so it can be replayed verbatim. */
function hookResponse(res, save) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const result = originalJson(body);
    save(res.statusCode, body).catch(() => {
      // Losing the record only costs the caller a duplicate check on retry.
    });
    return result;
  };
}

module.exports = { idempotency, hashRequest, HEADER, KEY_PATTERN };
