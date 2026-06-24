// Pure-TS core tests run under babel-jest (babel-preset-expo handles TS).
// No jest-expo/RN preset needed since src/core has zero React Native imports.
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // babel-preset-expo rewrites EXPO_PUBLIC_* reads to import expo/virtual/env (an ESM
    // module in node_modules that babel-jest won't transform). Stub it to real process.env.
    '^expo/virtual/env$': '<rootDir>/jest/expoEnvMock.js',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
