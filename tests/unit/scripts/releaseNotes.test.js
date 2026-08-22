'use strict';

const { areaOf, group, render, AREAS } = require('../../../scripts/release-notes');

const commit = (subject, files) => ({ hash: 'abcdef1234567890', subject, files });

describe('what changed since the last release', () => {
  it('puts a commit in the area of the files it touched', () => {
    expect(areaOf(['src/domain/rights/clearance.js'])).toBe('rights and clearance');
    expect(areaOf(['src/services/bookingService.js'])).toBe('bookings');
    expect(areaOf(['src/domain/traffic/routing.js'])).toBe('print traffic');
    expect(areaOf(['src/domain/condition/grade.js'])).toBe('the shelf');
    expect(areaOf(['src/ai/extractLicenceTerms.js'])).toBe('reading documents');
    expect(areaOf(['src/cli/commands/seed.js'])).toBe('the command line');
    expect(areaOf(['src/workers/outboxWorker.js'])).toBe('the worker');
  });

  it('falls back through the areas in the order they are declared', () => {
    expect(areaOf(['src/lib/money.js'])).toBe('plumbing');
    expect(areaOf(['tests/unit/lib/money.test.js'])).toBe('tests');
    expect(areaOf(['Dockerfile'])).toBe('build and deployment');
    expect(areaOf(['README.md'])).toBe('everything else');
  });

  it('takes the first area any of the files matches', () => {
    expect(areaOf(['tests/unit/x.test.js', 'src/domain/rights/rules.js'])).toBe(
      'rights and clearance',
    );
  });

  it('groups the commits by area', () => {
    const grouped = group([
      commit('one', ['src/domain/rights/rules.js']),
      commit('two', ['src/services/bookingService.js']),
      commit('three', ['src/domain/rights/clearance.js']),
    ]);

    expect(grouped.get('rights and clearance')).toHaveLength(2);
    expect(grouped.get('bookings')).toHaveLength(1);
  });

  it('writes the notes with a heading per area and a short hash per line', () => {
    const notes = render('1.0.0', [
      commit('let one house exclusive stop another', ['src/domain/rights/exclusivity.js']),
      commit('plan a leg backwards from the screening', ['src/domain/traffic/routing.js']),
    ]);

    expect(notes).toContain('## 1.0.0');
    expect(notes).toContain('### rights and clearance');
    expect(notes).toContain('- let one house exclusive stop another (abcdef1)');
    expect(notes).toContain('### print traffic');
    expect(notes).toContain('2 commits.');
  });

  it('leaves out an area nothing touched', () => {
    const notes = render('1.0.0', [commit('one', ['src/cli/index.js'])]);

    expect(notes).toContain('### the command line');
    expect(notes).not.toContain('### money');
  });

  it('writes the areas in the order they are declared, not alphabetically', () => {
    const notes = render('1.0.0', [
      commit('a test', ['tests/unit/x.test.js']),
      commit('a rule', ['src/domain/rights/rules.js']),
    ]);

    expect(notes.indexOf('### rights and clearance')).toBeLessThan(notes.indexOf('### tests'));
  });

  it('names every area it can put a commit in', () => {
    for (const area of AREAS) {
      expect(area.name.length).toBeGreaterThan(3);
      expect(area.matches).toBeInstanceOf(RegExp);
    }
  });
});
