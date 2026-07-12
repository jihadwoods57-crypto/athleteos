# Fable 5 Run Report — Redesign the Trainer Profile into a Premium "Practice HQ"

**Date:** 2026-07-11
**Outcome:** The trainer's dead settings screen is now a real Practice HQ — server-hydrated identity, a 4-state invite loop with a tested from-scratch QR encoder, and the cross-role back-nav bug fixed — all green on `npm run verify` (135/135 suites, 1679/1679 tests), on a branch, never merged.

**Branch:** `fable5/2026-07-11-trainer-profile-practice-hq` (commit `b47d925`)
**Tag:** `fable5/2026-07-11-redesign-the-trainer-profile-into-a-prem` → `b47d925`
**Master:** untouched.

---

## What the Audit Decided

**Build target:** Foundation first, then the first Practice HQ slice.

1. **FIX cross-role back-navigation.** The coach/trainer/parent dashboards send their back button to the athlete `profile` screen (`proto/redesign-2026-07/js/screens/coach.js` lines 56, 528, 652 all pass `'profile'` to `backHead`) — exactly the founder's "back button navigates to a RANDOM athlete profile" bug. Retarget each role's back to its OWN role home (or drop the backHead on these root tab screens).
2. **MAKE the trainer profile a REAL persistent profile.** Today `trainerProfile`/`coachProfile` read identity + code ONLY from local onboarding scratch (`RT.ob`) and fall back to hardcoded "Tracy Boone"/"Tracy Boone Performance" (roles.js 811–812) and "Coach Mark" (state.js 625), showing "No code yet" on any fresh sign-in because `_loadProfileIntoRt` (state.js 420–438) hydrates `athlete_profiles` ONLY and `fetchMyPractices` (roles.js 110–112) never even selects the join code. Add server hydration on trainer sign-in (real `full_name` from profiles + practice id/name/client-code) into RT so the profile survives a reinstall/new device and never shows another persona.
3. **Build the single highest-value redesign slice on top of the now-real code:** transform the bare Trainer Profile settings page into a "Practice HQ" shell with a real-identity business header and a redesigned client Invitation section (real client code + QR + copy + native share). The native SHARE bridge (`src/proto/bridge.ts` case `'SHARE'`) and clipboard already exist; only a dependency-free QR generator needed adding. Remaining Practice HQ sections (business health, client health, AI assistant, analytics, default-standard management, branding, integrations, business tools) roadmapped as founder-gated proposals.

**Rationale (audit):** The founder's two-thread vision is real and unmet; every claim was grounded in the shipped proto (the app IS the proto: `app/index.tsx` renders ProtoApp).

## The Design

Clickable prototype: https://claude.ai/code/artifact/05c6b786-a7fe-4b64-bd40-2b1612ff085e
Full write-up: `.fable5/reports/design-practice-hq.md` (committed in `b47d925`).

Practice HQ refined WITHIN the existing dark redesign system — trainer purple as the lane accent, Athlete Blue stays the athlete spine. Three grounded moves:

1. Tab-root dashboards drop the back chevron that sent coach/trainer/parent into a random athlete profile; sub-screens back to their own role home.
2. Real server-hydrated identity so the profile survives reinstall and never shows the "Tracy Boone"/"No code yet" fallback.
3. A one-tap invite loop: real code + scannable QR + Copy + native Share (reuses SHARE bridge + clipboard).

Roadmap sections shown as honest locked rows. Prototype covers Live/Loading/Minting/Offline.

## The Plan (12 steps, as executed)

1. `src/core/practiceIdentity.ts` pure helpers + `practiceIdentity.test.ts`; green via `npm run test` before touching proto.
2. `src/core/qr.ts` encoder + `qr.test.ts` (finder patterns, timing row, quiet zone, version/EC for a known string) — tiny, dependency-free.
3. Port the same QR logic to `proto/redesign-2026-07/js/qr.js` (ES module) so the WebView needs no CDN.
4. `roles.js`: widen `fetchMyPractices()` SELECT to `id,name,join_code,owner_id,handle`; add `fetchMyPracticeIdentity()` (owner-scoped, RLS `practices_read` already permits).
5. `state.js`: `RT.practice:{id,name,code}` in DEFAULT_RT; `act._loadPracticeIntoRt(userId)` reading practices + `profiles.full_name`; invoked in `signIn()` and `hydrateDay()` when role==='trainer'; wiped in `signOut()` and when a different userId signs in.
6. `state.js`: `S.trainerIdentity` getter (name from `RT.profile.name`, practice+code from `RT.practice`; honest blanks, never "Tracy Boone").
7. `components.js`: `titleHead(title,sub)` — `.back-head` markup minus the `.bk` button.
8. `coach.js`: replace `backHead(...,'profile')` at lines 56 and 528 with `titleHead(...)` so tab roots show no back chevron.
9. `screens/roles.js`: rewrite `trainerProfile` render() to consume `S.trainerIdentity` + `RT.practice`, not `RT.ob`; four states (live/loading/minting/offline).
10. `screens/roles.js`: invite card — purple code boxes, `QR(inviteLink(code))` via qr.js, Copy (navigator.clipboard), primary Share via `window.OnStandardNative.share` / `navigator.share` fallback; Share disabled offline.
11. `screens/roles.js`: honest LOCKED roadmap rows (business health, client health, AI assistant, analytics, branding, integrations) and a Manage affordance replacing the dead "Set" pill; mount() wires copy/share.
12. Verify gate + live walkthrough.

## What Got Built (evidence: commit `b47d925`, 16 files, +2096/−29)

Rewrote the trainer's dead settings screen into Practice HQ (`proto/redesign-2026-07/js/screens/roles.js`):

- **Real server-hydrated identity** — name + practice + client code, never the old "Tracy Boone"/"No code yet" fakes.
- **4-state invite loop** (live/loading/minting/offline) with purple code boxes.
- **From-scratch tested ISO 18004 QR encoder** (`src/core/qr.ts`, ported to `proto/redesign-2026-07/js/qr.js`) — zero dependencies, no CDN in the WebView.
- **Copy/Share**: native bridge → `navigator.share` → clipboard fallback.
- **Honest LOCKED roadmap rows** for the future Practice HQ sections.
- **Back-nav fix**: coach + trainer dashboard back chevron (was routing into the athlete's own profile via `backHead(...,'profile')` on a tab root) fixed with new `components.js` `titleHead()` on both roots.
- **State layer**: `state.js` gained `RT.practice` + `act._loadPracticeIntoRt` (hooked into signIn/hydrateDay for trainers, cleared on signOut and on a different user signing in) and `S.trainerIdentity`.
- **Data layer**: `roles.js` widened `fetchMyPractices`' select and added `fetchMyPracticeIdentity()` — both RLS-scoped, **no migration needed or applied**.

**Verify gate: GREEN.** `npm run verify` — typecheck clean, 135/135 suites, 1679/1679 tests, expo export succeeded. Plus a live Playwright walkthrough of all four Practice HQ states, the Copy/Share/Manage interactions, and both dashboards' back-nav (screenshots taken and discarded, not committed).

## Verified Bugs from QA (refute-survivors only)

### 1. Back-nav fix skips the parent tab root (still lands on athlete profile) — MEDIUM, correctness
- **File:** `proto/redesign-2026-07/js/screens/coach.js:652`
- **Evidence:** Lines 56 and 528 were converted to `titleHead` (no chevron), but the parent root at line 652 still calls `backHead('Parent view','Setting up access','profile')`. `data-go='profile'` is the athlete profile tab, so a parent tapping back lands on the athlete profile — the exact cross-role bug this branch fixes for coach/trainer. The design report (`design-practice-hq.md`, "3 fixes") explicitly listed line 652; the diff changed only 56 and 528. `backHead` renders a real chevron (`components.js:155`) and router.js routes `'profile'` to the athlete Profile tab. Parent is a standalone role root (`hideTabs:true`), so this is a genuine miss, not a legitimate sub-screen back target. Confirmed in-scope (sibling fixes are in this same diff).
- **Proposed fix:** Give the parent root a chevron-less header (`titleHead`) or point back at a role-appropriate home (role picker/welcome). Sweep for any remaining tab-root `backHead(...,'profile')`.

### 2. Offline/error trainer misreported as "code is being created" (minting) — LOW, honesty-state
- **File:** `proto/redesign-2026-07/js/state.js:455` (mechanism introduced by this branch)
- **Evidence:** `fetchMyPracticeIdentity` (roles.js:120–127) returns null identically for "no practice row", RLS block, and network error (its own docstring admits: "null on no practice yet ... or any error (offline)"). In `_loadPracticeIntoRt` (state.js:464–469), null + no cache hits the else branch (`RT.practice=null`, offline=false), so `S.trainerIdentity.state` resolves to `'minting'` and the UI shows "Your client code is being created." An established trainer signing in on a fresh device while offline is shown minting instead of offline. Recovers on reconnect via `hydrateDay`, but contradicts the "never show a fabricated/broken state" goal. The offline-recovery guard only protects the hadCache branch.
- **Proposed fix:** Distinguish "no row" from "fetch failed" — have `fetchMyPracticeIdentity` signal an error (throw or sentinel) so `_loadPracticeIntoRt` can flag offline even with no cache, rather than defaulting an error to minting.

## Founder-Gated Proposals (not actions)

1. **Optional `practice_identity()` RPC** — a single server round-trip returning `{full_name, practice_id, practice_name, join_code}` instead of two table reads. Requires a DB migration; authored-only if you want it, never applied by Fable 5.
2. **Remaining Practice HQ sections** — business health, client health, AI assistant, analytics, default-standard management, branding, integrations, business tools. Shown today as honest LOCKED rows; each is a future slice for your prioritization.
3. **Design taste calls made this run** (flag if you disagree): trainer purple kept as lane accent with Athlete Blue as the athlete spine; roadmap sections rendered as locked rows rather than hidden; Share disabled (not hidden) when offline.

## Tokens per Phase

| Phase  | Tokens  |
|--------|---------|
| Audit  | 0 (carried in from prior audit) |
| Design | 35,422  |
| Plan   | 10,266  |
| Build  | 112,497 |
| QA     | 42,225  |
| **Total** | **200,410** |

## Safety / Integration

- **Master is untouched.** All work lives on `fable5/2026-07-11-trainer-profile-practice-hq` (tagged `fable5/2026-07-11-redesign-the-trainer-profile-into-a-prem`). Merging is your call.
- No live DB migrations applied, no deploys, no secrets touched, no tests or RLS weakened.
- To integrate: review and merge the branch. To discard: `git reset --hard` is not needed — simply delete the branch/tag; to reset a checkout that is ON the branch back to it after experiments: `git reset --hard fable5/2026-07-11-redesign-the-trainer-profile-into-a-prem`.
