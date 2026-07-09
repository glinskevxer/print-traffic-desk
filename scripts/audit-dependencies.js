'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * `npm audit` is all or nothing: it fails the build on an advisory whether or
 * not the desk is exposed to it, and the only way to get past one is to stop
 * running it. So the accepted ones are written down, with a reason and a date
 * they stop being accepted, and everything else fails.
 *
 * An acceptance that has expired fails too. That is the point: it comes back
 * and somebody has to look again rather than an ignore list growing forever.
 */

const ACCEPTED_FILE = path.join(__dirname, '..', 'audit-accepted.json');
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

function readAccepted() {
  if (!fs.existsSync(ACCEPTED_FILE)) return [];
  const parsed = JSON.parse(fs.readFileSync(ACCEPTED_FILE, 'utf8'));
  return parsed.accepted || [];
}

function runAudit() {
  try {
    const output = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(output);
  } catch (err) {
    // npm exits non zero when it finds anything, and still prints the report.
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

function findingsFrom(report) {
  return Object.entries(report.vulnerabilities || {}).flatMap(([name, vulnerability]) =>
    (vulnerability.via || [])
      .filter((via) => typeof via === 'object')
      .map((via) => ({
        id: String(via.source),
        package: name,
        title: via.title,
        severity: via.severity || vulnerability.severity,
        url: via.url,
      })),
  );
}

function atLeast(severity, floor) {
  return SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf(floor);
}

function classify(findings, accepted, today) {
  const byId = new Map(accepted.map((entry) => [String(entry.id), entry]));
  const outcome = { failing: [], accepted: [], expired: [] };

  for (const finding of findings) {
    const acceptance = byId.get(finding.id);
    if (!acceptance) {
      outcome.failing.push(finding);
    } else if (acceptance.until < today) {
      outcome.expired.push({ ...finding, ...acceptance });
    } else {
      outcome.accepted.push({ ...finding, ...acceptance });
    }
  }
  return outcome;
}

function main() {
  const floor = process.env.AUDIT_FLOOR || 'high';
  const today = new Date().toISOString().slice(0, 10);

  const findings = findingsFrom(runAudit()).filter((finding) => atLeast(finding.severity, floor));
  const outcome = classify(findings, readAccepted(), today);

  for (const entry of outcome.accepted) {
    process.stdout.write(
      `accepted  ${entry.id}  ${entry.package}  until ${entry.until}  ${entry.why}\n`,
    );
  }
  for (const entry of outcome.expired) {
    process.stderr.write(
      `expired   ${entry.id}  ${entry.package}  accepted until ${entry.until}, look again\n`,
    );
  }
  for (const finding of outcome.failing) {
    process.stderr.write(
      `new       ${finding.id}  ${finding.package}  ${finding.severity}  ${finding.title}\n`,
    );
  }

  const bad = outcome.failing.length + outcome.expired.length;
  process.stdout.write(
    `\n${findings.length} advisories at ${floor} or above: ${outcome.accepted.length} accepted, ${bad} to deal with\n`,
  );
  return bad === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { findingsFrom, classify, atLeast, readAccepted, ACCEPTED_FILE, SEVERITIES };
