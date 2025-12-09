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

  // Extraction is optional. A desk with no key still books prints; it just
  // types the licence terms in by hand.
  EXTRACTION_ENABLED: bool.default(false),
  OPENAI_API_KEY: z.string().min(20).optional(),
  OPENAI_MODEL: z.string().min(3).max(60).default('gpt-4o-mini'),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  OPENAI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(3),
  EXTRACTION_CONFIDENCE_FLOOR: z.coerce.number().min(0).max(1).default(0.7),
  EXTRACTION_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(400000),

  AUTH_JWT_SECRET: z.string().min(32).optional(),
  AUTH_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(480),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  AUTH_REQUIRED: bool.default(true),
  ALLOWED_ORIGINS: z.string().default(''),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(120),
  RATE_LIMIT_SIGN_IN_MAX: z.coerce.number().int().min(1).max(1000).default(10),
})
  .refine((env) => !env.EXTRACTION_ENABLED || Boolean(env.OPENAI_API_KEY), {
    message: 'EXTRACTION_ENABLED needs OPENAI_API_KEY',
    path: ['OPENAI_API_KEY'],
  })
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.AUTH_JWT_SECRET), {
    message: 'a production desk has to be given AUTH_JWT_SECRET',
    path: ['AUTH_JWT_SECRET'],
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
    rateLimit: Object.freeze({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      signInMax: env.RATE_LIMIT_SIGN_IN_MAX,
    }),
    http: Object.freeze({
      port: env.PORT,
      allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    }),
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
    auth: Object.freeze({
      required: env.AUTH_REQUIRED,
      secret: env.AUTH_JWT_SECRET,
      tokenTtlMinutes: env.AUTH_TOKEN_TTL_MINUTES,
      maxFailedAttempts: env.AUTH_MAX_FAILED_ATTEMPTS,
      lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
    }),
    extraction: Object.freeze({
      enabled: env.EXTRACTION_ENABLED,
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      baseUrl: env.OPENAI_BASE_URL,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      maxAttempts: env.OPENAI_MAX_ATTEMPTS,
      confidenceFloor: env.EXTRACTION_CONFIDENCE_FLOOR,
      dailyTokenBudget: env.EXTRACTION_DAILY_TOKEN_BUDGET,
    }),
  });
}

let cached = null;

/** Process wide accessor. Loads .env on first use outside of tests. */
function config() {
  if (cached) return cached;
  if (process.env.NODE_ENV !== 'test') {
     
    require('dotenv').config();
  }
  cached = parseEnv(process.env);
  return cached;
}

function resetConfigForTests() {
  cached = null;
}

module.exports = { parseEnv, config, resetConfigForTests, schema };
