'use strict';

const { models } = require('../../models');
const { RateLimitedError } = require('../../lib/errors');

/**
 * Fixed windows, not a token bucket. A booking desk sends bursts when the
 * programme goes up and then nothing for an hour, and a bucket that refills
 * smoothly punishes exactly that shape of traffic.
 */

const DEFAULTS = Object.freeze({ windowMs: 60000, max: 120 });

/**
 * What a caller is allowed, as a multiple of the configured ceiling.
 *
 * A booking screen polls the diary and a person clicks around, and holding the
 * screen to what a person needs is how a venue's own software started missing
 * updates. An admin gets more because an admin runs the reports; a viewer gets
 * the base because a viewer is reading.
 */
const ROLE_MULTIPLIERS = Object.freeze({
  viewer: 1,
  programmer: 2,
  traffic: 2,
  archivist: 2,
  admin: 4,
});

/** A machine polls, so a key gets more than the person who minted it. */
const MACHINE_MULTIPLIER = 3;

function ceilingFor(req, max) {
  if (!req.operator) return max;
  const role = ROLE_MULTIPLIERS[req.operator.role] || 1;
  const machine = req.apiKey ? MACHINE_MULTIPLIER : 1;
  return Math.round(max * role * machine);
}

function windowStart(now, windowMs) {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/** The operator if there is one, otherwise the address the call came from. */
function defaultKeyOf(req) {
  if (req.apiKey) return `key:${req.apiKey.publicId}`;
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
  perRole = true,
} = {}) {
  return async function limit(req, res, next) {
    try {
      const now = Date.now();
      const ceiling = perRole ? ceilingFor(req, max) : max;
      const { count, resetsAt } = await countRequest({
        key: `${scope}:${keyOf(req)}`,
        now,
        windowMs,
      });

      const remaining = Math.max(0, ceiling - count);
      res.set('ratelimit-limit', String(ceiling));
      res.set('ratelimit-remaining', String(remaining));
      res.set('ratelimit-reset', String(Math.ceil((resetsAt.getTime() - now) / 1000)));

      if (count > ceiling) {
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

module.exports = {
  rateLimit,
  countRequest,
  windowStart,
  defaultKeyOf,
  ceilingFor,
  ROLE_MULTIPLIERS,
  MACHINE_MULTIPLIER,
  DEFAULTS,
};
