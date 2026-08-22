'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * What changed since the last release, grouped by the part of the desk it
 * touched.
 *
 * The grouping is worked out from the files a commit changed rather than from
 * a prefix on the message, because nobody on this project writes prefixes and
 * a convention nobody follows produces a changelog nobody trusts.
 */

const ROOT = path.join(__dirname, '..');
// One space between the hash and the subject, because a null byte cannot be
// passed to a child process argument and git's own default is a space anyway.
const SEPARATOR = ' ';

const AREAS = Object.freeze([
  { name: 'rights and clearance', matches: /^src\/(domain\/rights|services\/rightsService)/ },
  { name: 'bookings', matches: /^src\/(services\/bookingService|http\/routes\/bookings)/ },
  { name: 'print traffic', matches: /^src\/(domain\/traffic|services\/shipmentService)/ },
  {
    name: 'the shelf',
    matches: /^src\/(domain\/(elements|condition)|services\/(element|inspection))/,
  },
  { name: 'money', matches: /^src\/(domain\/royalties|services\/royalty)/ },
  { name: 'reading documents', matches: /^src\/ai\// },
  {
    name: 'operators and keys',
    matches: /^src\/(services\/authService|models\/(operator|apiKey))/,
  },
  { name: 'the http layer', matches: /^src\/http\// },
  { name: 'the command line', matches: /^src\/cli\// },
  { name: 'the worker', matches: /^src\/workers\// },
  { name: 'plumbing', matches: /^src\// },
  { name: 'tests', matches: /^tests\// },
  {
    name: 'build and deployment',
    matches: /^(Dockerfile|docker-compose|Makefile|\.github|scripts)/,
  },
]);

function run(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

/**
 * The last release, or nothing on a repository that has never had one. git
 * writes its own complaint to stderr for that case, which is not a failure
 * here, so stderr is swallowed.
 */
function lastTag() {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (err) {
    return null;
  }
}

function commitsSince(since) {
  const range = since ? `${since}..HEAD` : 'HEAD';
  const log = run(['log', range, `--format=%H${SEPARATOR}%s`]).trim();
  if (!log) return [];

  return log.split('\n').map((line) => {
    // Split once: a subject has spaces in it and git puts the hash first.
    const at = line.indexOf(SEPARATOR);
    const hash = line.slice(0, at);
    const subject = line.slice(at + 1);
    const files = run(['show', '--name-only', '--format=', hash])
      .trim()
      .split('\n')
      .filter(Boolean);
    return { hash, subject, files };
  });
}

/** A commit belongs to the first area any of its files matches. */
function areaOf(files) {
  for (const area of AREAS) {
    if (files.some((file) => area.matches.test(file))) return area.name;
  }
  return 'everything else';
}

function group(commits) {
  const grouped = new Map();
  for (const commit of commits) {
    const area = areaOf(commit.files);
    if (!grouped.has(area)) grouped.set(area, []);
    grouped.get(area).push(commit);
  }
  return grouped;
}

function render(version, commits) {
  const grouped = group(commits);
  const order = [...AREAS.map((area) => area.name), 'everything else'];
  const lines = [`## ${version}`, ''];

  for (const area of order) {
    const inArea = grouped.get(area);
    if (!inArea) continue;
    lines.push(`### ${area}`, '');
    for (const commit of inArea) {
      lines.push(`- ${commit.subject} (${commit.hash.slice(0, 7)})`);
    }
    lines.push('');
  }

  lines.push(`${commits.length} commits.`);
  return lines.join('\n');
}

function main() {
  const version = process.argv[2] || 'unreleased';
  const since = lastTag();
  const commits = commitsSince(since);

  if (commits.length === 0) {
    process.stdout.write(`nothing since ${since || 'the beginning'}\n`);
    return 0;
  }
  process.stdout.write(`${render(version, commits)}\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { areaOf, group, render, commitsSince, lastTag, AREAS };
