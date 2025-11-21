'use strict';

const { parseArgs, usageFor } = require('../../../src/cli/args');
const { ValidationError } = require('../../../src/lib/errors');

const spec = {
  since: { type: 'string', describe: 'from this date' },
  limit: { type: 'number', alias: 'n', default: 50 },
  dryRun: { type: 'boolean', alias: 'd' },
  required: { type: 'string', required: true },
};

describe('command line arguments', () => {
  it('reads a key and a value', () => {
    const { options } = parseArgs(['--since', '2025-06-01', '--required', 'x'], spec);

    expect(options.since).toBe('2025-06-01');
  });

  it('reads a key and value joined by an equals', () => {
    const { options } = parseArgs(['--since=2025-06-01', '--required=x'], spec);

    expect(options.since).toBe('2025-06-01');
  });

  it('reads a short alias', () => {
    const { options } = parseArgs(['-n', '10', '--required', 'x'], spec);

    expect(options.limit).toBe(10);
  });

  it('turns a number option into a number', () => {
    const { options } = parseArgs(['--limit', '25', '--required', 'x'], spec);

    expect(options.limit).toBe(25);
  });

  it('refuses a number that is not one', () => {
    expect(() => parseArgs(['--limit', 'lots', '--required', 'x'], spec)).toThrow(ValidationError);
  });

  it('takes a flag with no value', () => {
    const { options } = parseArgs(['--dryRun', '--required', 'x'], spec);

    expect(options.dryRun).toBe(true);
  });

  it('takes a flag turned off explicitly', () => {
    const { options } = parseArgs(['--dryRun=false', '--required', 'x'], spec);

    expect(options.dryRun).toBe(false);
  });

  it('fills in the defaults', () => {
    const { options } = parseArgs(['--required', 'x'], spec);

    expect(options.limit).toBe(50);
    expect(options.dryRun).toBeUndefined();
  });

  it('insists on what is required', () => {
    expect(() => parseArgs([], spec)).toThrow(/--required is needed/);
  });

  it('refuses a key with nothing after it', () => {
    expect(() => parseArgs(['--required'], spec)).toThrow(/needs a value/);
  });

  it('collects the positionals', () => {
    const { positionals } = parseArgs(['build', 'rh_ABC', '--required', 'x'], spec);

    expect(positionals).toEqual(['build', 'rh_ABC']);
  });

  it('treats everything after a bare double dash as a positional', () => {
    const { positionals } = parseArgs(['--required', 'x', '--', '--not-an-option'], spec);

    expect(positionals).toEqual(['--not-an-option']);
  });

  it('writes the help from the option list', () => {
    const help = usageFor({ name: 'seed', describe: 'fill a fresh desk', options: spec });

    expect(help).toContain('printdesk seed - fill a fresh desk');
    expect(help).toContain('-n, --limit <number>');
    expect(help).toContain('(default 50)');
  });

  it('writes help for a command with no options at all', () => {
    expect(usageFor({ name: 'reindex', describe: 'rebuild indexes' })).toContain('reindex');
  });
});
