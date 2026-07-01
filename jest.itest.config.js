// OnStandard — integration-test config. Separate from jest.config.js so the backend
// round-trip (src/**/*.itest.ts) NEVER runs in the unit gate (`npm test`) — it needs a
// live LOCAL supabase stack and is skipped when AOS_SUPABASE_ANON_KEY is unset.
// Run: AOS_SUPABASE_URL=... AOS_SUPABASE_ANON_KEY=... npx jest --config jest.itest.config.js
const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: ['**/*.itest.ts'],
  // The real supabase-js client is used here (not stubbed); keep the polyfill stub
  // and @ alias from the base config.
};
