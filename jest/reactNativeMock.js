// Node-test stub for react-native. The only react-native import in the node-tested
// graph is the capture module's `Platform` (there are no React-tree mount tests). A
// minimal Platform is all that is needed; default to 'ios' so isCameraAvailable is true.
module.exports = {
  Platform: { OS: 'ios', select: (o) => (o && (o.ios ?? o.default)) },
};
