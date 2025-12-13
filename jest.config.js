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
