'use strict';

const { models } = require('../../models');
const { RateLimitedError } = require('../../lib/errors');

/**
 * Fixed windows, not a token bucket. A booking desk sends bursts when the
 * programme goes up and then nothing for an hour, and a bucket that refills
 * smoothly punishes exactly that shape of traffic.
 */

const DEFAULTS = Object.freeze({ windowMs: 60000, max: 120 });

function windowStart(now, windowMs) {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/** The operator if there is one, otherwise the address the call came from. */
function defaultKeyOf(req) {
  if (req.operator) return `op:${req.operator.publicId}`;
  return `ip:${req.ip || 'unknown'}`;
}

async function countRequest({ key, now, windowMs }) {
  const { RateCounter } = models();
  const startedAt = windowStart(now, windowMs);

  const counter = await RateCounter.findOneAndUpdate(
    { key, windowStartedAt: startedAt },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date(startedAt.getTime() + windowMs * 2) },
    },
    { upsert: true, new: true },
  );

  return { count: counter.count, resetsAt: new Date(startedAt.getTime() + windowMs) };
}

/**
 * Answers with the standard headers whether it refused or not, so a client can
 * slow down before it is told to.
 */
function rateLimit({
  windowMs = DEFAULTS.windowMs,
  max = DEFAULTS.max,
  keyOf = defaultKeyOf,
  scope = 'all',
} = {}) {
  return async function limit(req, res, next) {
    try {
      const now = Date.now();
      const { count, resetsAt } = await countRequest({
        key: `${scope}:${keyOf(req)}`,
        now,
        windowMs,
      });

      const remaining = Math.max(0, max - count);
      res.set('ratelimit-limit', String(max));
      res.set('ratelimit-remaining', String(remaining));
      res.set('ratelimit-reset', String(Math.ceil((resetsAt.getTime() - now) / 1000)));

      if (count > max) {
        return next(new RateLimitedError(Math.ceil((resetsAt.getTime() - now) / 1000)));
      }
      return next();
    } catch (err) {
      // A counter that cannot be written is not a reason to refuse a booking.
      req.log.warn({ err }, 'rate limit counter unavailable, letting the request through');
      return next();
    }
  };
}

module.exports = { rateLimit, countRequest, windowStart, defaultKeyOf, DEFAULTS };
