// Pure-TS core tests run under babel-jest (babel-preset-expo handles TS).
// No jest-expo/RN preset needed since src/core has zero React Native imports.
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': 'babel-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
