'use strict';

const fs = require('fs');
const path = require('path');
const { buildInfo, fromGit, BUILD_FILE } = require('../../../src/lib/build');
const { version } = require('../../../package.json');

describe('which build is this', () => {
  it('says the version out of the manifest and the node it runs on', () => {
    const info = buildInfo();

    expect(info.service).toBe('printdesk');
    expect(info.version).toBe(version);
    expect(info.node).toBe(process.version);
  });

  it('reads the commit out of the checkout when there is no build file', () => {
    if (fs.existsSync(BUILD_FILE)) return;
    // The head is injected rather than shelled out for: this runs from an
    // unpacked export as well as a checkout, and an export has no history.
    const info = buildInfo({ readHead: () => 'b'.repeat(40) });

    expect(info.source).toBe('checkout');
    expect(info.commit).toBe('b'.repeat(40));
    expect(info.shortCommit).toBe('bbbbbbb');
  });

  it('says unknown rather than making something up', () => {
    if (fs.existsSync(BUILD_FILE)) return;
    const info = buildInfo({ readHead: () => null });

    expect(info.source).toBe('unknown');
    expect(info.commit).toBeNull();
    expect(info.shortCommit).toBeNull();
  });

  it('finds the real commit when it is run from a checkout', () => {
    if (
      fs.existsSync(BUILD_FILE) ||
      !fs.existsSync(path.join(__dirname, '..', '..', '..', '.git'))
    ) {
      return;
    }
    const info = buildInfo();

    expect(info.source).toBe('checkout');
    expect(info.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reads a commit handed to it', () => {
    expect(fromGit(() => 'a'.repeat(40))).toEqual({
      commit: 'a'.repeat(40),
      builtAt: null,
      source: 'checkout',
    });
    expect(fromGit(() => null)).toBeNull();
  });

  it('takes the environment it was started in', () => {
    expect(buildInfo({ env: { NODE_ENV: 'production' } }).environment).toBe('production');
    expect(buildInfo({ env: {} }).environment).toBe('development');
  });
});
