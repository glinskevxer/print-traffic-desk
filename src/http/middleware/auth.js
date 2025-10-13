'use strict';

const { bearerFrom } = require('../../lib/tokens');
const { NotAuthenticatedError, ForbiddenError } = require('../../lib/errors');
const { withContext } = require('../../lib/context');
const authService = require('../../services/authService');

/**
 * Reads the bearer token, resolves it to a live operator and puts them in the
 * request context so every audit line downstream is signed. Whether a route
 * needs an operator at all is decided by the route, not here.
 */
function authenticate({ optional = false } = {}) {
  return async function readOperator(req, res, next) {
    const token = bearerFrom(req.get('authorization'));

    if (!token) {
      if (optional) return next();
      return next(new NotAuthenticatedError('this desk needs an operator token'));
    }

    try {
      const { claims, operator } = await authService.resolveToken(token);
      req.operator = operator;
      req.claims = claims;
      req.log = req.log.child({ operator: operator.publicId, role: operator.role });

      return withContext({ actor: operator.email, role: operator.role }, () => next());
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Roles are ordered. An archivist can do everything a viewer can, which keeps
 * the route declarations to one role each rather than a list per endpoint.
 */
const RANK = Object.freeze({ viewer: 0, programmer: 1, traffic: 1, archivist: 2, admin: 3 });

function outranks(role, needed) {
  return (RANK[role] ?? -1) >= (RANK[needed] ?? 99);
}

/**
 * Any of the named roles will do. Traffic and programmer sit at the same rank
 * and do different jobs, so a route that needs one names it rather than
 * relying on the ordering.
 */
function requireRole(...allowed) {
  return function checkRole(req, _res, next) {
    if (!req.operator) return next(new NotAuthenticatedError('this desk needs an operator token'));

    const role = req.operator.role;
    if (allowed.includes(role) || allowed.some((needed) => outranks(role, needed))) {
      return next();
    }
    return next(
      new ForbiddenError(`this needs one of ${allowed.join(', ')}, and you are ${role}`, {
        role,
        allowed,
      }),
    );
  };
}

/**
 * An operator bound to a house may only act on that house. Admins are not
 * bound, and neither is anybody with no venue on their record.
 */
function requireOwnVenue(pick) {
  return function checkVenue(req, _res, next) {
    if (!req.operator) return next(new NotAuthenticatedError('this desk needs an operator token'));
    if (!req.operator.isHouseBound()) return next();

    const asked = pick(req);
    if (!asked) return next();

    if (String(asked) !== String(req.operator.venue)) {
      return next(
        new ForbiddenError('you can only act for your own house', { venue: String(asked) }),
      );
    }
    return next();
  };
}

module.exports = { authenticate, requireRole, requireOwnVenue, outranks, RANK };
