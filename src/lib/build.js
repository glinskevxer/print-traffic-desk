'use strict';

const fs = require('fs');
const path = require('path');
const { version } = require('../../package.json');

/**
 * What is actually deployed.
 *
 * "Which version is on production" has been answered wrongly enough times to
 * be worth a real answer: the commit, when the image was built and which node
 * it is running on. The image writes a build file at build time; running from
 * a checkout falls back to reading git, and running from neither says so
 * rather than making something up.
 */

const BUILD_FILE = path.join(__dirname, '..', '..', 'build.json');

function fromFile() {
  if (!fs.existsSync(BUILD_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(BUILD_FILE, 'utf8'));
    return { commit: parsed.commit || null, builtAt: parsed.builtAt || null, source: 'image' };
  } catch (err) {
    return null;
  }
}

function fromGit(readHead) {
  const head = readHead();
  return head ? { commit: head, builtAt: null, source: 'checkout' } : null;
}

function defaultReadHead() {
  try {
    const { execFileSync } = require('child_process');
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.join(__dirname, '..', '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (err) {
    return null;
  }
}

function buildInfo({ readHead = defaultReadHead, env = process.env } = {}) {
  const found = fromFile() ||
    fromGit(readHead) || { commit: null, builtAt: null, source: 'unknown' };

  return {
    service: 'printdesk',
    version,
    commit: found.commit,
    shortCommit: found.commit ? found.commit.slice(0, 7) : null,
    builtAt: found.builtAt,
    source: found.source,
    node: process.version,
    environment: env.NODE_ENV || 'development',
  };
}

module.exports = { buildInfo, fromFile, fromGit, BUILD_FILE };
