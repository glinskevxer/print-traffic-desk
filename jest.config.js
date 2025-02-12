'use strict';

const shared = {
  testEnvironment: 'node',
  clearMocks: true,
  restoreMocks: true,
};

module.exports = {
  testTimeout: 30000,
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
