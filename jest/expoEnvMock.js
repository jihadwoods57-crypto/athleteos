// Jest stub for expo/virtual/env (an ESM module in node_modules that babel-jest does not
// transform). babel-preset-expo rewrites `process.env.EXPO_PUBLIC_*` reads to import this
// module; under jest we map it here so those reads resolve to the real process.env (no
// EXPO_PUBLIC vars in the test env -> isAiConfigured / isSupabaseConfigured are false).
module.exports = { env: process.env };
