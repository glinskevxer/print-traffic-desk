'use strict';

const { Router } = require('express');
const { isConnected, ping } = require('../../db/connection');
const { openapiDocument } = require('../openapi');

/**
 * Two endpoints on purpose. Liveness says the process is up, readiness says it
 * can serve, and a load balancer that conflates them restarts a healthy service
 * every time mongo hiccups.
 */
function healthRoutes({ version, startedAt }) {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  });

  router.get('/ready', async (_req, res) => {
    if (!isConnected()) {
      return res.status(503).json({ status: 'not-ready', checks: { mongo: 'disconnected' } });
    }
    try {
      const roundTripMs = await ping();
      return res.json({ status: 'ready', checks: { mongo: 'ok' }, roundTripMs });
    } catch (err) {
      return res.status(503).json({ status: 'not-ready', checks: { mongo: err.message } });
    }
  });

  // The description of the API sits beside health because both are open: a
  // client generator should not need a session to read the shape of the desk.
  router.get('/openapi.json', (req, res) => {
    res.json(openapiDocument({ servers: [{ url: `${req.protocol}://${req.get('host')}` }] }));
  });

  router.get('/version', (_req, res) => {
    res.json({ service: 'printdesk', version, node: process.version });
  });

  return router;
}

module.exports = { healthRoutes };
