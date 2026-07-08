# OnStandard — Full Product Audit & Top-20 Roadmap

**Date:** 2026-07-02 · **Method:** six parallel audit agents (architecture/code quality, database/backend, security, AI workflows, UI/UX/onboarding, product/growth/performance) over the full repo at branch `feat/food-search-ui` (clean tree). Read-only; no live systems touched.

---

## Overall verdict

OnStandard is in the **top decile of code health for its stage**: genuinely one-directional layering (zero raw Supabase calls in screens), strict TypeScript with 2 `any`s total, 1,321 tests green in 13s, universal RLS with pinned `search_path`, honest self-documenting migrations, activation-first onboarding (score reveal before account), 1-tap daily commitment, zero-tap coach triage, and unusually good accessibility.

But it is **a finished product with zero users, zero instrumentation, and zero dollars**, carrying:
- **three live-breaking / child-safety bugs** invisible until a real user hits them,
- a **security hardening set authored but not applied** to the live project,
- a handful of places where the app **violates its own honesty constitution** (fabricated AI fallbacks, hard-zero streaks, seeded chart data),
- and a remaining distance to "sellable" that is **operational, not technical** (Apple/EAS build, email vendor, Stripe link, legal blanks).

The single highest-leverage move: **feature-freeze, fix live, and spend two weeks converting the finished app into one paying adult gym** (which sidesteps the entire COPPA/guardian chain — the only genuinely slow dependency).

---

## The Top 20, in priority order

Effort: S ≈ hours–1 day · M ≈ days · L ≈ 1–2 weeks. Priority order ≈ recommended completion order; the phases below group what runs in parallel.

### Phase 0 — Fix live before any real user touches it (~1 week; items 1–6)

**1. Restore coach visibility for new links — the `org_memberships` cutover gap.** Impact: **Critical** · Effort: **S**
Migration 0012 switched `can_view()` to read `org_memberships`, but every join path (`join_team`, `request_join_team`, coach-approve, `create_team`) still writes only the legacy tables, and the one-time backfill ran at migration time. **Every coach↔athlete link formed since the cutover grants the coach zero visibility** — the core loop (coach sees athlete's day) is silently broken on live, and it also gates `send-push` and meal-photo reads. The repo's own `roundtrip.itest.ts` would fail against live. Fix: trigger or dual-write into `org_memberships` + re-run the backfill.

**2. Stop minors self-verifying guardian consent.** Impact: **Critical (child safety)** · Effort: **S**
`gcr_read` lets the athlete SELECT their own row **including the verification token** (0008), and the public `guardian-verify` endpoint flips to `verified` given only that token. A minor can self-approve the COPPA gate that unlocks real-data sync and photo-to-AI. Fix: column-level revoke on `token` (or a token-less status RPC).

**3. Lock down SECURITY DEFINER execute grants — `notify()` forgery.** Impact: **High** · Effort: **S**
0005 set a *default privilege* granting EXECUTE on all functions to `anon, authenticated`; 0013 fixed table DML defaults but not functions, and 0027 forgot its revoke. Any user can call `POST /rpc/notify` and inject arbitrary notifications into **any** user's feed — including minors — a social-engineering channel. Also exposed: `backfill_org_memberships_teams()`, `is_minor(uuid)` (minor-status oracle), `team_head_coach_name(uuid)`. Fix: revoke + add a function default-privileges revoke so the bug class can't recur each migration.

**4. Apply 0029–0033 to live, fix the missing grants, and finish the spend guard.** Impact: **High (unbounded spend + broken features today)** · Effort: **S–M**
The security fixes are authored, not applied: live currently has fail-open AI caps (`withinKeyCap` returns `true` on any error), no score-shape checks, no storage MIME/size limits, and no trust-pass RPCs. `plan-generate` was **missed by the 0030 sweep entirely** — no global/anon cap (anon callers skip the only cap it has), leaks `String(e)` error internals, and its 2048 `max_tokens` truncates exactly the fullest (most valuable) plans into hard failures. Also ship the post-0013 grants that 0027/0028/0032 forgot — **mark-notification-read is broken on live right now** (policy exists, privilege doesn't), and Meal Plans Wave 2 would hit the same trap.

**5. Never fabricate a meal — honest AI failure states.** Impact: **High (the brand)** · Effort: **S**
Any AI failure — timeout, 502, or **hitting the daily cap** — silently logs a canned "Chicken, Rice & Broccoli, 52g protein, quality 94" into the athlete's real history with no badge; a failed label scan presents a **sample nutrition label** under "read straight off the label · exact" framing. In a product whose moat is "the number never lies," this is the one place it lies. Fix: an error state + retry in the result stage, distinguish "cap reached" from "failed," and never persist un-analyzed placeholders. (Same sweep: the always-fabricated `SEEDED_LEAD` padding on real athletes' trend charts, and the ungrounded model-authored `quality` score — wire the existing-but-never-called `arbitrate()`.)

**6. Reconcile the migration ledger and the founder docs.** Impact: **Med-High (launch safety)** · Effort: **S**
Live has a `0017` the repo doesn't, after three renumbering collisions; there's no recorded canonical applied-set. `START-HERE.md` still says "apply 0004→0013, nothing is connected to a real server" while `.env` has `EXPO_PUBLIC_BACKEND_LIVE=true` against a live project holding real data. A founder following the top-level doc could run staging-era instructions against production. Fix: `supabase migration list` + `repair`, one source-of-truth go-live doc, timestamp-named migrations going forward.

### Phase 1 — Convert the finished app into one paying gym (~2 weeks, mostly ops, runs parallel to Phase 0; items 7–10)

**7. Run the launch ops chain.** Impact: **High (the critical path)** · Effort: **M (ops, not code)**
Apple Developer enrollment → EAS/TestFlight production build (this **one build simultaneously un-gates push delivery, deep-link invites, and real camera testing**), wire Resend for guardian email, fill the legal blanks in Terms/Privacy and host them at onstandard.app. Today a fresh real user cannot install the app at all. The code is ahead of the company; this is the only path that changes it.

**8. Add crash reporting + a daily-actives view.** Impact: **High** · Effort: **S**
There is zero analytics or crash reporting anywhere — the founder cannot answer "how many athletes logged today," and a beta crash disappears silently. The entire ratified strategy ("prove retention before sparkle") has no instrument. Sentry + one SQL view (`SELECT date, COUNT(DISTINCT athlete_id) FROM days GROUP BY 1`) is an afternoon and blocks nothing.

**9. Wire the first dollar.** Impact: **High** · Effort: **S**
The model is coherent (coach/org pays per seat, athletes inherit; $249/$499/$799 seeded; compliant terms UI built; portal is one env var) but there is **no checkout and no webhook** — nothing flips a `subscriptions` row when money moves. A Stripe Payment Link for `org_starter` + a ~100-line webhook edge function is the entire gap. B2B off-platform means Apple IAP can wait.

**10. Launch to adults first — ratify the audience for the next 12 months.** Impact: **High** · Effort: **decision, not code**
PRODUCT.md says the primary user is a 13–22 athlete; the ratified GTM says gyms/adults first, precisely to skip parental consent. Launching the beta with adult gym clients sidesteps the guardian/COPPA chain entirely (the only slow dependency) and resolves which identity tunes the copy, onboarding, and score reveal this year. Decide it once, write it down.

### Phase 2 — Retention & trust mechanics (weeks 3–5; items 11–14)

**11. Build the ruled streak grace + comeback ramp.** Impact: **High (retention)** · Effort: **S**
`currentStreak()` returns 0 the instant the live score dips below 80 — the flame reads a bare "0" every morning — and one recorded miss hard-resets the chain. The council already ruled the fix (1 grace day per rolling 7 + honest label); neither exists in code, and there is no athlete-facing "get back on track" path anywhere. This punishes the exact moment retention is decided (the morning after a bad day). One pure branch in `history.ts` + a label.

**12. Surface sync and linking failures.** Impact: **High (the accountability contract)** · Effort: **M**
~20 `.catch(() => undefined)` swallows, no NetInfo, no toast system: an athlete can log all week on a dead connection and the coach sees "not logged" — the contract breaks invisibly on both sides. A failed "Request to join" gives zero feedback (athlete waits forever for an approval that never comes). Fix: a "last synced / not synced" pill on Home + coach dashboard, a retry/dead-letter for persistent push failures, and feedback + loading state on Connect.

**13. Wire the AI memory flywheel.** Impact: **High (the differentiator)** · Effort: **M**
The "it knows you" centerpiece is fully scaffolded and safety-gated on both ends — and **never pumps**: nothing ever inserts a fact (`candidateFactsFromCorrection` has no production caller), `retrieveForTask()` is never called, the assist function ignores its task contract, the ContextPack `memory` field is never populated, and MemoryConfirm polls for facts that cannot exist. Wire fact-writes from meal edits → confirmation → retrieval into prompts. Then make the join nobody made: **weekly AI insight push** (deterministic `weeklyReport.ts` exists, notification rails 0027/0028 exist) and a proactive coach digest (`predict_falling_behind` already exists as a tool).

**14. Extend history past 14 days.** Impact: **High** · Effort: **M**
A hard `HISTORY_CAP = 14` means no season arc, no "longest streak" memory, no "was 9, reset Tuesday" coach line — and the $24.99 Individual Plus tier's headline feature ("your full portable record") has **no data foundation**. The server keeps everything; the client just never asks. Paginated history read + a long-view surface.

### Phase 3 — Scale & the 10-year codebase (weeks 5–8; items 15–20)

**15. Move score authority server-side.** Impact: **Med-High** · Effort: **L (near-term slice: S)**
`days.score` is client-computed and only shape-checked; the coach dashboard renders it and `grant_trust_pass` counts `score >= 80` from athlete-writable rows — a tampered client can post a plausible flat-85 history and qualify for the camera-free pass. Near-term (S): compute trust-pass eligibility from photo-bearing `meals` rows instead. Long-term (L): persist scoring inputs + server recompute. Also make an explicit risk ruling on self-attested age (`base_age` is athlete-writable and is the entire minor-protection keystone).

**16. Harden linking consent.** Impact: **Med-High (minors)** · Effort: **M**
`tm_manage` lets any team staff INSERT an **active** membership for **any profile uuid** — flipping `is_coach_link` and opening an authorized messaging channel to an arbitrary minor with no athlete consent. Separately, 4-char vanity codes on unthrottled SECURITY DEFINER RPCs are brute-forceable (guessed code = immediate active membership). Fix: staff inserts land as `invited` requiring athlete acceptance; 6-char code minimum; attempt-throttle on code RPCs.

**17. Split the god-store, add a linter, version the persistence.** Impact: **Med-High (the biggest 10-year debt)** · Effort: **M–L**
`useStore.ts` is 1,484 lines / 161 actions / ~126 state fields mixing domain, navigation, and session — every future feature lands in one file. There is **no ESLint at all**, so the (currently perfect) layer boundaries are enforced purely by convention. The persisted blob has no `version`/`migrate` — schema changes rely on scattered defensive guards. All mechanical: Zustand slices, `eslint-plugin-boundaries`, versioned persist. Do this before the next feature wave, not after.

**18. Add render tests for the honesty-critical screens.** Impact: **Med-High** · Effort: **M**
1,321 tests, essentially zero on UI (78:1 core-to-screen ratio; the three biggest files — Onboarding 1,105, MealCapture 982, Home 811 lines — carry the critical paths untested). The recovery-leak bug was exactly this class: correct engine, wrong number surfaced. A handful of RTL render tests on Home / MealCapture edge states / coach dashboard closes it.

**19. Coach roster scale pass.** Impact: **Med now, High at 100+ athletes** · Effort: **M**
`fetchLinkedDays` pulls every linked athlete's **full JSONB day row** with no pagination, re-fetched on every open, rendered with a bare `.map()` (no list virtualization anywhere in the codebase) with per-row recomputation on a whole-store subscription. The $799 tier promises 150 athletes — the flagship paying screen degrades exactly as the customer succeeds. Paginate, virtualize (FlashList), memo the row.

**20. AI cost & trust-polish sweep.** Impact: **Med (margin + perceived quality)** · Effort: **S**
Per-mode model map: label transcription and memory/order rephrasing are Haiku-4.5-class tasks running on Sonnet 5 (~60–70% of that bill); `assist` defaults to stale Sonnet 4.6; the Opus "deep" path is **client-triggerable** and buys nothing under a 512-token narration tool — remove or server-gate it. Add prompt caching (`cache_control` on the static system+tools blocks), a per-user cap on `assist`, and a server-side abort tied to request close (today a 20s client abort still pays for the full completion). Bundle the small trust-polish set: grade-colored rings on coach/parent detail (currently **always green**, even around a failing athlete), the ~6 hardcoded light-theme hexes breaking dark mode, first-meal CTA opening the camera instead of landing on Home, Android hardware-back handling for the overlay stack.

---

## Impact × effort at a glance

| # | Item | Impact | Effort |
|---|------|--------|--------|
| 1 | Coach-visibility gap (org_memberships) | Critical | S |
| 2 | Minor self-verifies consent | Critical | S |
| 3 | notify() forgery / definer grants | High | S |
| 4 | Apply 0029–0033 + plan-generate parity + grants | High | S–M |
| 5 | Fabricated AI fallback meals | High | S |
| 6 | Migration ledger + doc truth | Med-High | S |
| 7 | Launch ops chain (Apple/EAS/Resend/legal) | High | M (ops) |
| 8 | Sentry + daily-actives view | High | S |
| 9 | Stripe link + webhook (first dollar) | High | S |
| 10 | Adults-first launch ruling | High | decision |
| 11 | Streak grace + comeback ramp | High | S |
| 12 | Sync/linking failure surfaces | High | M |
| 13 | AI memory flywheel + weekly insights | High | M |
| 14 | History past 14 days | High | M |
| 15 | Server-side score authority | Med-High | L (slice: S) |
| 16 | Linking consent hardening | Med-High | M |
| 17 | God-store split + ESLint + persist versioning | Med-High | M–L |
| 18 | UI render tests | Med-High | M |
| 19 | Coach roster scale | Med→High | M |
| 20 | AI cost + trust-polish sweep | Med | S |

Nine of the top eleven are S-effort with High-or-better impact — roughly one focused week buys down almost all of the critical risk.

## Deliberately below the cut line

i18n structure (US-first; log it, don't do it) · meals/check-ins dual-representation cleanup and jsonb-child-table normalization (do with #15) · `isBackendLive` 118-site dual-path retirement (do at go-live confidence, not before) · second growth loop / guardian-email-as-parent-funnel (revisit when minors are in scope) · Plan-tab emptiness with flags off (resolves itself when flags flip) · feature-flag lifecycle registry (one note in features.ts).

## What is genuinely excellent (don't break it)

The scoring firewall (commitment can never reach 80 without a photo), council-documented magic numbers, the `db` facade discipline, forced tool calls + macro grounding + honest confidence badges in the AI layer, the ask-don't-guess two-phase clarify flow, activation-before-account onboarding, zero-tap coach triage, 152 accessibility labels with reduce-motion respected everywhere, and a 13-second full test run. These are the assets the roadmap exists to protect.
