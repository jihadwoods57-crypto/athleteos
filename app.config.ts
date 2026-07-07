// OnStandard — dynamic Expo config.
//
// All STATIC config still lives in app.json (single source of truth; the App
// Store compliance test reads app.json directly). This file's ONLY job is to
// stamp every build with the exact git commit + build time, so the running app
// can prove which code it was built from. That stamp is what ends "is my phone
// on the newest version?" guessing for good.
//
// On EAS Build the commit comes from EAS_BUILD_GIT_COMMIT_HASH — an env var EAS
// sets automatically to the exact commit it checked out (ground truth). Locally
// it falls back to `git rev-parse`. This must NEVER throw: a bad stamp cannot be
// allowed to break a build.
import { execSync } from 'node:child_process';
import appJson from './app.json';

function shortCommit(): string {
  const fromEas = process.env.EAS_BUILD_GIT_COMMIT_HASH;
  if (fromEas) return fromEas.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
}

const expo = appJson.expo as Record<string, unknown>;

export default {
  ...expo,
  extra: {
    ...(expo.extra as Record<string, unknown>),
    buildInfo: {
      commit: shortCommit(),
      builtAt: new Date().toISOString(),
    },
  },
};
