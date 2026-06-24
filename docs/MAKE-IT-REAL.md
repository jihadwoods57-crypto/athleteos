# AthleteOS — Make It Real (activation runbook)

Everything below is **built and flag-gated**: with no keys, the app runs on the deterministic
prototype exactly as today. Add the keys to flip each piece on. Nothing here changes the app's
behavior until you activate it.

## What's wired (behind flags)
| Capability | App-side (done) | Backend / native (you provide) | Flag |
|---|---|---|---|
| **Real AI meal coach** (#1) | `src/lib/ai` (`analyzeMeal`, deterministic fallback) + `capture()` calls it | `supabase/functions/analyze-meal` (Claude vision) + `ANTHROPIC_API_KEY` secret | `isAiConfigured` |
| **Multiplayer / persistence** (#2) | `src/lib/supabase` (client, auth, queries, RPCs) + `src/store/sync.ts` mappers | Supabase project + run `supabase/migrations` + `.env` keys | `isSupabaseConfigured` |
| **Server-side score** (#5) | `src/core` is the formula | recompute in a function/trigger from raw inputs (see migration note) | (backend) |
| **Real camera** (#3) | `src/lib/capture` seam + `capture()` ready for a photo | `expo install expo-camera` + implement | `isCameraAvailable` |
| **Notifications / nudges** (#4) | `src/lib/notify` seam + `notif` toggle | `expo install expo-notifications` + backend push | `isNotifyAvailable` |

## Activation order (recommended)

### 1. Backend + real AI (the spine — unlocks #1, #2, #5)
1. Create a Supabase project (supabase.com).
2. Run the migrations: `supabase link --project-ref <ref>` then `supabase db push` (or paste
   `supabase/migrations/0001..0003` into the SQL editor).
3. Set the AI secret + deploy the function:
   ```
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy analyze-meal
   ```
   (optional) `supabase secrets set ANTHROPIC_MODEL=claude-opus-4-8` to use the top tier
   instead of the default `claude-sonnet-4-6`.
4. In the app: copy `.env.example` to `.env`, fill `EXPO_PUBLIC_SUPABASE_URL` +
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Restart Metro. Now `isSupabaseConfigured` and
   `isAiConfigured` are true: meal capture calls Claude vision; the analyze flow is real.
5. **Ground the macros** (accuracy): wire `groundMacros()` in the Edge Function to a food
   database keyed off the detected foods, so the protein/calorie numbers feeding the score are
   trustworthy rather than model estimates. Keep `src/core` as the canonical score formula.

### 2. Turn on multiplayer (auth + sync)
- Point the onboarding sign-in / create-account screens at `auth.signIn` / `auth.signUp`.
- Flip the two `TODO (go-live)` hooks in `src/store/sync.ts`: hydrate the signed-in athlete
  after auth; `pushDay()` (debounced) after each mutating action. Role views swap the seeded
  `ROSTER` / `TRAINER_CLIENTS` for `db.fetchLinkedDays` (RLS-filtered). Onboarding code-entry
  calls `join_team` / `join_practice`.

### 3. Real camera (#3)
`npx expo install expo-camera expo-image-manipulator`, implement `capturePhotoBase64()` in
`src/lib/capture` (downscale to ~1024px JPEG base64), set `isCameraAvailable`, and pass the
result into `analyzeMeal({ photoBase64 })` from `capture()`. Web has no camera (model infers).

### 4. Notifications + push nudges (#4)
`npx expo install expo-notifications`, implement `src/lib/notify`, gate on the `notif` toggle.
Real overseer->athlete push also needs the backend to store device tokens and send.

## Cost note (real AI)
Per-meal vision analysis on `claude-sonnet-4-6` (~$3/$15 per 1M tokens) is a few cents at most;
`claude-opus-4-8` is the higher tier. Both stream/return a small structured result. Keep the
deterministic fallback so a network/AI hiccup never blocks a log.

## Hard line (still out of scope)
Wearables, Apple Health/Garmin/Whoop, recruiting, NIL, social/community. Validate the core loop
(meal -> real AI coach -> score -> coach intervenes -> pays) with real users first.
