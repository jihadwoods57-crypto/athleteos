OnStandard — FINAL Sprint Report + Go-Live Checklist (Day 4 of 4)
2026-06-29 (UTC) · Founder returns today · Branch: crew/4day-sprint (NOT merged)

Welcome back. This is the whole-sprint wrap-up. Plain English, scannable, written so
you can act without opening the codebase. Nothing went live — details at the bottom.

================================================================================
TL;DR — THE WHOLE 4-DAY SPRINT (+ the strategy/architecture layer added at the end)
================================================================================
The app was already "app-complete" when the sprint started. Over four founder-away
days the crew (1) wired the real backend (auth + cloud sync + roster), (2) shipped
five new features, (3) made the ONE core loop real — edit a meal, save it, watch your
score move — (4) did a heavy legal/safety hardening pass, (5) built an accounts &
settings layer, and (6) on the final day, ratified and laid the foundation for a
10-year enterprise architecture and the company's go-to-market strategy.

- Tests grew 559 → 1001. Every safety gate (typecheck + full test run + iOS build)
  was green on EVERY commit (per the crew's logs; this report was compiled review-only
  without re-running the suite).
- NOTHING WENT LIVE. The backend flag was never enabled, the two new engines stay OFF
  by default, no database migration was ever pushed to the live project, no real data
  was touched, no external email/message was sent, and nothing was merged to master.
- The branch is 135 commits ahead of master and is yours to review + merge.

The two things that most need YOU:
1. The board's only scored verdict is still Night-2's "NOT YET, 3.07/10" — it predates
   the loop fix, the legal hardening, AND the architecture layer, so it badly understates
   where the code now is. The board did not re-convene on Nights 3 or 4, so the major
   work is ungraded. (Honest read in the BOARD section below.)
2. Launch is now gated entirely by HUMAN steps you alone can start: a lawyer, a
   parent-verification vendor, and an email service. Every week those don't start is a
   week everything else waits. This is your single highest-value move — above reviewing
   any feature.

One caveat to read with eyes open: the founder-facing doc FOUNDER-RETURN-2026-06-28.md
describes the sprint at its "day4-end" close (894 tests). The branch then continued 28
more commits — the accounts/settings phase and the entire enterprise-architecture +
Phase-A foundation — bringing it to 1001 tests. This report covers that FINAL state.

================================================================================
EVERYTHING SHIPPED — by feature / priority item
================================================================================
Status key: VERIFIED = pure logic unit-tested, or a local round-trip proven.
            BUILT (not runtime-verified) = code + seam exist, never run on a real
            device/live backend by guardrail.

THE RANKED BUILD QUEUE (P0–P8) — all drained:

P0 · Backend wiring (the keystone) — VERIFIED locally, flag-OFF
  Real auth, day-sync (every push gated by consent), athlete consent screen, and coach
  roster reads — all behind EXPO_PUBLIC_BACKEND_LIVE. Flag off = byte-for-byte identical.
  Full round-trip (auth → join team → push day → coach sees it → outsiders blocked by
  RLS) proven on a THROWAWAY LOCAL Supabase stack. Migrations 0004 (create_team + real
  join code, retiring static EAGLES24) and 0005 (grants) authored + locally verified.

P1 · Performance signal (the #1 persona gap) — VERIFIED (pure) / sync = seam
  Athletes log PRs (lifts, sprints, jumps, body weight, custom); trends + personal bests
  with an honest "am I improving?" read. Kept OUT of the daily score by design (D3).
  Coach PersonDetail performance line is a present-gated seam. Cloud sync needs its own
  table (D4). The board called this "the most honest thing in this app."

P2 · Better meal logging — VERIFIED (pure) / barcode = seam
  Curated offline 55-food starter table with honest per-serving macros + search + manual
  quick-add; the meal recomputes from real macros. Barcode scan is an inert seam (D5).

P3 · Reminders / notifications — VERIFIED (pure) / device = seam
  Full reminder model (which/when/anti-nag copy), a persisted settings screen, and the
  device hook. Wired to the safe line; nothing fires until a phone library is added (D6).

P4 · Weekly report + messaging — VERIFIED (pure) / delivery = seam
  Per-athlete weekly digest now surfaced on Profile + a team weekly report on the Coach
  dashboard. Messaging model with an honest "not yet delivered" note; a minor-messaging
  relationship gate (a minor may only message an authorized coach/trainer/guardian,
  fail-closed) + RLS 0006. Real delivery + the minors policy await you (D7/D10, legal).

P5 · Wearable recovery — VERIFIED (pure) / device = seam
  Pure mapping from a real sleep/HRV/resting-HR sample to a 0–100 recovery score;
  blendRecovery returns the self-report UNCHANGED when no sample exists, so today's score
  is byte-for-byte the same. Not wired into live scoring (D8). Health seam inert.

P6 · Persona-voice fixes — VERIFIED (pure)
  AI coaching reframed prescriptive → educational with a medical-disclaimer/scope line on
  every AI surface; the non-athlete trainer's client type re-frames their dashboard; the
  parent weekly read is honest (real score band + an "N of 7 days logged" coverage line).
  A trust pass stopped calling deterministic logic "AI" and hides demo stats once live.

P7 · App Store readiness + hardening — VERIFIED (pure + local SQL)
  In-app account deletion + data export (Apple 5.1.1(v), GDPR/CCPA); migrations 0007
  (delete_account) + 0008 (guardian consent / COPPA) authored and locally verified on a
  throwaway Postgres (6 assertions; caught + fixed one real ON CONFLICT bug). Consent
  fails closed: no minor data syncs until a guardian is VERIFIED. Local-only activation
  for minors (D11). Draft Privacy Policy + Terms in docs/legal/. Body-image safeguard on
  weight entry; input validation; iPhone-only launch scope.

P8 · Full QA + regression — VERIFIED
  Keystone locks (Coach Plan fallbacks, body-image copy, meal loop, day rollover) plus a
  real flag-OFF fix: Feature 8's late-meal punctuality penalty was gated only at the UI,
  so with engines OFF a late meal silently dropped the score (84→82) against the ratified
  "engines off = score untouched" keystone. Fixed; two regression tests lock it.

THE CORE LOOP — finally made REAL (the board's #1 ask, two nights running):
  You can now edit a plate, hit Save, reopen it, and the edits are there — across reloads.
  The nutrition score sums REAL saved macros instead of a hardcoded constant, so a
  high-protein plate and an empty day produce genuinely different scores. The 57-point
  nutrition floor was removed and the scale rebased (an empty day ≈ 0, a full honest day
  ≈ 100) — this deliberately dropped the demo day from a propped-up C(75) to an honest
  D(68). The headline number was renamed "Development Score" (board's reservation on
  record: it measures adherence today, not athletic development — see Strategy #5).

BEYOND THE QUEUE (Day 3–4 product additions, all behind the engines switch, default OFF):
  The single engines master switch (EXPO_PUBLIC_ENGINES_ENABLED, default OFF — prove the
  core loop first); the Daily Game Plan / "finish-today" projection (the signature
  experience); the Coach Plan editor (one plan both engines read); Restaurant Coach (13
  chains + off-menu fallback); profile-aware scoring (athlete default byte-for-byte the
  shipped formula); the Product Constitution, Launch Checklist, and GO-LIVE-NOW runbook.

ACCOUNTS & SETTINGS LAYER (added after day4-end, flag-OFF):
  Sign-up (email+password) + sign-in + forgot-password + a Sign-in-with-Apple seam;
  coach/trainer/parent self-profile editor; athlete data-sharing controls (pause-all +
  remove a viewer, wired to the consent gate); the coach's per-athlete targets + scoring
  editor (coach_set_goals RPC); per-event overseer alert preferences; a persistent meal
  library (meals table + photo bucket) with client + coach history views. Migrations 0009
  (profiles.org_name) + 0010 (subscriptions seam) authored. An inert subscriptions/
  entitlement seam ("coach pays per athlete," every account reads "Free preview").

ENTERPRISE ARCHITECTURE + STRATEGY (final day, 2026-06-29 — the big-picture layer):
  - A 10-year enterprise architecture set (12 docs) + a founder decision memo. You
    RATIFIED all 7 keystone architectural decisions (see DECISIONS below).
  - Phase A "integrity seams" built + locally verified (1001 tests green): the
    org_memberships access-grant model, the canView/permission catalog (no formula-edit
    key), the inert workspace selector, and a generalized hasFeature() gate — all pure
    src/core seams + unpushed migrations 0011 (org_memberships) + 0012 (can_view cutover).
    Nothing user-visible changed; the wedge stays byte-identical.
  - The 6 founding/strategy documents + a plain-English sign-off. You RATIFIED all 6
    strategic (go-to-market) decisions.

FINAL HEALTH OF THE BUILD:
  Tests 559 → 1001. typecheck + full jest run + iOS export green on every commit (crew's
  logs). 12 migrations authored (0001–0003 already live; 0004–0012 locally verified, NOT
  applied to live). Guardrails held every commit: backend flag off, engines off, no
  supabase db push, src/core pure, one job = one commit, branch pushed after each.

================================================================================
ADVISORY BOARD — the FINAL verdict (and why it understates the code today)
================================================================================
VERDICT: NOT YET. Beta-readiness 3.07 / 10 (15 independent reviewers, scores 2–5).

READ THIS CAREFULLY — the verdict is stale by two nights:
  - Night 1 (Jun 26): no verdict — only the board charter was written.
  - Night 2 (Jun 27): the ONLY scored review. NOT YET, 3.07/10. It graded the Day-2 work,
    when the core loop still threw away every meal edit and four features were wired to no
    screen. Its headline charge: "breadth built on a loop that can't save a meal."
  - Night 3 (Jun 28): the board did NOT re-convene — no new score.
  - Night 4 (Jun 29): the board did NOT re-convene — no new score.

So the 3.07/10 predates the loop fix, the legal hardening, the demo-fakery cleanup, the
accounts layer, AND the entire architecture foundation. Measured against the board's own
Night-2 top-5 punch list, the crew has since closed most of it (below). A re-convened
board would almost certainly score materially higher — but in fairness, the score has
NOT been formally re-earned. Recommend convening the board once more before you commit to
a beta date, so the "go / no-go" rests on a current grade, not a two-night-old one.

THE DEFINITIVE PRE-BETA PUNCH LIST (board's Night-2 ranking) + where each stands NOW:
  1. Make the meal loop real end-to-end ............ DONE (edits persist; score reads
     real macros; the 57-pt floor removed).
  2. Wire or cut every dead feature ............... PARTLY — weekly report + engines now
     wired to screens; BUT the crew also ADDED new breadth (two engines, accounts layer,
     architecture). Net positive in code, but the "validate, don't widen" tension is real
     and ungraded. The engines are behind an OFF switch so you can run a minimal beta.
  3. Real consent + medical disclaimer ............ LARGELY DONE in code (verified-guardian
     sync gate, disclaimers everywhere, account deletion, draft policies). NEEDS your
     legal sign-off + a consent vendor to actually go live.
  4. Govern the minor↔adult messaging ............. DONE in code (relationship gate + RLS;
     "Active now" lie removed; thread persists). NEEDS a legal call before any minor
     messages (D10). Leave messaging off until then (it is).
  5. Kill demo strings on live screens ............ DONE (hardcoded dates, fake red dot,
     static weight chart, "Active now", padded streak all gone or made real).

STILL OPEN beyond the punch list (board's standing risks): the score still measures
adherence/nutrition/self-report, not athletic outcomes (rename ratified honestly —
Strategy #5); a real performance signal in the score is deferred (D3/D8); cold-start /
two-sided activation can't be measured until the flag flips for a real cohort; minors'
legal posture is built-but-unsigned. These are the things a real beta exists to test.

================================================================================
THE 4-NIGHT BETA-READINESS ARC
================================================================================
  Night 1 (Jun 26) — Backend keystone + Performance tracker shipped, flag-OFF.
                     Board: NO VERDICT (charter only). Tests 559 → 639.
  Night 2 (Jun 27) — Four feature areas built to the safe line (meal DB, reminders,
                     report+messaging, recovery). Board's FIRST + ONLY score:
                     NOT YET, 3.07/10 — "breadth on a loop that can't save a meal."
                     Tests 639 → 741.
  Night 3 (Jun 28) — The board's #1 ask CLOSED: the core loop is real. Heavy legal/safety
                     hardening + demo-fakery cleanup. Two new engines added (flagged OFF).
                     Board did NOT re-convene. Tests 741 → 836+.
  Night 4 (Jun 29) — Sprint closed (FOUNDER-RETURN written at 894 tests, day4-end), THEN
                     the accounts/settings layer + the enterprise-architecture foundation
                     (Phase A) + strategy ratification landed. Board did NOT re-convene.
                     Tests → 1001.

  Net: the engineering arc went steadily UP and closed the board's whole punch list; the
  graded readiness number is frozen at the Night-2 floor only because no one re-scored it.

================================================================================
ALL DECISIONS WAITING ON YOU
================================================================================
ALREADY RATIFIED THIS SESSION (recorded in docs/FOUNDER-DECISIONS.md):
  - KEYSTONE: engines OFF for the first beta (prove the loop first).
  - D1 apply migrations as-written at go-live · D2 email confirmation ON · D3 keep PRs out
    of the daily score · D4 PR date-picker + sync NOT yet · D5 keep the 55-food list ·
    D6 approve on-device reminders (device wiring remains) · D7 messaging delivery NOT yet ·
    D8 wearable recovery NOT in the score for beta · D9 start speccing parent-sync +
    non-athlete scoring · D10 minor-messaging relationship-gated (legal review still
    required) · D11 local-only activation for minors YES · D12 the two go-live RPCs
    authored + locally verified.
  - ALL 7 ENTERPRISE-ARCHITECTURE KEYSTONE DECISIONS (2026-06-29): athletes own their data
    forever / orgs own access only; everything is an Organization (trainer/parent/family
    are just orgs); unlimited orgs per athlete; bounded scoring weights (no per-coach
    formula); org-keyed entitlements / pricing-as-data; athlete picks ONE primary plan;
    DB-enforced audit immutability; consent server-supreme + per-org, verifier ≠ viewer.
  - ALL 6 STRATEGIC DECISIONS (2026-06-29): gyms first (schools next); gym launch kept
    simple; pricing tweaks (add a solo-trainer ~$59–79 tier + a premium ~$24.99 tier);
    the morning game-plan + finish-today projection is the signature experience;
    name the score honestly today ("Development Score" is the marketing destination);
    start the human launch chain THIS WEEK.

STILL OPEN / AWAITING YOU (built to the safe line; nothing is blocked in code):
  - The exact pricing catalog: final prices + billing frequency + trial length (a data
    seed, no code change — it's the one input the queued checkout build still needs).
  - An RD / sports-science sign-off on the per-component score-weight rails before the
    weight-set table ships (architecture D3).
  - The deeper halves of D4 (a performance_entries table), D5 (license USDA / a barcode
    source), D6 (the reschedule trigger + notification library), D7 (delivery + the minors
    policy first), D8 (fold real recovery into the score), D9 (build the "general" scoring
    profile after RD sign-off), D10 (the legal review itself).

================================================================================
✅ NEEDS YOU — THE EXACT GO-LIVE CHECKLIST (work top-down; later items depend on earlier)
================================================================================
PHASE 0 — legal + vendors (these GATE everything; start this week):
  [ ] Counsel review + host the legal docs (docs/legal/ Privacy + Terms); COPPA/FERPA
      sign-off for minors' health data; publish at public URLs the app links to.
  [ ] Pick a parental-verification (VPC) vendor — the thing that flips a guardian
      pending → verified. Until it exists, every minor stays local-only and no coach sees
      their data.
  [ ] Pick an email sender — for the guardian approval link AND sign-up confirmation
      (you chose confirmation ON).
  [ ] Bless minor-messaging with counsel before any under-18 user messages. Until then
      leave messaging off (it is).

PHASE 1 — turn the backend on (your hands on the keyboard):
  [ ] Apply migrations to the live project, one at a time, in order: 0004, 0005, 0007,
      0008, 0009, 0010 — then the org-membership keystone 0011 then 0012. 0011 is purely
      additive; 0012 backfills memberships (teams only) and swaps can_view's body — re-run
      the equivalence check on a throwaway DB with a copy of real data before trusting 0012
      on live. (All written + locally verified; apply as-written.)
  [ ] Flip email confirmation ON in the Supabase dashboard (config file already set).
  [ ] Set the Supabase URL + anon key + EXPO_PUBLIC_BACKEND_LIVE=true (env only, rebuild).
      This is what turns the backend on — and it doubles as your instant kill-switch.
      Decide EXPO_PUBLIC_ENGINES_ENABLED (recommend OFF for the first cohort).
  [ ] Wire the guardian-consent verify endpoint (the DB records the request + token; you
      still need the small endpoint the parent's email link hits to mark them verified).
  [ ] Wire the overseer alert pipeline to whatever actually pushes notifications.
  [ ] Manually run the coach-invites-athlete flow end-to-end on the LIVE project, then
      verify RLS cross-team isolation (coach A can't read team B; a minor is invisible
      until a guardian is verified). Built + locally round-tripped; NOT verified on live.

PHASE 2 — the phone + the App Store (needs a real device):
  [ ] Notifications: expo install expo-notifications, grant permission, finish the wiring
      in src/lib/notify, set isNotifyAvailable=true, test firing on-device.
  [ ] Camera + AI: test photo capture + meal analysis on a real device (+ a model key).
  [ ] Sign in with Apple (Apple REQUIRES it since you offer email login): install the
      native module, enable the capability/Services ID — the seam lights up automatically.
  [ ] Barcode + HealthKit/Health Connect: optional device seams (D5/D8) when you want them.
  [ ] Apple: enrollment + real bundle id, age rating, screenshots, confirm in-app account
      deletion is reachable, submit for review.

PHASE 3 — run the actual beta (the real unlock):
  [ ] Recruit 3–5 coaches (or a gym, per the ratified strategy) + their athletes.
  [ ] Run docs/BETA-TEST-PLAN.md; watch the ONE metric: activated coach→athlete edges
      that log ≥3 of the first 7 days.

SUBSCRIPTIONS (deferred to post-beta — the seam is built, not the billing): apply 0010,
set up Stripe per-seat + a billing-portal link + a webhook, add a "Manage plan" CTA,
enforce seats. Then set the catalog prices (data, not code).

================================================================================
HOW TO REVIEW + MERGE crew/4day-sprint
================================================================================
  1. The branch is crew/4day-sprint — 135 commits ahead of master, NOT merged. It is the
     final state (HEAD 6d8bf72). Note: checkpoint/day4-end marks the SPRINT CLOSE only
     (894 tests); the branch then ran 28 more commits (accounts + architecture) to its
     current 1001-test HEAD — so merge the branch HEAD, not the day4-end checkpoint.
  2. Suggested review order: read docs/FOUNDER-RETURN-2026-06-28.md (the per-feature
     VERIFIED vs BUILT map), then docs/FOUNDER-DECISIONS.md (every judgment call),
     docs/architecture/DECISION-MEMO.md + PHASE-A-LOG.md (the foundation), and
     docs/LAUNCH-CHECKLIST.md (the single source of truth for go-live).
  3. Sanity-check the gates yourself: npm install, then npm run verify (typecheck + jest +
     iOS export) should be green at ~1001 tests. Skim git log --oneline to confirm one
     job = one commit.
  4. Confirm safety before merge: grep the diff for EXPO_PUBLIC_BACKEND_LIVE (never set
     true) and confirm no supabase db push touched the live project — migrations 0004–0012
     are authored files only.
  5. Merge crew/4day-sprint → master when satisfied (a standard PR/merge; the crew did not
     merge by guardrail). Recommend convening the advisory board for a fresh verdict first,
     since 3.07/10 is two nights stale.
  6. Housekeeping: the git bridge 403'd every annotated-tag push all sprint, so each day's
     tag is preserved as a checkpoint/dayN-end branch. After merging you can materialize the
     real tags from a normal client and delete the checkpoint branches.

================================================================================
✅ SAFETY ASSURANCE (one line)
================================================================================
Nothing went live: EXPO_PUBLIC_BACKEND_LIVE was never enabled, the engines stayed OFF, no
migration was pushed to the live project (no supabase db push), no real/live data was
touched, no external send fired, and nothing was merged to master — all work is on
crew/4day-sprint and is safe to review.

— Compiled by the daily-digest routine, review-only. No app code, flags, data, or live DB
were modified; only this report file was added to the repo.
