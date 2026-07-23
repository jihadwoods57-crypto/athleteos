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
5. **Non-response escalates** — the existing reminder cron keeps nudging only the people who haven't
   answered, and they stay lit on the coach's board.

## Non-goals

- No persistent lock-screen **widget** in this phase (that is phase 2 — it reuses this endpoint).
- No new scheduling UI, no change to the daily 0–100 score or the separate Accountability score.
- No decline/snooze/excuse flow from the lock screen.

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
5. **Escalation** — unchanged: `claim_due_commitment_reminders` only ever selects still-`pending`
   responses, so answered athletes are never pinged again and non-responders keep getting nudged.

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
- **On device (cannot be exercised on Windows/jest — QA checklist):** backgrounded tap records
  immediately (iOS + Android); force-quit iOS defers to next open; offline tap queues then lands;
  confirmation replaces the original notification.

## Phasing

- **Phase 1 (this spec):** notification action + `roll-call-ack` + signed code. Cross-platform. Ships
  on a normal EAS build (categories are JS runtime).
- **Phase 2 (later, iPhone):** the authored `ios-widget/OnStandardWidget.swift` gains a native App
  Intent that calls the **same** `roll-call-ack` endpoint with a signed code, giving a persistent
  lock-screen button and closing the force-quit / swiped-away gaps. No server rework — the endpoint
  and code format are shared. (Widget wiring is the Mac-only work described in `ios-widget/README.md`.)

## Open questions / founder calls

- **Grace window:** reuse the reminder's 10 min for the code's validity, or a different roll-call
  grace? (Default: reuse 10 min.)
- **Action-label length cap** for iOS action buttons — pick a max in the coach composer.
- **Sub-flag name** — `rollcall_lockscreen` assumed; confirm.
