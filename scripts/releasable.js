'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Is this tree fit to deploy.
 *
 * Everything here has caught something at least once: a version that was never
 * bumped, a lock file that did not match the manifest, a .env committed by
 * accident, and a describe.only that quietly turned the suite into one test.
 * It runs before a release, not on every push, because it is slow.
 */

const ROOT = path.join(__dirname, '..');

function run(command, args) {
  return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

/**
 * Whether this tree came out of git at all.
 *
 * A `git archive` export has every file and no history, which is what a
 * container image holds and what somebody unpacking a tarball has. The checks
 * that ask git something cannot answer there, and saying so is more use than
 * passing on git's own complaint about a missing .git directory.
 */
function isCheckout() {
  return fs.existsSync(path.join(ROOT, '.git'));
}

function needsCheckout(name) {
  throw new Error(`${name} needs a git checkout, and this is not one`);
}

function check(name, fn) {
  try {
    const detail = fn();
    return { name, ok: true, detail: detail || 'ok' };
  } catch (err) {
    return { name, ok: false, detail: String(err.message).split('\n')[0] };
  }
}

function nothingUncommitted() {
  if (!isCheckout()) needsCheckout('the committed state');
  const status = run('git', ['status', '--porcelain']).trim();
  if (status) throw new Error(`${status.split('\n').length} files are not committed`);
  return 'the tree is clean';
}

function versionIsNew() {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} is not a version`);
  // An export has the version but no tags to compare it against, and saying
  // what it can see is more use than refusing to answer at all.
  if (!isCheckout()) return `version ${version}, and no history to compare it against`;

  const tags = run('git', ['tag', '--list'])
    .split('\n')
    .map((tag) => tag.trim());
  if (tags.includes(`v${version}`)) throw new Error(`v${version} has already been released`);
  return `version ${version}`;
}

function lockMatchesManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

  if (lock.version !== manifest.version) {
    throw new Error(`the lock file says ${lock.version} and the manifest says ${manifest.version}`);
  }
  const declared = Object.keys(manifest.dependencies || {});
  const missing = declared.filter((name) => !lock.packages[`node_modules/${name}`]);
  if (missing.length > 0) throw new Error(`${missing.join(', ')} is not in the lock file`);
  return `${declared.length} dependencies locked`;
}

function noSecretsCommitted() {
  if (!isCheckout()) needsCheckout('the committed file list');
  const tracked = run('git', ['ls-files']).split('\n');
  const bad = tracked.filter((file) => /^\.env(\..+)?$/.test(file) && file !== '.env.example');
  if (bad.length > 0) throw new Error(`${bad.join(', ')} is committed`);
  return 'no environment file is committed';
}

/**
 * git grep exits 1 when it finds nothing, which here is the good case, so a
 * non zero exit is not a failure and has to be read rather than thrown on.
 */
function grepTests(pattern) {
  if (!isCheckout()) needsCheckout('a search of the committed tests');
  try {
    return run('git', ['grep', '-nE', pattern, '--', 'tests/']).trim().split('\n').filter(Boolean);
  } catch (err) {
    if (err.status === 1) return [];
    throw err;
  }
}

/** A focused test passes the suite while running almost none of it. */
function noFocusedTests() {
  const focused = grepTests('(describe|it|test)\\.only\\(');
  if (focused.length > 0) throw new Error(`${focused.length} focused: ${focused[0]}`);
  return 'nothing is focused';
}

function noSkippedTests() {
  const skipped = grepTests('(describe|it|test)\\.skip\\(');
  if (skipped.length > 0) throw new Error(`${skipped.length} skipped: ${skipped[0]}`);
  return 'nothing is skipped';
}

function nodeVersionMatches() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const nvmrc = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

  if (!dockerfile.includes(`node:${nvmrc}`)) {
    throw new Error(`the image is not built on node ${nvmrc}`);
  }
  if (!manifest.engines || !manifest.engines.node)
    throw new Error('no engines.node in the manifest');
  return `node ${nvmrc} everywhere`;
}

const CHECKS = Object.freeze([
  ['the tree is committed', nothingUncommitted],
  ['the version is new', versionIsNew],
  ['the lock file matches', lockMatchesManifest],
  ['no secrets committed', noSecretsCommitted],
  ['no focused tests', noFocusedTests],
  ['no skipped tests', noSkippedTests],
  ['node version agrees', nodeVersionMatches],
]);

function releasable() {
  return CHECKS.map(([name, fn]) => check(name, fn));
}

function main() {
  const results = releasable();
  const width = Math.max(...results.map((result) => result.name.length));

  for (const result of results) {
    process.stdout.write(
      `${result.ok ? 'ok  ' : 'no  '}${result.name.padEnd(width)}  ${result.detail}\n`,
    );
  }

  const failed = results.filter((result) => !result.ok);
  process.stdout.write(`\n${results.length - failed.length} of ${results.length} checks passed\n`);
  if (failed.length > 0) {
    process.stdout.write('run make check and fix the above before releasing\n');
  }
  return failed.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { releasable, CHECKS, check, isCheckout };
