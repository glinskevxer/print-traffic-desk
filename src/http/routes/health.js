'use strict';

const { Router } = require('express');
const { isConnected, ping, replicaSetHealth } = require('../../db/connection');
const { config } = require('../../config/env');
const { buildInfo } = require('../../lib/build');
const { openapiDocument } = require('../openapi');

/**
 * Two endpoints on purpose. Liveness says the process is up, readiness says it
 * can serve, and a load balancer that conflates them restarts a healthy service
 * every time mongo hiccups.
 */
function healthRoutes({ startedAt }) {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  });

  /**
   * Ready means the desk can take a booking. That needs a primary to write to,
   * so a replica set with no primary is not ready however well it answers a
   * ping. Lag on a secondary is reported and does not make the desk unready:
   * every read the desk does goes to the primary.
   */
  router.get('/ready', async (_req, res) => {
    if (!isConnected()) {
      return res.status(503).json({ status: 'not-ready', checks: { mongo: 'disconnected' } });
    }

    try {
      const roundTripMs = await ping();
      const replicaSet = await replicaSetHealth().catch(() => null);

      if (replicaSet && !replicaSet.hasPrimary) {
        return res.status(503).json({
          status: 'not-ready',
          checks: { mongo: 'no primary to write to' },
          replicaSet,
        });
      }

      return res.json({
        status: 'ready',
        checks: {
          mongo: 'ok',
          // Extraction is optional, so it is reported and never gates readiness.
          extraction: extractionState(),
        },
        roundTripMs,
        replicaSet,
      });
    } catch (err) {
      return res.status(503).json({ status: 'not-ready', checks: { mongo: err.message } });
    }
  });

  function extractionState() {
    try {
      return config().extraction.enabled ? 'enabled' : 'off';
    } catch (err) {
      return 'unknown';
    }
  }

  // The description of the API sits beside health because both are open: a
  // client generator should not need a session to read the shape of the desk.
  router.get('/openapi.json', (req, res) => {
    res.json(openapiDocument({ servers: [{ url: `${req.protocol}://${req.get('host')}` }] }));
  });

  router.get('/version', (_req, res) => {
    res.json(buildInfo());
  });

  return router;
}

module.exports = { healthRoutes };
