// Extends Expo's default Metro config to bundle the proto as a .zip asset, which the app
// extracts on launch and loads in the WebView (see src/proto/protoBundle.ts).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes('zip')) {
  config.resolver.assetExts.push('zip');
}

module.exports = config;
