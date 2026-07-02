// Node-test stub for expo-image-manipulator (native ESM, not transformed by babel-jest).
// Capture degrades to the raw base64 / undefined on any failure, so a simple resolved value
// is enough for the store tests; real resizing is device-only.
module.exports = {
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  manipulateAsync: async () => ({ base64: 'MANIP_B64', uri: 'file://out.jpg', width: 1568, height: 1176 }),
};
