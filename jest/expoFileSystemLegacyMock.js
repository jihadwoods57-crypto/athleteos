// Node-test stub for expo-file-system/legacy (a native ESM module babel-jest won't transform —
// see src/proto/bridge.ts for why the bridge imports the /legacy subpath). SHARE_IMAGE degrades
// to a no-op write in tests; real file writes are device-only. Mirrors the existing
// jest/expo*Mock.js pattern for other native-only expo modules.
module.exports = {
  cacheDirectory: 'file:///mock-cache/',
  writeAsStringAsync: async () => undefined,
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
};
