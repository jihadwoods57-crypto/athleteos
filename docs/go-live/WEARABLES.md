# Go-live: wearables (Apple Health / Health Connect)

The **client + bridge are built** — the `OnStandardNative.health.*` bridge, the `src/lib/health`
seam, the real `#devices` connect/readings screen, and the recovery-screen connect affordance.
Everything self-gates: until the native module is wired, the connect affordance stays hidden and
`#devices` redirects safely, so there's no reachable "coming soon". What remains is native + device
work no dev machine can do.

## Design decision (important)
Device data (last-night **sleep / HRV / resting HR**) is shown as **context** on the recovery
check-in and `#devices`. It **does NOT change the 25% recovery score** — the athlete's self-report
stays authoritative. Folding device data into the score is a **founder-gated** decision: the path
exists (`blendRecovery` in `src/core/recovery.ts`), but enabling it silently would change a quarter
of the daily score, so it's intentionally left off. Turn it on deliberately, not as a side effect.

## 1. Native module + config plugin
- iOS: add **react-native-health** (HealthKit) + a config plugin (or a local `withHealthKit`
  alongside `plugins/withDeferredAppleSignIn.js`); add `NSHealthShareUsageDescription` and the
  HealthKit capability/entitlement. iOS uses static frameworks already (`app.json`).
- Android: add **Health Connect** support + the `android.permissions` (sleep, HRV, resting HR) and
  the Health Connect privacy-policy declaration required by Play.
- `npx expo install` the module so it resolves the SDK-57-compatible version.

## 2. Wire the seam (one file)
In `src/lib/health/index.ts` implement `healthConnected` / `connectHealth` / `readRecoverySample`
against the module (each has the exact intent in comments), and set `export const isHealthAvailable
= true`. **Nothing else changes** — the bridge, `#devices`, and the recovery affordance already call
these. `readRecoverySample` returns `{ sleepHours?, hrvMs?, restingHr? }`.

## 3. Build & verify
- EAS build (HealthKit does **not** work in the iOS Simulator — needs a physical device).
- On device: open Recovery → the "Connect Apple Health" row appears → tap → grant read permission →
  `#devices` shows last night's sleep / HRV / resting HR. Confirm the recovery score is unchanged.

## 4. (Optional, later) score blend + coach visibility
- To blend device data into the score, call `blendRecovery(selfReport, sample)` at the recovery
  fold point in `proto/redesign-2026-07/js/day.js` `recoveryParts` (this is a scoring change —
  decide the weight; `RECOVERY_SAMPLE_WEIGHT` in core is the default).
- To give coaches the readiness trend, add a `recovery_samples` table (athlete_id, date,
  sleep_hours, hrv_ms, resting_hr) written from the `#devices` read path and surfaced on the coach
  athlete profile. Deliberately not built yet — no reader exists, and the display-only feature
  delivers value without it.

## How the pieces connect (already built)
```
Recovery / #devices  →  OnStandardNative.health.{available,connect,read}()   [proto]
  → HEALTH_* bridge msgs → src/lib/health → react-native-health / Health Connect
    → { sleepHours, hrvMs, restingHr }  → shown as context (NOT scored in v1)
```
