# AthleteOS — v1 Design Spec

**Date:** 2026-06-21
**Status:** Phase 1 implemented (Expo mobile app).

## What it is
A mobile-first athlete accountability platform recreated from the Claude Design
handoff (`design_handoff_athleteos`). Athletes log meals (simulated AI analysis),
complete daily tasks + weekly check-ins, and earn a daily **Athlete Score**, while
coaches, parents, and trainers get visibility. The product answers one question:
*"Is this athlete actually doing what they're supposed to be doing?"*

## Decisions (from brainstorming, 2026-06-21)
1. **Target:** a real running mobile app — Expo + React Native + TypeScript (matches
   the founder's CoachOS setup; this IS a mobile app).
2. **Scope:** full bundle. Phase 1 = the entire Expo mobile app (all 4 roles +
   onboarding + overlays + scoring engine). The 3 desktop dashboards are **phase 2**.
3. **Data:** local-only — Zustand store persisted to AsyncStorage (`aos_day`). No
   backend/auth in v1.
4. **AI:** deterministic fakes, exactly as the prototype — ~2.3s simulated meal scan
   with results that vary by meal type, computed baseline recommendation, rule-based
   insights. No API keys, works offline. Real Claude is a later upgrade.

## Architecture
Single Expo app; the scoring engine lives in `src/core/` as **pure, framework-agnostic
TypeScript** (zero RN imports) so it lifts into a shared `packages/core` when the
desktop dashboards land — without the fragility of an Expo+Metro monorepo on Windows.

```
app/                 expo-router shell (_layout loads fonts; index renders <Root/>)
src/
  core/              types, constants, scoring, recommendation, leaderboard, content  (PURE TS)
  store/             Zustand store + AsyncStorage persistence; useDerived() selector
  ui/                tokens, primitives, Ring (SVG), Slider
  brand/             Logo system   icons/  inline SVG icon set
  app/Root.tsx       flow switch: onboarding | app | coach | parent | trainer
  screens/
    onboarding/      welcome → role → role-specific steps → success
    athlete/         AthleteApp (tabs + FAB) · Home · Plan · Squad · CheckIn · Nutrition · Profile
    overlays/        MealCapture · MealDetail · Account · Messages · Notifications · PersonDetail
    roles/           CoachView · ParentView · TrainerView
```

## The scoring engine (ported verbatim)
`computeDerived(state)` is one selector feeding every surface:
```
nutrition = min(100, round(57 + min(protein,180)/180*30 + mealsLogged/4*15))
recovery  = ciSubmitted ? min(100, round((energy+recovery+sleep)/30*100)) : 86
weight=95, checkin=100   (constants in the prototype)
score     = clamp(round(.4*nutrition + .2*recovery + .2*weight + .1*tasks + .1*checkin), 0, 100)
grade: A≥90 B≥80 C≥70 D≥60 else F
```
Logging a meal, toggling a task, adding water, or submitting a check-in recomputes the
score and it propagates to Home hero, Nutrition, Squad row, and the role views.

## Navigation & overlays
expo-router provides the shell; in-app flow is store-driven (matching the prototype's
single-component design). Athlete = bottom tab bar (Home · Plan · [Camera FAB] · Squad ·
Check-In). Full-screen overlays (meal, detail, account, messages, notifications,
person-detail) are store-boolean-mounted on top. Each role view exits via ☰ → Account →
Sign out → onboarding.

## Testing
`src/core` is pure TS → real Jest unit tests assert the scoring math against the
prototype's default state and key transitions (11 tests). Screens verified by a full
iOS Metro bundle (1181 modules, clean) + typecheck.

## Phase 2 (deferred)
Desktop dashboards (Next.js reusing extracted `core`), Supabase auth + DB, real Claude
meal analysis, push notifications.
