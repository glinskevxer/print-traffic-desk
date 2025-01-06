'use strict';

const { z } = require('zod');
const { ConfigError } = require('../lib/errors');

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4010),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SERVICE_NAME: z.string().min(1).default('printdesk'),

  MONGO_URI: z.string().refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
    message: 'must be a mongodb:// or mongodb+srv:// connection string',
  }),
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(10),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(8000),

  DEFAULT_TERRITORY: z
    .string()
    .regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 territory code')
    .default('GB'),
  DEFAULT_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 currency code')
    .default('GBP'),
  HOLD_TTL_MINUTES: z.coerce.number().int().min(15).max(20160).default(2880),
  INSPECTION_INTERVAL_SCREENINGS: z.coerce.number().int().min(1).max(60).default(6),

  PRETTY_LOGS: bool.default(false),
});

/**
 * Reads configuration once, from a plain object rather than process.env
 * directly, so tests can hand in a fixture without mutating the process.
 */
function parseEnv(source = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      key: issue.path.join('.'),
      problem: issue.message,
    }));
    const summary = issues.map((i) => `${i.key}: ${i.problem}`).join('; ');
    throw new ConfigError(`environment is not usable (${summary})`, { issues });
  }

  const env = result.data;
  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    serviceName: env.SERVICE_NAME,
    http: Object.freeze({ port: env.PORT }),
    logging: Object.freeze({ level: env.LOG_LEVEL, pretty: env.PRETTY_LOGS }),
    mongo: Object.freeze({
      uri: env.MONGO_URI,
      maxPoolSize: env.MONGO_MAX_POOL_SIZE,
      serverSelectionTimeoutMs: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    }),
    desk: Object.freeze({
      defaultTerritory: env.DEFAULT_TERRITORY,
      defaultCurrency: env.DEFAULT_CURRENCY,
      holdTtlMinutes: env.HOLD_TTL_MINUTES,
      inspectionIntervalScreenings: env.INSPECTION_INTERVAL_SCREENINGS,
    }),
  });
}

let cached = null;

/** Process wide accessor. Loads .env on first use outside of tests. */
function config() {
  if (cached) return cached;
  if (process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line global-require
    require('dotenv').config();
  }
  cached = parseEnv(process.env);
  return cached;
}

function resetConfigForTests() {
  cached = null;
}

module.exports = { parseEnv, config, resetConfigForTests, schema };
