'use strict';

const { ValidationError } = require('../lib/errors');

/**
 * A very small argument parser. The desk has eight commands and a dependency
 * that parses arguments brings four of its own, so this stays hand written.
 *
 * Supported: --flag, --key value, --key=value, -k value, and positionals.
 * Everything after a bare -- is a positional whatever it looks like.
 */
function parseArgs(argv, spec = {}) {
  const options = {};
  const positionals = [];
  let literal = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (literal) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      literal = true;
      continue;
    }
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const [rawName, inlineValue] = splitToken(token);
    const name = resolveName(rawName, spec);
    const definition = spec[name] || {};

    if (definition.type === 'boolean') {
      options[name] = inlineValue === undefined ? true : inlineValue !== 'false';
      continue;
    }

    const value = inlineValue !== undefined ? inlineValue : argv[++i];
    if (value === undefined) {
      throw new ValidationError(`--${name} needs a value`, [
        { key: name, problem: 'missing value' },
      ]);
    }
    options[name] = coerce(value, definition.type);
  }

  return { options: withDefaults(options, spec), positionals };
}

function splitToken(token) {
  const stripped = token.replace(/^--?/, '');
  const equals = stripped.indexOf('=');
  if (equals === -1) return [stripped, undefined];
  return [stripped.slice(0, equals), stripped.slice(equals + 1)];
}

function resolveName(rawName, spec) {
  if (spec[rawName]) return rawName;
  const byAlias = Object.entries(spec).find(([, definition]) => definition.alias === rawName);
  return byAlias ? byAlias[0] : rawName;
}

function coerce(value, type) {
  if (type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new ValidationError(`${value} is not a number`, [
        { key: 'value', problem: 'not a number' },
      ]);
    }
    return parsed;
  }
  return value;
}

function withDefaults(options, spec) {
  const filled = { ...options };
  for (const [name, definition] of Object.entries(spec)) {
    if (filled[name] === undefined && definition.default !== undefined) {
      filled[name] = definition.default;
    }
    if (filled[name] === undefined && definition.required) {
      throw new ValidationError(`--${name} is needed`, [{ key: name, problem: 'missing' }]);
    }
  }
  return filled;
}

/** The help text for one command, built from its own option spec. */
function usageFor(command) {
  const lines = [`printdesk ${command.name} - ${command.describe}`, ''];
  const spec = command.options || {};

  if (Object.keys(spec).length > 0) {
    lines.push('Options:');
    for (const [name, definition] of Object.entries(spec)) {
      const alias = definition.alias ? `-${definition.alias}, ` : '    ';
      const value = definition.type === 'boolean' ? '' : ` <${definition.type || 'string'}>`;
      const suffix = definition.default !== undefined ? ` (default ${definition.default})` : '';
      lines.push(`  ${alias}--${name}${value}  ${definition.describe || ''}${suffix}`);
    }
  }
  return lines.join('\n');
}

module.exports = { parseArgs, usageFor, coerce, resolveName };
