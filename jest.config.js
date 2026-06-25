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
    // react-native-url-polyfill/auto is an RN-only side-effect ESM import (it installs
    // a URL global) pulled in by the supabase client; node already has URL, so stub it.
    '^react-native-url-polyfill/auto$': '<rootDir>/jest/rnUrlPolyfillMock.js',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
