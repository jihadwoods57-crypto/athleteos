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
    // The meal-capture module imports react-native (Platform) + expo-image-picker; both
    // are native ESM modules babel-jest won't transform. Stub them for node tests — the
    // camera is device-only and degrades to undefined here.
    '^react-native$': '<rootDir>/jest/reactNativeMock.js',
    '^expo-image-picker$': '<rootDir>/jest/expoImagePickerMock.js',
    '^expo-image-manipulator$': '<rootDir>/jest/expoImageManipulatorMock.js',
    '^expo-notifications$': '<rootDir>/jest/expoNotificationsMock.js',
    // The Supabase client's auth storage adapter imports expo-secure-store (native-only);
    // stub it with a stateful in-memory store so the graph loads and the adapter round-trips.
    '^expo-secure-store$': '<rootDir>/jest/expoSecureStoreMock.js',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
