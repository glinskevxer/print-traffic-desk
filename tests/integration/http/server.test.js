'use strict';

const http = require('http');
const { useDatabase, closeTestConnection, testDatabaseUri } = require('../../helpers/db');
const { createLogger } = require('../../../src/lib/logger');
const { start, trackConnections } = require('../../../src/http/server');
const { isConnected } = require('../../../src/db/connection');

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

describe('starting and stopping the desk', () => {
  const log = createLogger({ level: 'silent' });
  let cfg;

  beforeAll(async () => {
    await useDatabase();
    await closeTestConnection();
    cfg = {
      nodeEnv: 'test',
      isProduction: false,
      mongo: { uri: testDatabaseUri(), maxPoolSize: 5, serverSelectionTimeoutMs: 5000 },
      http: { port: 0, allowedOrigins: [] },
      rateLimit: null,
      serviceName: 'printdesk',
    };
  });

  afterAll(async () => {
    await closeTestConnection();
  });

  it('listens, answers and then closes cleanly', async () => {
    const handle = await start({ cfg, log });
    const { port } = handle.server.address();

    const live = await get(port, '/health/live');
    expect(live.status).toBe(200);
    expect(isConnected()).toBe(true);

    await handle.shutdown('TEST');

    expect(isConnected()).toBe(false);
    await expect(get(port, '/health/live')).rejects.toThrow();
  });

  it('is ready once it is up', async () => {
    const handle = await start({ cfg, log });
    const { port } = handle.server.address();

    const ready = await get(port, '/health/ready');
    expect(JSON.parse(ready.body).status).toBe('ready');

    await handle.shutdown('TEST');
  });

  it('shutting down twice does the work once', async () => {
    const handle = await start({ cfg, log });

    await handle.shutdown('TEST');
    await expect(handle.shutdown('TEST')).resolves.toBeUndefined();
  });

  it('counts the sockets it is holding open', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    const connections = trackConnections(server);
    await new Promise((resolve) => server.listen(0, resolve));

    expect(connections.count()).toBe(0);
    await get(server.address().port, '/');

    connections.destroyAll();
    await new Promise((resolve) => server.close(resolve));
  });
});
