'use strict';

const {
  findingsFrom,
  classify,
  atLeast,
  SEVERITIES,
} = require('../../../scripts/audit-dependencies');

const REPORT = {
  vulnerabilities: {
    'some-package': {
      severity: 'high',
      via: [
        {
          source: 1101234,
          title: 'Prototype pollution in some-package',
          severity: 'high',
          url: 'https://github.com/advisories/GHSA-xxxx',
        },
        'another-package',
      ],
    },
    'another-package': {
      severity: 'moderate',
      via: [
        { source: 1109999, title: 'Regular expression denial of service', severity: 'moderate' },
      ],
    },
  },
};

describe('what an advisory report means for the desk', () => {
  it('flattens the report into one finding per advisory', () => {
    const findings = findingsFrom(REPORT);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ id: '1101234', package: 'some-package', severity: 'high' });
  });

  it('ignores the entries that only name another package', () => {
    expect(findingsFrom(REPORT).every((finding) => finding.title)).toBe(true);
  });

  it('reads an empty report as nothing to do', () => {
    expect(findingsFrom({})).toEqual([]);
    expect(findingsFrom({ vulnerabilities: {} })).toEqual([]);
  });

  it('orders the severities the way npm does', () => {
    expect(SEVERITIES).toEqual(['info', 'low', 'moderate', 'high', 'critical']);
    expect(atLeast('critical', 'high')).toBe(true);
    expect(atLeast('high', 'high')).toBe(true);
    expect(atLeast('moderate', 'high')).toBe(false);
  });

  it('fails on an advisory nobody has looked at', () => {
    const outcome = classify(findingsFrom(REPORT), [], '2026-01-01');

    expect(outcome.failing).toHaveLength(2);
    expect(outcome.accepted).toEqual([]);
  });

  it('lets through one that was looked at and written down', () => {
    const accepted = [
      { id: '1101234', until: '2026-12-31', why: 'the desk never passes user input to that call' },
    ];

    const outcome = classify(findingsFrom(REPORT), accepted, '2026-01-01');

    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.accepted[0].why).toMatch(/never passes user input/);
    expect(outcome.failing).toHaveLength(1);
  });

  it('brings an acceptance back once it has run out', () => {
    const accepted = [{ id: '1101234', until: '2025-06-30', why: 'waiting on an upstream fix' }];

    const outcome = classify(findingsFrom(REPORT), accepted, '2026-01-01');

    expect(outcome.expired).toHaveLength(1);
    expect(outcome.accepted).toEqual([]);
  });

  it('takes the acceptance on the day it runs out', () => {
    const accepted = [{ id: '1101234', until: '2026-01-01', why: 'still waiting' }];

    expect(classify(findingsFrom(REPORT), accepted, '2026-01-01').accepted).toHaveLength(1);
  });

  it('reads the accepted file the desk actually ships', () => {
    const written = require('../../../audit-accepted.json');

    expect(Array.isArray(written.accepted)).toBe(true);
    for (const entry of written.accepted) {
      expect(entry.id).toEqual(expect.any(String));
      expect(entry.why.length).toBeGreaterThan(20);
      expect(entry.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
