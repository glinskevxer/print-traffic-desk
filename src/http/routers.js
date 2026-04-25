'use strict';

const { healthRoutes } = require('./routes/health');
const { authRoutes } = require('./routes/auth');
const { metricsRoutes } = require('./routes/metrics');
const { titleRoutes } = require('./routes/titles');
const { venueRoutes } = require('./routes/venues');
const { rightsHolderRoutes } = require('./routes/rightsHolders');
const { elementRoutes } = require('./routes/elements');
const { inspectionRoutes } = require('./routes/inspections');
const { rightsRoutes } = require('./routes/rights');
const { shipmentRoutes } = require('./routes/shipments');
const { bookingRoutes } = require('./routes/bookings');
const { royaltyRoutes } = require('./routes/royalties');
const { extractionRoutes } = require('./routes/extraction');
const { auditRoutes } = require('./routes/audit');
const { reportRoutes } = require('./routes/reports');

/**
 * What the desk mounts, and where.
 *
 * As a table rather than a run of app.use lines, because the order matters in
 * one specific way and that way is invisible when it is spelled out: the open
 * routers are mounted before the token middleware and everything else after
 * it, and somebody adding a router to the wrong half of the list would have
 * been adding an unauthenticated endpoint.
 */
const ROUTERS = Object.freeze([
  { path: '/health', open: true, build: (context) => healthRoutes(context) },
  { path: '/metrics', open: true, build: () => metricsRoutes() },
  { path: '/auth', open: true, build: () => authRoutes() },

  { path: '/titles', open: false, build: () => titleRoutes() },
  { path: '/venues', open: false, build: () => venueRoutes() },
  { path: '/rights-holders', open: false, build: () => rightsHolderRoutes() },
  { path: '/elements', open: false, build: () => elementRoutes() },
  // Inspections and clearance answer on more than one prefix, so they mount at
  // the root and declare their own paths.
  { path: '/', open: false, build: () => inspectionRoutes() },
  { path: '/', open: false, build: () => rightsRoutes() },
  { path: '/shipments', open: false, build: () => shipmentRoutes() },
  { path: '/bookings', open: false, build: () => bookingRoutes() },
  { path: '/royalty-statements', open: false, build: () => royaltyRoutes() },
  { path: '/extractions', open: false, build: () => extractionRoutes() },
  { path: '/audit-events', open: false, build: () => auditRoutes() },
  { path: '/reports', open: false, build: () => reportRoutes() },
]);

function openRouters() {
  return ROUTERS.filter((router) => router.open);
}

function guardedRouters() {
  return ROUTERS.filter((router) => !router.open);
}

module.exports = { ROUTERS, openRouters, guardedRouters };
