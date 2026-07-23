# Lock-screen roll call — one-tap "I'm Up" from the notification

- **Date:** 2026-07-23
- **Branch:** feat/founder-command-center
- **Status:** design approved, spec for review
- **Builds on:** Verified Commitments (migrations 0138–0141, `docs/go-live/VERIFIED-COMMITMENTS.md`), `commitment-reminders` edge fn, the RN shell's notification layer.

## Problem

The morning roll call ("I'm Up") is meant to catch an athlete or client **oversleeping**. Today the
reminder is a push notification; tapping it opens the app, and the athlete then finds the card and
presses the button. That is two extra steps at 5 AM, exactly when friction loses you the check-in.

## Goal

An athlete answers a roll call **from the lock screen, without opening the app** — one press on the
notification, recorded server-side, confirmed in place. The confirmation pushes them to get **up and
moving**, never "back to sleep."

## Decisions (locked in brainstorming)

1. **One button: "I'm Up."** No decline/snooze. Not answering is itself the signal (the coach sees
   non-responders). A "can't make it" still happens in-app or via the coach.
2. **Any acknowledge-type commitment**, not only the 5 AM roll call — same code path
   (`ack_commitment`), driven by the commitment's own `action_label` ("I'm Up", "Here", "Done").
   The athlete only ever sees the coach's own wording.
3. **Recording mechanism: a signed one-time code carried in the reminder** (below), verified by a new
   public endpoint. Server is the source of truth; the phone never needs a live login at 5 AM.
4. **Confirmation reinforces being up**, never rest.
5. **Non-response escalates on a ladder** (folded in from the upgrade pass) — not just a repeated
   polite nudge. See "Escalation ladder" below.
6. **Apple Watch is a first-class surface** (folded in) — "I'm Up" answerable from the wrist, mostly
   via notification mirroring. See "Apple Watch" below.
7. **Coach "who's up" digest** (folded in) — one summary push to the coach when the roll call closes:
   counts plus who didn't answer. This *is* the ladder's coach rung (L3), not a second ping.

## Non-goals

- No persistent lock-screen **widget** in this phase (that is phase 2 — it reuses this endpoint).
- No new scheduling UI, no change to the daily 0–100 score or the separate Accountability score.
- No decline/snooze/excuse flow from the lock screen.
- No tap-and-sleep "proof of awake" step in this phase (considered, parked — arrival already carries
  the real credit).
- No **standalone** (phone-out-of-range) watchOS app in this phase — the Watch tap relays through the
  paired iPhone. A native watch app is a later enhancement.

## Architecture

```
 commitment-reminders (5-min cron)                  "I'm Up" tapped (lock screen)
        │  mints a signed code per due instance             │  posts { code }
        │  push: categoryId + action_label + code            │
        ▼                                                    ▼
 [ lock-screen notification with an "I'm Up" action ] ─▶ [ roll-call-ack edge fn (public) ]
                                                              │ verify code (HMAC + window)
                                                              │ ack_commitment_by_token(inst, athlete)
                                                              ▼
                                              commitment_responses updated → coach board + record
```

Five pieces:

1. **Code maker** — extend `commitment-reminders` to mint a signed code for each due instance and put
   it (plus `action_label` and a `categoryId`) on the push.
2. **The notification** — the RN shell registers a notification **category** whose single action
   ("I'm Up", labelled from `action_label`) does **not** open the app.
3. **`roll-call-ack`** — a new public edge fn: verify the code, record the ack, refuse expired/forged
   codes. Idempotent.
4. **Optimistic confirm + retry** — the tap handler flips the notification to "Logged, you're up"
   immediately and posts the code; on failure it queues the code and retries.
5. **Escalation ladder** — a deadline-crossing pass turns silence into progressively louder action
   (critical alert → coach → optional guardian). Detailed below. Still built on
   `claim_due_commitment_reminders` only selecting `pending` rows, so anyone who answered drops off
   every rung immediately.

## The signed code

**Payload signed:** `instance_id`, `athlete_id`, `respond_by_at` (the deadline), `iat`.
**Signature:** HMAC-SHA256 over the payload with a new secret `ROLLCALL_ACK_SECRET`
(`supabase secrets set`), using Deno's built-in `crypto.subtle` — no library. Encoding: base64url
`<payload>.<sig>`, mirroring a JWT shape without pulling a JWT dependency.

**Verification (`roll-call-ack`):**
- Recompute the HMAC with `ROLLCALL_ACK_SECRET`; constant-time compare (reuse the `safeEqual` shape
  already in `commitment-reminders`). Mismatch → 401.
- Reject if `now > respond_by_at + grace` (grace = the same 10 min the reminder cron uses) → 410 Gone.
- Otherwise call `ack_commitment_by_token(instance_id, athlete_id)` with the service role.

**Idempotent, not strictly single-use.** Acking twice is harmless (`acknowledged_at` is
`coalesce`d — see `ack_commitment`), so a retried tap just returns the same recorded time. This is
simpler and safer than a one-shot token that a flaky network could burn before the ack lands.

**Why a code and not the athlete's login:** the reminder already proves who it is for. Baking the
proof into the push means the tap is one stateless call the server fully validates, with no session
to refresh in a tiny background window — and it is exactly what the phase-2 widget needs, since a
widget also cannot safely hold a login.

## Server changes

1. **Migration (next free number — 0138–0141 taken; a second agent may commit on the shared tree, so pick the number at write time and `git add` explicit paths, never `-A`):**
   - `ack_commitment_by_token(p_instance uuid, p_athlete uuid) returns timestamptz`,
     `security definer`, body identical to `ack_commitment` but keyed by `p_athlete` instead of
     `auth.uid()`. **Revoke from `anon` and `authenticated`** — only the service role (edge fn) calls
     it. Add an authz probe that asserts a normal client cannot call it directly (new direct-callable
     functions need explicit `grant`/`revoke`; the default-deny from migration 0013 means the RLS
     tests alone miss it).
   - Extend `claim_due_commitment_reminders` to also return `action_label` and `respond_by_at` so the
     reminder fn can label the button and sign the deadline. (It already returns
     `athlete_id, instance_id, title, body, offset_min`.)
   - Add the `escalation` config to `commitments` and a claim function for deadline-crossed,
     still-`pending` rows to drive the ladder (L2–L4). The L3 coach digest reuses the existing
     `commitment_board` payload for counts and names — no new read model. See "Escalation ladder".
2. **`commitment-reminders/index.ts`:** for each due row, mint the code and add to the push message:
   `categoryId` (derived from `action_label`, see client note), `data.code`, `data.instance_id`
   (already present via `route`), `data.action_label`. Feature-flag and cron-key behaviour unchanged.
3. **`roll-call-ack/index.ts` (new edge fn, `--no-verify-jwt`, public):** POST `{ code }` → verify →
   `ack_commitment_by_token` → `{ ok, acknowledged_at }` or an error status. No auth header required;
   the code is the credential.
4. **Kill switch:** gate `roll-call-ack` on `feature_flags.verified_commitments` (same server flag
   that already stops every card and push) plus a dedicated `feature_flags.rollcall_lockscreen` so
   this can be turned off without killing the rest of Verified Commitments. Fails **open** on a
   missing row, matching 0141.

## Client changes (RN shell — not the WebView)

The lock-screen tap never touches the WebView UI; it is handled entirely in the native shell's
notification layer (`src/proto/ProtoApp.tsx`, `src/core/reminders.ts`, `src/lib/notify/`).

1. **Category registration** (`expo-notifications`, JS runtime — **no Mac-only native module**):
   `setNotificationCategoryAsync(categoryId, [{ identifier: 'ACK', buttonTitle: action_label,
   options: { opensAppToForeground: false } }])`. Because the coach's `action_label` varies, register
   one category per distinct label, id = `RC::<slug(action_label)>`; the reminder fn sends the
   matching `categoryId`. Register the common labels at startup and lazily register any unseen label
   when a notification with a new `categoryId` arrives. (iOS truncates long action titles — cap the
   label the composer allows, or truncate at registration.)
2. **Response handler** — extend the existing `addNotificationResponseReceivedListener` in
   `ProtoApp.tsx`: when `actionIdentifier === 'ACK'`, read `data.code`, POST to `roll-call-ack`,
   then update the delivered notification to the confirmation ("Logged 5:01 AM. You're up.").
3. **Optimistic + offline queue** — show the confirmation immediately; if the POST fails (offline,
   Expo/edge hiccup), enqueue the code in local storage and retry on connectivity and on next app
   foreground. Codes are idempotent, so a double-send is safe.
4. **Apple Watch** — see below; the same `ACK` action carries to the wrist for free via mirroring.

## Escalation ladder

The point of a roll call is to catch oversleeping, so silence has to get louder, not stay polite.
The ladder runs off the deadline (`respond_by_at`), for responses still `pending` at each rung. It is
a small extension of the existing reminder cron, not a new subsystem.

| Rung | When | What fires | Notes |
|---|---|---|---|
| **L1 nudge** | before deadline (today's behavior) | normal reminder push, only to `pending` | unchanged |
| **L2 break-through** | at `respond_by_at` | one **time-sensitive** push (iOS `interruptionLevel: 'time-sensitive'`; Android high-importance, optionally full-screen) | punches past a Focus/summary; still respects the OS Do Not Disturb the user set |
| **L3 coach digest** | at `respond_by_at` (+ short lag) | board rows finalize (`status = 'missed'` for no-answers) and the coach gets **one "who's up" push** for the instance: counts + who didn't answer | one push per instance per coach; this digest *is* the coach rung — no separate ping |
| **L4 guardian (optional)** | configurable | a linked parent/guardian is notified for a missed roll call | guardianship + consent already exist; **off by default**, coach opt-in per commitment |

**Coach "who's up" digest (L3), spelled out.** When the window closes, the coach gets a single push
like *"5 AM Club — 17/20 up. 3 didn't answer: Marcus, Dee, Sol."* Tapping it opens the commitment
board (the deep link already exists). It reuses the `commitment_board` payload for counts and names,
so there is no new read model. One push per instance per coach; batching multiple instances that
close together into a single coach push is a future nicety, noted below.

- **Config lives on the commitment** — add a small `escalation` jsonb (or discrete columns) to
  `commitments`: `{ breakthrough: bool, notify_coach_on_miss: bool, notify_guardian_on_miss: bool }`.
  Render-time defaults when null, same coach-authored-only rule as the rest of the feature.
- **Server work** — extend the reminder pass (or a sibling cron function) to select rows that have
  crossed the deadline and are still `pending`, and drive L2–L4. Claim-and-mark so overlapping ticks
  can't double-fire a rung (same guard `claim_due_commitment_reminders` already uses).
- **Critical vs time-sensitive (honest):** a truly silent-mode-piercing **critical alert** needs an
  Apple entitlement and App Review approval. Default to **time-sensitive** (no approval, already
  breaks through summaries/most Focus modes). Critical is an optional later upgrade behind the
  entitlement.
- **Buddy rung** (another athlete as accountability partner) is noted as a future rung; not in this
  build.

## Apple Watch

watchOS **mirrors the paired iPhone's notifications, including their action buttons**. Because L1/L2
are ordinary notifications with the `ACK` action, "I'm Up" shows on the wrist with no separate watch
app: the athlete taps it on the Watch, and watchOS relays the action to the iPhone, which runs the
same handler and posts the same signed code. So the Watch surface is mostly **QA + making sure the
background action path works when the phone is charging in another room** (the Watch relays over
Bluetooth/Wi-Fi).

- **In scope:** the mirrored notification action on the Watch, verified on a real device.
- **Out of scope (later):** a standalone watchOS app that fires the code itself when the phone is out
  of range or off — that is native watch work, same class as the phase-2 widget.
- **Honest edge:** if the phone is unreachable from the Watch, the tap can't relay; the athlete is
  covered by the escalation ladder until the phone reconnects.

## Data flow

**Happy path (app backgrounded):** cron sends push with code → athlete taps "I'm Up" on lock screen →
iOS/Android wakes the shell in the background → handler POSTs code → `roll-call-ack` verifies + records
→ handler swaps the notification to the confirmation. No app open, no Face ID.

**Offline at tap:** confirmation shows immediately; code is queued; retried when back online (still
inside grace in the normal case; genuinely late only if offline past the grace window).

## Honest edges / reliability

- **iPhone force-quit:** if the athlete has force-quit the app (swiped it away in the app switcher),
  iOS will not wake it for the action, so the ack is delivered on next open, not instantly. Common
  case (app merely backgrounded) records immediately. Escalation nudges still fire meanwhile, and the
  coach board reconciles. **The phase-2 widget (native App Intent) is what closes this gap.** Call
  this out; do not imply "always instant."
- **Notification swiped away:** opening the app stays the fallback (also closed by the phase-2 widget).
- **Timestamp:** recorded at server receipt, not tap time (tap time from the phone would be
  spoofable). The 10-min grace absorbs normal delay; being offline past grace is honestly late. Noted
  as an accepted phase-1 tradeoff.
- **Security:** the code is a hotel key card — one athlete, one instance, only inside the window,
  signed so it cannot be forged, and it can only ever do one harmless thing (mark that athlete present
  for that one roll call). Even intercepted, it expires and is scope-locked.

## Testing

- **Edge (`deno test`):** valid code → 200 + ack row updated; expired code → 410; tampered/forged sig
  → 401; wrong-secret → 401; idempotent re-tap → 200 same time; flag off → refused.
- **Migration / authz (`rls_authz_test.sql`):** `ack_commitment_by_token` records for the given
  athlete; a normal `authenticated` client **cannot** call it directly; seed its own actors (section-8
  revocation section — probes appended after it must seed their own actors or they test nothing).
- **Contract probes:** extend the payload-contract probes so a rename of `code` / `action_label` /
  `categoryId` on the push is caught (a silent rename = a dead button).
- **Client (jest):** `ACK` action → posts code; POST failure → queued + retried; success → notification
  updated. Mock `fetch` and the notifications module.
- **Escalation (`deno test` + authz):** at deadline a still-`pending` row fires L2 once (claim-marked,
  no double-fire on overlapping ticks); the L3 coach digest fires **once per instance** with correct
  counts and the right non-responder names, and marks board rows `missed`; L4 fires only when
  `notify_guardian_on_miss` is on; an athlete who answered before the deadline triggers no rung and is
  counted "up" in the digest.
- **On device (cannot be exercised on Windows/jest — QA checklist):** backgrounded tap records
  immediately (iOS + Android); force-quit iOS defers to next open; offline tap queues then lands;
  confirmation replaces the original notification; **L2 time-sensitive push breaks through Focus**;
  **Apple Watch mirrored "I'm Up" records with the phone nearby**, and relays when the phone is in
  another room.

## Phasing

- **Phase 1 (this spec):** notification action + `roll-call-ack` + signed code, **plus the escalation
  ladder (L1–L4) and the mirrored Apple Watch action**. Cross-platform. Ships on a normal EAS build
  (notification categories are JS runtime; the Watch action needs no separate watch app).
  Suggested build order inside phase 1: (a) signed code + endpoint + migration, (b) notification
  action + client handler + confirm/queue, (c) escalation ladder incl. the L3 coach digest,
  (d) Watch QA.
- **Phase 2 (later, iPhone):** the authored `ios-widget/OnStandardWidget.swift` gains a native App
  Intent that calls the **same** `roll-call-ack` endpoint with a signed code, giving a persistent
  lock-screen button and closing the force-quit / swiped-away gaps. A standalone **watchOS** app
  (fires the code when the phone is out of range) is the same class of native work. No server rework —
  the endpoint and code format are shared. (Widget wiring is the Mac-only work in `ios-widget/README.md`.)

## Open questions / founder calls

- **Grace window:** reuse the reminder's 10 min for the code's validity, or a different roll-call
  grace? (Default: reuse 10 min.)
- **Action-label length cap** for iOS action buttons — pick a max in the coach composer.
- **Sub-flag name** — `rollcall_lockscreen` assumed; confirm.
- **Escalation defaults:** breakthrough (L2) and coach-on-miss (L3) on by default? guardian (L4)
  stays off-by-default, coach opt-in. Confirm.
- **Critical alerts:** ship time-sensitive now; pursue the Apple critical-alert entitlement later, or
  not at all? (Default: time-sensitive only for now.)
- **Coach digest timing:** fire at the roll-call deadline (default), or at a coach-set morning time?
  And batch multiple roll calls that close together into one coach push, or one push each? (Default:
  at each deadline, one push per instance; batching later.)
