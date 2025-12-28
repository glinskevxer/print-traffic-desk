'use strict';

const { Router } = require('express');
const { asyncHandler } = require('../asyncHandler');
const { registry, installDefaults } = require('../../lib/metrics');
const { models } = require('../../models');
const { isConnected } = require('../../db/connection');

/**
 * What the desk is worth alerting on. The gauges are queries, so a scrape
 * costs a handful of counts and always reads the truth rather than whatever
 * the last write happened to leave in a variable.
 */
async function countOrZero(query) {
  if (!isConnected()) return 0;
  try {
    return await query();
  } catch (err) {
    return -1;
  }
}

function installDeskGauges(target = registry) {
  target.gauge('printdesk_bookings_held', 'holds nobody has confirmed yet', () =>
    countOrZero(() => models().Booking.countDocuments({ status: 'held' })),
  );
  target.gauge('printdesk_elements_quarantined', 'prints off the shelf on condition', () =>
    countOrZero(() => models().PrintElement.countDocuments({ status: 'quarantined' })),
  );
  target.gauge('printdesk_shipments_open', 'legs planned or on the road', () =>
    countOrZero(() =>
      models().Shipment.countDocuments({
        status: { $in: ['planned', 'collected', 'in-transit', 'delayed'] },
      }),
    ),
  );
  target.gauge('printdesk_extractions_awaiting_review', 'readings waiting for a human', () =>
    countOrZero(() =>
      models().ExtractionJob.countDocuments({ status: 'succeeded', needsHumanReview: true }),
    ),
  );
  return target;
}

function metricsRoutes({ target = registry } = {}) {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      // Declared on every scrape rather than once at boot. Both calls are
      // map lookups, and it means a registry cleared underneath the desk comes
      // back with its series rather than silently exporting nothing.
      installDefaults(target);
      installDeskGauges(target);
      res.set('content-type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(await target.render());
    }),
  );

  return router;
}

module.exports = { metricsRoutes, installDeskGauges, countOrZero };
