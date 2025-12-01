'use strict';

const http = require('http');

/**
 * The container health check. It asks for readiness rather than liveness,
 * because a desk that cannot reach mongo should be taken out of the load
 * balancer even though the process is perfectly alive.
 *
 * Written in node rather than as a curl one liner so the runtime image does
 * not have to carry curl.
 */

const PORT = Number(process.env.PORT || 4010);
const TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 3000);

const request = http.get(
  { host: '127.0.0.1', port: PORT, path: '/health/ready', timeout: TIMEOUT_MS },
  (response) => {
    let body = '';
    response.on('data', (chunk) => {
      body += chunk;
    });
    response.on('end', () => {
      if (response.statusCode === 200) {
        process.exit(0);
      }
      process.stderr.write(`not ready: ${response.statusCode} ${body}\n`);
      process.exit(1);
    });
  },
);

request.on('timeout', () => {
  request.destroy();
  process.stderr.write(`no answer within ${TIMEOUT_MS}ms\n`);
  process.exit(1);
});

request.on('error', (err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
