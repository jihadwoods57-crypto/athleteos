# Feedback intake + the star prompt — go-live

Built 2026-07-29 on `feat/premium-polish`. Two features, both **authored and verified but not yet
live**: one migration to apply, one edge function to deploy, one OTA to push.

---

## What shipped

### 1. Send feedback (the front door)

`Settings → Send feedback` opens a picker — **Something's broken / I have an idea / A question /
Billing or my plan**, with **A safety concern** set apart in red under an "Urgent" heading — then a
one-line + detail compose step.

It writes nothing of its own. Everything goes through `create_support_ticket`, which has existed
since **0125** and already owns validation (subject 3–200, body ≤4000), the rate limit
(**5 tickets/hour/user**), and the rule that `safety` becomes **`priority = 'urgent'`** server-side.
Tickets land in the founder queue you already have: **Command Center → Support**, safety first, with
minors' contact details masked.

The old `mailto:` link is still there as **"Email us instead"**. That is deliberate: somebody locked
out of their account cannot file an in-app ticket, and that is exactly when they need to reach a
human.

**Bug reports carry their own context.** Appended automatically to the body: role, app version, proto
version, the screen they were on, sync state, online/offline. Counts and enums only — no device
identifiers. There is also a **"Tell us what happened"** button on the failed-analysis screen, the one
place where somebody knows exactly what broke and is still looking at it.

### 2. The star prompt

Native only — `expo-store-review` (`SKStoreReviewController` on iOS, Play In-App Review on Android),
requested over the WebView bridge on the same gated pattern as IAP and HealthKit.

It fires **only** after a **7 / 30 / 100-day "Day N locked" stamp**, once the athlete has dismissed
it themselves, and only when **all** of these hold:

- today is **on standard** (≥ 80)
- **nothing failed** — no failed meal read, no sync problem, online
- **no ask in the last 120 days** on this device
- the `store_review_enabled` flag is on

There is deliberately **no "Enjoying the app?" pre-prompt**. Google Play forbids asking any question
before or alongside the review card, and Android now builds. The app infers from a day it already
scored instead of interrogating anyone.

---

## To make it live

### Step 1 — apply migration 0162 (required for the `idea` category)

```bash
supabase db push --linked          # or apply 0162_feedback_intake.sql however you prefer
```

Verified locally against real Postgres before shipping: applies clean, `idea` is accepted, `safety`
still routes to `urgent`, `idea` stays `normal`, the invalid-category and short-subject guards still
raise, and the flag seeds enabled. The RLS suite is **479/479** with it applied.

**Until it is applied, nothing breaks.** The app tries `idea`, the server answers `invalid category`,
and the app silently refiles it as a `question` with the subject prefixed `[Idea]`. Somebody who took
the time to send an idea gets a thank-you either way — the ideas just sit in the question queue,
clearly labelled, until 0162 lands.

### Step 2 — deploy the analytics function (required for the new events)

```bash
supabase functions deploy analytics-ingest
```

The server keeps a **fixed whitelist of event names and silently discards anything else** — this is
what swallowed the whole `vc_*` funnel once before. Four names were added:
`feedback_opened`, `feedback_sent`, `review_prompt_decided`, `review_prompt_shown`.
Skip this and the features work fine; you just get no telemetry.

### Step 3 — OTA the app

```bash
npm run preflight && npm run ship   # or your usual eas update path
```

Everything on the app side is proto JavaScript **except** the review prompt, which needs the new
native module. So:

| Piece | Ships via |
| --- | --- |
| Send feedback, all of it | **OTA** — works immediately |
| The star prompt | **next binary** — `expo-store-review` is native |

---

## Things worth knowing before you test

**The star prompt cannot appear in TestFlight.** iOS reports the review prompt as *unavailable* on
TestFlight builds, so `isAvailableAsync()` returns false and the app correctly does nothing. This is
the platform, not a bug — do not spend an evening chasing it. It only appears in App Store builds.

**You cannot measure whether anyone rated.** No platform reports it, and iOS silently discards the
prompt after three asks per user per year. That is why `review_prompt_decided` carries a **decline
reason** — it is the only way "why is nobody being asked?" is ever answerable. The real signal is
your store rating count over time.

**To stop asking, one column:**

```sql
update feature_flags set kill_switch = true where name = 'store_review_enabled';
```

`kill_switch` is evaluated **first**, ahead of `default_on` and every allowlist. (Worth stating
plainly because it reads like a label and is not: seeding it `true` would have shipped a prompt that
was silently, permanently off while looking enabled.)

---

## Deliberately not built

- **No public idea board with votes.** At Founding-50 volume, twenty ideas read by you beats a
  leaderboard showing three votes. There is also a privacy collision to design around first:
  Settings promises athletes "there is no team feed and no leaderboard", and an attributed list of
  what your teammates want is a feed. When it is built it needs its own visibility decision.
- **No third-party tool** (Canny/Featurebase). It would be live this week, but it is a new data
  subprocessor — a DPA and a privacy-policy update, not just a signup — and it takes users out of
  the app.
- **No custom star UI.** A five-star sheet that deep-links to the store is a rejection risk, and both
  stores provide the real thing.
