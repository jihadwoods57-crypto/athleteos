# AthleteOS

The accountability platform for serious athletes. Athletes log meals, complete daily
tasks and weekly check-ins, and earn a daily **Athlete Score**; coaches, parents, and
trainers get real-time visibility.

A real Expo + React Native + TypeScript app, recreated faithfully from the Claude Design
handoff. See [`docs/superpowers/specs/2026-06-21-athleteos-design.md`](docs/superpowers/specs/2026-06-21-athleteos-design.md).

## Run it

```bash
npm install --legacy-peer-deps
npx expo start          # then press i / a, or scan the QR with Expo Go
```

## Develop

```bash
npm run typecheck       # tsc --noEmit
npm test                # Jest — scoring engine unit tests
npx expo export -p ios  # full Metro bundle (catches resolution/import errors)
```

## Layout

```
app/        expo-router shell
src/core/   pure-TS scoring engine + domain data (no RN imports; lifts to packages/core later)
src/store/  Zustand store + AsyncStorage persistence (key: aos_day)
src/ui/     design tokens, primitives, animated SVG Ring, Slider
src/brand/  Logo system          src/icons/  inline SVG icons
src/screens/  onboarding · athlete · overlays · roles
```

## Status

**Phase 1 (done):** full mobile app — all 4 roles, onboarding, the reactive scoring
engine, and every overlay. Local-only data; meal "AI" is the deterministic simulation
from the prototype.

**Phase 2 (planned):** desktop dashboards (Coach/Parent/Trainer, reusing the core
package), Supabase auth + DB, real Claude meal analysis, push notifications.
