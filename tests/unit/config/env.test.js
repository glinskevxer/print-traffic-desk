'use strict';

const { parseEnv } = require('../../../src/config/env');
const { ConfigError } = require('../../../src/lib/errors');

const base = { MONGO_URI: 'mongodb://127.0.0.1:27017/printdesk-test' };

describe('parseEnv', () => {
  it('fills in the desk defaults when only the connection string is given', () => {
    const cfg = parseEnv(base);

    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.http.port).toBe(4010);
    expect(cfg.desk.defaultTerritory).toBe('GB');
    expect(cfg.desk.defaultCurrency).toBe('GBP');
    expect(cfg.desk.holdTtlMinutes).toBe(2880);
    expect(cfg.desk.inspectionIntervalScreenings).toBe(6);
  });

  it('coerces the numeric settings that arrive as strings', () => {
    const cfg = parseEnv({ ...base, PORT: '8080', MONGO_MAX_POOL_SIZE: '25' });

    expect(cfg.http.port).toBe(8080);
    expect(cfg.mongo.maxPoolSize).toBe(25);
  });

  it('reads the boolean flags in either spelling', () => {
    expect(parseEnv({ ...base, PRETTY_LOGS: 'true' }).logging.pretty).toBe(true);
    expect(parseEnv({ ...base, PRETTY_LOGS: '1' }).logging.pretty).toBe(true);
    expect(parseEnv({ ...base, PRETTY_LOGS: 'false' }).logging.pretty).toBe(false);
  });

  it('refuses a connection string that is not mongo', () => {
    expect(() => parseEnv({ MONGO_URI: 'postgres://localhost/printdesk' })).toThrow(ConfigError);
  });

  it('reports every broken key at once rather than the first', () => {
    let caught;
    try {
      parseEnv({ MONGO_URI: 'nope', PORT: '0', DEFAULT_CURRENCY: 'pounds' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const keys = caught.details.issues.map((i) => i.key).sort();
    expect(keys).toEqual(['DEFAULT_CURRENCY', 'MONGO_URI', 'PORT']);
  });

  it('rejects a territory that is not two upper case letters', () => {
    expect(() => parseEnv({ ...base, DEFAULT_TERRITORY: 'gbr' })).toThrow(/DEFAULT_TERRITORY/);
  });

  it('hands back a frozen object so nothing can retune the desk at runtime', () => {
    const cfg = parseEnv(base);

    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.desk)).toBe(true);
    expect(() => Object.assign(cfg.desk, { holdTtlMinutes: 1 })).toThrow();
  });
});

describe('extraction settings', () => {
  const base = { MONGO_URI: 'mongodb://127.0.0.1:27017/printdesk-test' };

  it('is off unless the desk turns it on', () => {
    const cfg = parseEnv(base);

    expect(cfg.extraction.enabled).toBe(false);
    expect(cfg.extraction.model).toBe('gpt-4o-mini');
    expect(cfg.extraction.confidenceFloor).toBe(0.7);
  });

  it('will not turn extraction on without a key to call with', () => {
    expect(() => parseEnv({ ...base, EXTRACTION_ENABLED: 'true' })).toThrow(/OPENAI_API_KEY/);
  });

  it('takes the key and the model when extraction is on', () => {
    const cfg = parseEnv({
      ...base,
      EXTRACTION_ENABLED: 'true',
      OPENAI_API_KEY: 'sk-test-000000000000000000',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_MAX_ATTEMPTS: '5',
    });

    expect(cfg.extraction.enabled).toBe(true);
    expect(cfg.extraction.model).toBe('gpt-4o');
    expect(cfg.extraction.maxAttempts).toBe(5);
  });

  it('refuses a key too short to be one', () => {
    expect(() =>
      parseEnv({ ...base, EXTRACTION_ENABLED: 'true', OPENAI_API_KEY: 'sk-1' }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('refuses a base url that is not a url', () => {
    expect(() => parseEnv({ ...base, OPENAI_BASE_URL: 'not a url' })).toThrow(/OPENAI_BASE_URL/);
  });

  it('holds a daily token budget', () => {
    expect(parseEnv({ ...base, EXTRACTION_DAILY_TOKEN_BUDGET: '1000' }).extraction.dailyTokenBudget)
      .toBe(1000);
  });
});
