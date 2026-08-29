'use strict';

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

/**
 * Everything the shipped code reaches for has to be declared.
 *
 * The production image installs with `--omit=dev`, so a require that resolves
 * on a developer machine because some other package happens to bring it along
 * resolves to nothing there. That is a crash on the first request, in the one
 * environment nobody runs the tests in.
 *
 * A script that nothing calls is the same problem waiting: it passes review
 * because it looks harmless and breaks the day somebody wires it up.
 */

const ROOT = path.join(__dirname, '..', '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const DECLARED = new Set(Object.keys(manifest.dependencies || {}));
const DEV = new Set(Object.keys(manifest.devDependencies || {}));
const BUILTIN = new Set(builtinModules);

function jsFilesUnder(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...jsFilesUnder(full));
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

/** Bare specifiers only: a relative path is this repository's own problem. */
function requiredPackages(file) {
  const body = fs.readFileSync(file, 'utf8');
  const specifiers = [...body.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);

  return specifiers
    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/'))
    .map((specifier) =>
      specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0],
    );
}

function undeclaredIn(directories, allowed) {
  const bad = [];
  for (const directory of directories) {
    for (const file of jsFilesUnder(path.join(ROOT, directory))) {
      for (const pkg of requiredPackages(file)) {
        if (BUILTIN.has(pkg) || allowed.has(pkg)) continue;
        bad.push(`${path.relative(ROOT, file)} requires ${pkg}`);
      }
    }
  }
  return bad;
}

describe('only depend on what is declared', () => {
  it('finds the requires in a file, ignoring the relative ones', () => {
    const packages = requiredPackages(path.join(ROOT, 'src', 'http', 'app.js'));

    expect(packages).toContain('express');
    expect(packages.every((pkg) => !pkg.startsWith('.'))).toBe(true);
  });

  it('reads the builtins this very file asks for', () => {
    const file = path.join(ROOT, 'tests', 'unit', 'scripts', 'dependencies.test.js');

    expect(requiredPackages(file)).toEqual(expect.arrayContaining(['fs', 'path', 'module']));
  });

  it('requires nothing from src that a production install would not have', () => {
    expect(undeclaredIn(['src'], DECLARED)).toEqual([]);
  });

  it('requires nothing from scripts that a checkout would not have', () => {
    // Scripts run from a checkout, where the dev dependencies are installed,
    // but they still may not reach for something nobody declared at all.
    expect(undeclaredIn(['scripts'], new Set([...DECLARED, ...DEV]))).toEqual([]);
  });

  it('keeps every script something actually calls', () => {
    const callers = [
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'Makefile'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'),
      fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
      ...jsFilesUnder(path.join(ROOT, 'tests')).map((file) => fs.readFileSync(file, 'utf8')),
    ].join('\n');

    const orphans = fs
      .readdirSync(path.join(ROOT, 'scripts'))
      .filter((name) => name.endsWith('.js'))
      .filter((name) => !callers.includes(name));

    expect(orphans).toEqual([]);
  });

  it('declares every runtime package the desk actually uses', () => {
    for (const pkg of ['express', 'mongoose', 'zod', 'luxon', 'pino', 'openai', 'jsonwebtoken']) {
      expect(DECLARED.has(pkg)).toBe(true);
    }
  });

  it('keeps the test tooling out of what ships', () => {
    for (const pkg of ['jest', 'supertest', 'mongodb-memory-server', 'eslint', 'prettier']) {
      expect(DEV.has(pkg)).toBe(true);
      expect(DECLARED.has(pkg)).toBe(false);
    }
  });
});

describe('pretty logging is optional', () => {
  const { createLogger, prettyAvailable } = require('../../../src/lib/logger');

  it('says whether the pretty printer is installed in this build', () => {
    expect(typeof prettyAvailable()).toBe('boolean');
  });

  it('is a development dependency, so a production image will not have it', () => {
    expect(DEV.has('pino-pretty')).toBe(true);
    expect(DECLARED.has('pino-pretty')).toBe(false);
  });

  it('builds a logger either way rather than taking the process down', () => {
    const log = createLogger({ pretty: true, level: 'silent' });

    expect(typeof log.info).toBe('function');
  });
});
