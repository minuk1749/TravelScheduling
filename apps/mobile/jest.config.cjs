const reactDirectory = require('node:path').dirname(require.resolve('react/package.json'));

module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  watchman: false,
  // The server uses a different React patch; every native dependency must share Expo's copy.
  moduleNameMapper: { '^react$': require.resolve('react'), '^react/(.*)$': `${reactDirectory}/$1` },
};
