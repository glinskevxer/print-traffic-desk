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
 * Roles are not a ladder. Traffic and programmer are peers who do different
 * jobs, and an earlier ranking that let either cover the other let the traffic
 * desk write licences. Each role says exactly what else it covers.
 */
const COVERS = Object.freeze({
  viewer: [],
  programmer: ['viewer'],
  traffic: ['viewer'],
  archivist: ['viewer'],
  admin: ['viewer', 'programmer', 'traffic', 'archivist'],
});

function outranks(role, needed) {
  return (COVERS[role] || []).includes(needed);
}

/** Any of the named roles will do, plus anything that covers one of them. */
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

/** Every route past the sign in needs somebody signed in. */
function requireOperator() {
  return function checkOperator(req, _res, next) {
    if (!req.operator) return next(new NotAuthenticatedError('this desk needs an operator token'));
    return next();
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

module.exports = { authenticate, requireOperator, requireRole, requireOwnVenue, outranks, COVERS };
