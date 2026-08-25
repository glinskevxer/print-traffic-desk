'use strict';

const shared = {
  testEnvironment: 'node',
  clearMocks: true,
  restoreMocks: true,
};

module.exports = {
  // One mongod serves the whole integration run, so the limit on the suite is
  // that server rather than this machine's cores. Past three workers the
  // suites queue behind each other and the slowest ones time out in a hook,
  // which reads as a broken test and is not one.
  testTimeout: 60000,
  maxWorkers: 3,
  collectCoverageFrom: ['src/**/*.js'],
  coverageDirectory: 'coverage',
  // Floors, not targets. They sit a little under where the suite is now, so a
  // change that drops coverage noticeably fails and one that drops it by a
  // line does not turn into a chore for whoever is holding the pull request.
  //
  // A path threshold takes those files out of the global group, so the global
  // numbers below cover what is left: the http layer, the models, the command
  // line and the plumbing around them, which is lower than the whole tree
  // reads because the rules are held to a much higher floor of their own.
  coverageThreshold: {
    global: { statements: 89, branches: 78, functions: 85, lines: 90 },
    // The rules are the part worth insisting on: they have no database, no
    // clock and no excuse for an untested path.
    './src/domain/': { statements: 96, branches: 88, functions: 96, lines: 96 },
    './src/lib/': { statements: 95, branches: 88, functions: 95, lines: 96 },
    './src/services/': { statements: 94, branches: 80, functions: 96, lines: 95 },
  },
  projects: [
    {
      ...shared,
      displayName: 'unit',
      roots: ['<rootDir>/tests/unit'],
      testMatch: ['**/*.test.js'],
    },
    {
      ...shared,
      displayName: 'integration',
      roots: ['<rootDir>/tests/integration'],
      testMatch: ['**/*.test.js'],
      globalSetup: '<rootDir>/tests/helpers/globalSetup.js',
      globalTeardown: '<rootDir>/tests/helpers/globalTeardown.js',
    },
  ],
};
