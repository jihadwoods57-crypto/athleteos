# The Meal Loop & Thread Upgrade

Four slices against the product's core workflow: photo → analysis → correction → thread, plus the
AI that lives in it. Shipped 2026-07-27/28 on `feat/production-transformation`.

**Zero new migrations.** Every slice rides tables already live on production: `athlete_memory_facts`
(0019), `notifications` (0027), `claim_ai_usage_key` (0030), `meal_comments` (0046/0049),
`profiles.timezone` (0088), feature flags (0109).

---

## Phase 0 — the rails, armed first

| Migration | What | Status |
|---|---|---|
| 0151 | Revoke TRUNCATE/TRIGGER/REFERENCES from anon + authenticated (53 tables) | applied |
| **0154** | **Revoke INSERT/UPDATE/DELETE from `anon` (52 tables)** | applied |
| 0152 | Enforced $/day AI ceiling + kill switch | applied |

**0154 was found by doing the work, not by planning it.** Applying 0151 surfaced a disagreement
between prod and a fresh local database: on production `anon` — the key that ships inside the app
bundle — held INSERT, UPDATE and DELETE on 52 tables including `days`, `meals` and
`athlete_profiles`. It came from the hosted project's own bootstrap defaults, predating migration
0001, which is why no migration in this repo had ever addressed it.

Verified not exploitable before touching it: inside a rolled-back transaction, `set local role
anon; insert into days …` returned *"new row violates row-level security policy"*. Every write
policy gates on an identity helper resolving through `auth.uid()`, which is NULL for anon.

Worth closing anyway, and more urgently than 0151's TRUNCATE grant: PostgREST doesn't expose
TRUNCATE, but it fully exposes INSERT/UPDATE/DELETE. That left RLS-policy correctness on every
table, forever, as the only thing between the public key and writing to production. Now anon writes
are refused at the table-privilege level, before RLS is consulted.

The spend gate is live and metering: a real photo analysis costs **$0.019**, against a $50/day
ceiling (~2,600 analyses of headroom). All three refusal paths verified on prod and restored.

---

## Slice 1 — Kill the wait

**Before:** the athlete watched a scanning interstitial for the entire vision call before anything
counted. The photo lived only in sessionStorage (app killed = photo gone), the upload was
fire-and-forget with zero retry, and a failed upload left the `meals` row pointing at an object
that was never stored — which `photo-store` then cached as missing for the whole session.

**Now:** "Log it" commits immediately. The athlete gets their day back; the analysis arrives in the
thread like a message.

**Honest by construction.** A pending meal takes photo + timing credit and nothing else — exactly
what a manually-logged meal has always scored. `qualityFrac` already skips slots without numeric
quality ("a missing signal never costs the athlete"). **The scoring engine is unchanged**; no path
reads the new `pending` marker. `protoOptimisticLog.test.ts` asserts a pending meal's components and
score are byte-identical to a manual meal's.

**The outbox** carries the whole remaining job (upload → insert → analyse → clarifying answers) in
one durable entry written before any network call, drained on demand / foreground / reconnect,
serialized. It also fixed a pre-existing bug: an offline log used to lose its `meals` row, and with
it the thread, permanently. Quota policy drops the *oldest* photo, never the newest, and marks the
entry dead with a reason so the thread can explain it.

**Four thread states** — pending / questions / failed / result — derived from state rather than
scraped from the DOM (`paint()` used to re-prepend the previous `outerHTML`, which could not
represent a read in flight). Clarifying questions are answered **in the thread** now. While pending,
macros show em-dashes, not zeros: zeros read as a measurement, not an absence.

**Three guards on `applyAnalysisResult`:** only lands on a still-pending slot, only from *this*
photo (`pendingHash` — kills the offline-relog race), never over a meal already corrected.

---

## Slice 2 — The memory flywheel

`athlete_memory_facts` has been live since the beginning and was **read by zero edge functions** —
the loop that wrote it lived only in the deleted React Native app. An athlete could correct the same
mistake every morning forever.

The most valuable fact isn't a preference, it's **calibration**. "Portion was double," repeated,
becomes: *their servings usually run LARGER than they look (seen 4x) — lean up when portion size is
ambiguous.* That corrects a systematic bias rather than recording a taste. Rendered as reading
guidance, never as a number.

**The safety gate**, preserved from the reference implementation: an inferred safety fact lands as
`pending_confirmation` and binds only when the athlete taps yes in the thread. The server loader
reads `status = 'active'` ONLY — verified against the real table with a seeded pending row correctly
withheld.

Portion priors are deliberately **not** in 0019's coach-readable kind list: *"he consistently
underestimates portions"* reads as a judgement about honesty; it's a fact about the camera.

**Two real bugs the tests caught, not review:**
1. The parity test failed on first run — the port lowercased food names where the reference
   preserves the athlete's own capitalisation.
2. `value` is JSONB; a legacy row can hold `{name: "peanuts"}`, and a naive `String()` would have
   put `"[object Object]"` into a prompt as a fact about the athlete.

Also caught: `analyze-meal` built its prompt content *before* the memory load, so the merged
avoid-list arrived too late to reach the text. The feature would have looked wired and done nothing.

Flag `ai_memory`, default **off**.

---

## Slice 3 — The living thread

One proactive follow-up per athlete per day, in their **own local afternoon**, only when yesterday
evening was genuinely weak.

Every rule is about *not* sending: flag, local window, notification opt-out, per-athlete daily claim,
global daily budget, spend ceiling. A null timezone is a **skip, never a guess** — pushing at 3am is
the fastest way to lose notification permission for good. The window is late afternoon so the
message lands while the evening can still be changed.

**It lands on yesterday's meal** (`meal-view/<id>`), not today's slot — today's dinner isn't logged
yet, so a message about it would open an empty screen.

No new storage: the AI row goes into `meal_comments` exactly as meal-chat already writes it, and the
notification carries the meal id in `kind` (free text in 0027). Dedup rides `claim_ai_usage_key`,
which claims and marks in one statement — verified on prod that a second claim is refused.

Delivery needed two fixes: the bell feed deliberately strips routes (a server row is a record, not a
task) — `ai_followup` is the documented exception, with a junk suffix rendering as a plain record.
And `meal-view` had no conversation at all, so a push tap would have landed somewhere with no way to
reply; it now fetches the meal directly by id and carries a thread + composer.

Cron scheduled hourly and active. Flag `ai_followups`, default **off**.

---

## Slice 4 — Coach fast-lane

**Reactions.** A coach watching 60 athletes can't write 60 comments, so most meals get nothing — and
"nothing" is indistinguishable from "not seen". Four chips, toggle semantics so a mis-tap is
undoable. `kind='reaction'` and the athlete-side rendering already existed; this is coach UI only.

**Escalation.** An AI that answers *"should I cut 8lb before Friday"* is guessing at something with
real consequences, in a voice the athlete trusts. `meal-chat` now offers `flag_for_coach` alongside
`reply` with `tool_choice: 'any'` — **a forced reply tool cannot decline**, which was the actual
defect. The rule says do not advise *and do not reassure*: a warm non-answer still reads as an
answer.

On a flag the athlete is told plainly in the thread, active staff are notified, and a jailbreak
can't spam a coach (3/athlete/day). A solo athlete still gets the decline — safety isn't conditional
on someone listening. Outcome recorded as `phase='flagged_for_coach'` so the rate is observable.

---

## Verification

| Gate | Result |
|---|---|
| TypeScript | clean |
| Jest | **2,638** across 218 suites (from 2,571 at the start of the transformation) |
| Proto module tests | 41 |
| RLS authz (fresh DB, 154 migrations) | **419 / 419** |
| XSS lint | clean |
| QC sweep, 122 captures, both themes | 0 overflow · 0 contrast · 0 clipped · 0 undersized taps · 0 JS errors |
| Live prod smoke | analyze-meal returns a real read; meal-chat 401/400 correctly; ai-followup 401 without key, clean dry-run |

Known QC failures are pre-existing and tracked in KNOWN_RISKS: `coach-commitments` (harness
timeout) and `monthly-report` (loading state with no timeout).

## Rollout

Both AI flags are **off**. Enable per-athlete → one team → default on, watching:
- `ai_calls` spend against the $50/day ceiling
- `meal_analysis_applied` vs `meal_logged` (background analysis landing rate)
- `memory_fact_confirmed` (are the confirmations wanted?)
- `flagged_for_coach` rate (expect <5% of chats)
- follow-up `blocked` counters in the cron's JSON summary

Rollback is a flag flip for slices 2–4; slice 1 is a client redeploy (OTA).

## A process note

`deno check` reported a file clean while it contained a genuine syntax error — it was serving a
stale cache, and only the deploy bundler caught it. `--reload` reproduces it. This strengthens the
existing Phase 2 item to put deno checking into `npm run verify` properly.
