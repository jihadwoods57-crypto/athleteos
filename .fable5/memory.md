# Fable 5 — Project Memory (OnStandard / athleteos)

## Product Vision
OnStandard is honest athlete nutrition + performance: real habit formation over vanity metrics; coaches are the
buyers, parents pay, athletes are taught (not just scored).

## Features shipped
- 2026-07-11 — **Practice HQ v1** (branch `fable5/2026-07-11-trainer-profile-practice-hq`, commit `b47d925`, tag `fable5/2026-07-11-redesign-the-trainer-profile-into-a-prem`; NOT merged): trainer profile rebuilt from dead settings page into Practice HQ — server-hydrated real identity (`RT.practice` + `act._loadPracticeIntoRt` + `S.trainerIdentity`), 4-state invite loop (live/loading/minting/offline), dependency-free tested ISO 18004 QR encoder (`src/core/qr.ts`, ported to `proto/redesign-2026-07/js/qr.js`), Copy/Share via native bridge → navigator.share → clipboard, honest LOCKED roadmap rows, and cross-role back-nav fix on coach+trainer tab roots via new `titleHead()`. Verify gate GREEN (135/135 suites, 1679/1679 tests, expo export OK).

## Decisions (with rationale)
- Fable 5 never merges to master; the founder integrates. Rationale: LLM output is reviewed before it ships.
- 2026-07-11 — Trainer identity is server-hydrated into RT (never `RT.ob` scratch, never hardcoded personas like "Tracy Boone"/"Coach Mark"). Rationale: profile must survive reinstall/new device and never show another persona. SETTLED — do not re-litigate.
- 2026-07-11 — Tab-root role dashboards get chevron-less headers (`titleHead`), not `backHead(...,'profile')`. Rationale: back on a root routed cross-role into the athlete profile. SETTLED.
- 2026-07-11 — QR generation is a from-scratch, dependency-free encoder (no CDN in the WebView, no npm dep). SETTLED.
- 2026-07-11 — Practice HQ visual lane: trainer purple as accent inside the existing dark redesign system; Athlete Blue remains the athlete spine. SETTLED (design taste, founder may override).

## Tech Debt
- `fetchMyPracticeIdentity()` (proto roles.js) collapses no-row / RLS-block / network-error into one `null` — error signal is swallowed (see Open Bugs #2).
- Trainer identity needs two table reads (practices + profiles); an optional `practice_identity()` RPC would make it one round-trip — FOUNDER-GATED (requires migration; author-only, never apply).
- Practice HQ roadmap sections (business health, client health, AI assistant, analytics, default-standard mgmt, branding, integrations, business tools) exist only as LOCKED rows.

## Open Bugs
- 2026-07-11 QA (MEDIUM, correctness): parent tab root still calls `backHead('Parent view','Setting up access','profile')` at `proto/redesign-2026-07/js/screens/coach.js:652` — parent tapping back lands on the athlete profile. Coach (56) and trainer (528) roots were fixed; parent was missed. Fix: `titleHead` or role-appropriate back target; sweep remaining tab-root `backHead(...,'profile')`.
- 2026-07-11 QA (LOW, honesty-state): fresh-device offline trainer shown "Your client code is being created" (minting) instead of offline, because `fetchMyPracticeIdentity` returns null for both no-row and fetch-error and `_loadPracticeIntoRt` (state.js ~455–469) defaults null+no-cache to minting. Fix: signal fetch errors distinctly (throw/sentinel) so no-cache offline is flagged as offline.

## Roadmap
- Next sprint, in order: (1) fix the two open QA bugs above (parent back-nav is the same founder-reported bug class this run fixed for coach/trainer); (2) first unlocked Practice HQ section — client health list is the highest-value candidate (real client rows already reachable via widened `fetchMyPractices`); (3) founder decision on the `practice_identity()` RPC proposal.
- Coach profile likely shares the stale-scratch identity pattern trainer had (roles.js `coachProfile` read `RT.ob` too) — audit it before building coach-side HQ.

## Launch Checklist
- See docs/LAUNCH-CHECKLIST.md
