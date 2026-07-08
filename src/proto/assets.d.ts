// Metro bundles .zip as an asset (see metro.config.js); this lets TypeScript resolve the
// `require('../../assets/proto.zip')` used to hand the bundled proto to expo-asset.
declare module '*.zip' {
  const asset: number;
  export default asset;
}
