'use strict';

const fs = require('fs');
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
    const info = buildInfo();

    expect(info.source).toBe('checkout');
    expect(info.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(info.shortCommit).toBe(info.commit.slice(0, 7));
  });

  it('says unknown rather than making something up', () => {
    if (fs.existsSync(BUILD_FILE)) return;
    const info = buildInfo({ readHead: () => null });

    expect(info.source).toBe('unknown');
    expect(info.commit).toBeNull();
    expect(info.shortCommit).toBeNull();
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
