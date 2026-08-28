'use strict';

const { check, CHECKS, isCheckout } = require('../../../scripts/releasable');

describe('is this tree fit to deploy', () => {
  it('reports a check that passed with what it found', () => {
    const result = check('a check', () => 'found three things');

    expect(result).toEqual({ name: 'a check', ok: true, detail: 'found three things' });
  });

  it('says ok for a check that reports nothing in particular', () => {
    expect(check('a check', () => undefined).detail).toBe('ok');
  });

  it('turns a thrown check into a failure with its first line', () => {
    const result = check('a check', () => {
      throw new Error('two files are not committed\nsrc/one.js\nsrc/two.js');
    });

    expect(result).toEqual({
      name: 'a check',
      ok: false,
      detail: 'two files are not committed',
    });
  });

  it('does not let one failing check stop the others', () => {
    const results = [
      check('first', () => {
        throw new Error('no');
      }),
      check('second', () => 'yes'),
    ];

    expect(results.map((result) => result.ok)).toEqual([false, true]);
  });

  it('names every check it runs', () => {
    const names = CHECKS.map(([name]) => name);

    expect(names).toEqual(
      expect.arrayContaining([
        'the tree is committed',
        'the version is new',
        'the lock file matches',
        'no secrets committed',
        'no focused tests',
        'no skipped tests',
        'node version agrees',
      ]),
    );
  });

  it('gives every check a function to run', () => {
    for (const [name, fn] of CHECKS) {
      expect(typeof name).toBe('string');
      expect(typeof fn).toBe('function');
    }
  });

  it('agrees with the tree it is run against, whether or not it is a checkout', () => {
    const byName = new Map(CHECKS);

    // These two read files, so they answer the same from a checkout and from a
    // `git archive` export, which is what a container image holds.
    expect(byName.get('the lock file matches')()).toMatch(/dependencies locked/);
    expect(byName.get('node version agrees')()).toMatch(/node \d+\.\d+\.\d+ everywhere/);
  });

  it('answers the git checks when there is history to read', () => {
    if (!isCheckout()) return;
    const byName = new Map(CHECKS);

    expect(byName.get('no secrets committed')()).toMatch(/no environment file/);
    expect(byName.get('no focused tests')()).toBe('nothing is focused');
    expect(byName.get('no skipped tests')()).toBe('nothing is skipped');
  });

  it('says what it cannot answer rather than passing on a git error', () => {
    if (isCheckout()) return;
    const results = new Map(CHECKS.map(([name, fn]) => [name, check(name, fn)]));

    expect(results.get('the tree is committed').detail).toMatch(/not one/);
    expect(results.get('no secrets committed').detail).toMatch(/needs a git checkout/);
    expect(results.get('no focused tests').detail).toMatch(/needs a git checkout/);
    // The version check still says what it can, because the version is in a file.
    expect(results.get('the version is new').ok).toBe(true);
  });

  it('knows whether it is looking at a checkout or an unpacked export', () => {
    expect(typeof isCheckout()).toBe('boolean');
  });
});
