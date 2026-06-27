// Node-test stub for expo-image-picker (a native ESM module babel-jest won't transform).
// The capture module degrades to undefined on any picker outcome, so these no-ops are
// enough for the store tests; real behavior is device-only.
module.exports = {
  requestCameraPermissionsAsync: async () => ({ granted: false }),
  launchCameraAsync: async () => ({ canceled: true, assets: null }),
  launchImageLibraryAsync: async () => ({ canceled: true, assets: null }),
};
