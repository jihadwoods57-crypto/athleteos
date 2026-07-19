# Coach Experience — Impeccable Audit

**Product:** OnStandard (athlete accountability platform, coach oversight surface)
**Register:** Product UI (design serves the task)
**Scope:** The complete coach experience from the first Home screen after onboarding through athlete-code sharing.
**Method:** Read of the shipped UI code (the proto WebView at `proto/redesign-2026-07/`, which is the real coach UI, not `src/screens`), plus the current rendered states in `qc/`.
**Date:** 2026-07-19
**Verdict at a glance:** Strong, cohesive, honestly-engineered product with a premium visual system. The gaps are in first-run activation, a few "middle page" detours, and consistent application of its own accessibility rules — not in the core.

> **Remediation status (2026-07-19):** The first-run activation batch (**P1-1, P1-2, P1-3**) is **FIXED and verified** in a headless browser. See the [Remediation Log](#remediation-log). Findings P1-4 and all P2/P3 items remain open.

---

## 0. Note on the requested screenshot path

The task pointed at `docs/coach-review/screenshots/`. **That directory does not exist in the repo** (there is a `docs/audit` singular, no `docs/coach-review`). I did not invent screenshot observations. Instead I grounded the visual findings in the current rendered states that *do* exist:

- `qc/c-empty.png`, `qc/c-roster.png`, `qc/c-editor.png` — current "Command Center" design (used below).
- `.fable5/shots/persona-sim/marcus-*coach*.png` and `_media/screenshots/*coach*.png` — **stale**. They show the pre-redesign coach view (old `Team / Plan / Copilot / Profile` nav and KPI cards). I did not use them for findings except to confirm they are outdated.

If you have a fresh screenshot set, drop it in `docs/coach-review/screenshots/` and I will re-run against it. The code is authoritative and is what this audit is built on.

---

## 1. Audit Health Score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2 / 4 | Interactive targets below the 44px floor are pervasive (filter/section chips 34px, action buttons 36px, inline buttons 30–32px) even though the standards editor proves the team knows the rule. |
| 2 | Performance | 3 / 4 | Excellent discipline (in-place list patching, refetch/repaint guards, parallel photo signing, transform/opacity animation, reduced-motion). Minor: large blur radii on the pulse aurora. |
| 3 | Theming | 3 / 4 | Fully tokenized, light/dark via tokens. A handful of raw `rgba()`/`#FF9B9B` literals recur inline instead of a token. |
| 4 | Responsive / safe area | 3 / 4 | Framework reserves 128px under the tab bar and honors safe-area insets. One real risk: the roster's sticky bulk-action bar likely sits under the tab bar. |
| 5 | Anti-patterns | 3 / 4 | Distinctive, not "AI slop." Two banned side-stripe accents; one gradient-clipped number (the founder-ratified score signature). |
| **Total** | | **14 / 20** | **Good — address the weak dimensions (a11y + a couple of nav detours).** |

---

## 2. Anti-Patterns Verdict

**Does this look AI-generated? No.** It reads as an intentional, in-house design system ("Command Center," `.co-*` namespace, blue→teal score signature, honest empty states). It passes the product slop test: a coach fluent in good tools would trust it.

Specific tells, and the honest ruling on each:

- **Side-stripe accents (banned): present, 2 places.** `.co-pri::before` (3px colored left stripe on priority cards, `coach.css:123`) and `.std-preview::before` (3px gradient left stripe, `coach.css:355`). On the priority card the tier is *already* stated by a text chip and the score color, so the stripe is redundant decoration. This one should go.
- **Gradient text (banned): present, 1 place, and it is intentional.** The big team "Group score" number uses `background-clip:text` with the blue→teal gradient (`coach.css:47-52`). This is the founder-ratified score signature (the sibling of the athlete score ring), not decorative slop. Keep it, but harden it (see [P2] Gradient score contrast).
- **Hero-metric template / identical card grids / glassmorphism-by-default: not present.** The stat tiles are restrained and earned.

---

## 3. Executive Summary

- **Audit Health Score: 14 / 20 (Good).**
- **Issues found:** P0 = 0 · P1 = 4 · P2 = 12 · P3 = 8.
- **The experience is genuinely premium and honest.** Every screen has real loading/offline/empty states, refuses to fabricate data, and keeps typed text on failed writes. Scroll stability and back/scroll restoration are deliberately engineered. This is a high floor.
- **The weak spot is the first day.** The "Finish setting up your team" checklist never checks off, pre-checks its first item, and disappears the moment one athlete joins — so the activation story quietly falls apart. Two of its five steps route to the wrong place ("Add another staff member" → a dense settings page; "Create position groups" → an empty roster that can't create a group).
- **A few marquee entry points open previews, not features** (AI in your voice, Team dietary sheet), which is fine as roadmap but reads as a dead end mid-evaluation.
- **Accessibility is the measurable gap:** sub-44px touch targets throughout, applied inconsistently with the standards editor that correctly uses 44px.

### Top 5 to fix first

1. **[P1] The setup checklist doesn't track completion and vanishes after the first athlete joins.** (`coach-home.js`)
2. **[P1] "Create position groups" dead-ends on an empty roster and is misnamed.** (`coach-home.js` → `coach-roster.js`)
3. **[P1] "Add another staff member" dumps the coach on the full Coach Profile page instead of the staff action.** (`coach-home.js` → `roles.js:coachProfile`)
4. **[P1] The roster bulk-action bar (sticky `bottom:8px`) is likely occluded by the 96px tab bar.** (`coach-roster.js` / `app.css:.tabbar`)
5. **[P2] Sub-44px touch targets are pervasive; unify to the a11y floor the standards editor already uses.** (`coach.css`)

### Recommended next steps

Fix the four P1s (all are small, targeted changes), then run an accessibility/touch-target pass and a copy pass. None of this is an overhaul; it is polish on a strong base.

---

## 4. Per-Screen Scorecard

| Screen | Route / file | Verdict | Headline issue |
|---|---|---|---|
| First Home after onboarding (empty dashboard) | `coach-home.js:emptyTeamDashboard` | Good, with hierarchy issues | Next-actions buried below celebratory chrome (F7); score tile stray bar (F13) |
| Finish Setting Up Your Team checklist | `coach-home.js:setupChecklist` | **Needs work** | Never completes, pre-checks item 1, disappears after first athlete (F6) |
| Review Your Standard → Plan | `coach.js:coachPlan` | Good | Label/destination mismatch (F22); dense (F24) |
| Team Standard editor | `coach.js:coachPlanSet` | **Excellent** | Side-stripe on preview card (F25); otherwise a model screen |
| Timing & late-credit | inline module in editor | **Excellent** | Correctly inline, not a middle page. No issue. |
| Notification Rules | `settings.js:coachNotifSettings` | Good, functional | Confusing title/subtitle (F20) |
| AI / Coach Voice | `features.js:coachVoice` | Preview-only | Presents as a feature; no control (F8) |
| Add Another Staff Member | via `roles.js:coachProfile` | **Needs work** | No direct destination; buried in a dense page (F1, F23) |
| Coach Profile | `roles.js:coachProfile` | Overloaded but capable | No nav home / no active tab (F4); overloaded (F23) |
| Create Position Groups | via `coach-roster.js` | **Needs work** | Dead-ends on empty roster; misnamed (F2, F21) |
| Empty Roster | `coach-roster.js` | Good | Points to profile for the code that's also on Home (F12) |
| Athlete-code creation & sharing | `coach-home.js` + `coach-profile` | **Strong** | Code + QR + Copy/Share/Customize/Regenerate all present and honest |

---

## 5. Detailed Findings by Severity

Severities: **P0 Blocking** · **P1 Major (fix before release)** · **P2 Minor** · **P3 Polish**.

### P1 — Major

---

**[P1-1] ✅ FIXED — Setup checklist never tracks completion, pre-checks its first step, and disappears after the first athlete joins**
- **Screen:** First Home / "Finish setting up your team" checklist
- **Current behavior:** Four of the five steps are hardcoded `done:false` and never check off, even after the coach edits standards, sets notifications, invites staff, or makes a group. The one exception, "Share your athlete code," shows `done:true` the moment a code *exists* (which is always, once the team mints) — so it reads as complete before the coach has shared anything. The whole checklist lives inside `emptyTeamDashboard`, rendered only while `roster.rows.length === 0`; as soon as one athlete joins, the checklist is gone — even though setup is usually still incomplete.
- **Expected behavior:** Each step reflects real completion (standards touched, notification prefs set, staff invited, group created). Step 1 reflects an actual share action, or is honestly framed as "your code is ready." The checklist persists (collapsed is fine) until the steps are genuinely done, independent of whether athletes have joined.
- **Recommended fix:** Derive per-step `done` from real signals (a saved `requirement_set`, touched `coachNotifPrefs`, an open/closed staff invite, an existing group). Keep a compact "Finish setup" surface on the populated dashboard until complete.
- **Related:** `coach-home.js:47-63` (`setupChecklist`), `:79-94` (`emptyTeamDashboard`), `:210-214` (empty gate).

---

**[P1-2] ✅ FIXED — "Create position groups" routes to a roster that cannot create a group when empty, and the name is wrong**
- **Screen:** Setup checklist → Roster
- **Current behavior:** The checklist item shows only on the *empty* dashboard, then links to `coach-roster`. With no athletes the roster renders "No athletes yet" and offers no group creation — group creation requires selecting athletes first (the "Create with 0" button is disabled). Separately, "position groups" is a misnomer: the roster creates *custom groups*; position "rooms" are auto-derived from athlete positions and cannot be hand-created at all.
- **Expected behavior:** Do not promise an action that is impossible in the current state. Either gate the step until athletes exist, or route to a real creation flow. Rename to the actual concept ("Organize your roster into groups").
- **Recommended fix:** Hide/disable the step until `roster.rows.length > 0`; fix the label; if kept, land on a functional creator (or open the group sheet directly).
- **Related:** `coach-home.js:53`, `coach-roster.js:70-112` (`groupSheet` / `wireGroupSheet`).

---

**[P1-3] ✅ FIXED — "Add another staff member" opens the entire Coach Profile page instead of the staff action (unnecessary middle page)**
- **Screen:** Setup checklist → Coach Profile
- **Current behavior:** The step links to `coach-profile`, a long screen holding the identity card, handle editor, team code (copy/customize/regenerate), the full staff list, staff-invite chips, and seven team-settings rows. The staff-invite affordance sits several sections down. The `+` Create menu compounds this: **both** "Add an athlete" **and** "Invite staff" also route to `coach-profile`.
- **Expected behavior:** A first-run "add staff" task should land on the staff-invite action, focused and ready.
- **Recommended fix:** Extract a dedicated `coach-staff` screen (this also relieves the Coach Profile overload in P2-9), or at minimum deep-link into the staff section and scroll/auto-open it on arrival.
- **Related:** `coach-home.js:52`, `coach-create.js:18-19`, `roles.js:1068-1117` (staff block in `coachProfile`).

---

**[P1-4] Roster multi-select bulk-action bar (sticky `bottom:8px`) is likely occluded by the 96px bottom tab bar**
- **Screen:** Roster (multi-select mode)
- **Current behavior:** When the coach selects athletes, the Nudge / Assign / → Group / Excuse bar renders `position:sticky; bottom:8px` inside the viewport. The viewport's visible bottom is the screen edge, and `.tabbar` is `position:absolute; bottom:0; height:96px; z-index:50` over it, with no z-index on the bulk bar. So the primary bulk actions sit 8–60px from the bottom, directly under the tab bar, which paints over them.
- **Expected behavior:** The bulk-action bar clears the tab bar and safe-area inset.
- **Recommended fix:** Raise the sticky offset to clear the bar, e.g. `bottom: calc(96px + env(safe-area-inset-bottom) + 8px)`, or render the bar above the tab bar in the layout. **Verify on a device first** — this is a code-level inference, not confirmed from a render (the bar only appears mid-selection).
- **Related:** `coach-roster.js:205-211`, `app.css:346-351` (`.tabbar`), `app.css:73-80` (`.viewport`).

---

### P2 — Minor

---

**[P2-1] Coach Profile has no persistent nav home and shows no active tab**
- **Screen:** Coach Profile
- **Current behavior:** `coachProfile` declares `tab:'profile'`, but the coach bottom nav is Home / Roster / Create / Inbox / Insights — there is no Profile tab. `ROOT_TAB['coach-profile'] = 'profile'` is not a coach tab, so while on Coach Profile *no* bottom tab is lit. The only persistent entry is the 34px avatar in the Home/Roster header. Team code, staff, sign-out, notifications, and appearance all live behind that one small control.
- **Expected behavior:** A discoverable, stable entry to the account/team hub, and a coherent active-state.
- **Recommended fix:** Keep the avatar as the entry but ensure it reads as "account," and resolve the tab-highlight (either light nothing intentionally or reflect the origin tab). Consider whether Profile deserves a nav slot.
- **Related:** `router.js:82-88` (`ROOT_TAB`), `components.js:207-213` (`avatarHead`).

---

**[P2-2] Navigating to Coach Profile resets the tab stack, so Back loses the scroll origin**
- **Screen:** Coach Profile (reached from checklist / `+` menu)
- **Current behavior:** Because `coach-profile` is a `ROOT_TAB`, `navigateTo()` calls `resetTab` instead of `pushOrigin`. Back then falls to the `backHead` fallback (`coach-home` at scroll 0) rather than the exact origin. The app's back/scroll restoration is otherwise excellent, so this is a visible inconsistency.
- **Expected behavior:** Back returns to the exact screen and scroll the coach came from.
- **Recommended fix:** Treat coach-profile as a detail route (not a tab root) for origin tracking, or push the origin before the reset.
- **Related:** `router.js:112-125` (`navigateTo`).

---

**[P2-3] "AI in your voice" opens a static preview with no control**
- **Screen:** AI / Coach Voice (from Plan and Coach Profile)
- **Current behavior:** Shows "Speak as [name]" with a "Preview" pill and four hardcoded phrases labeled "Example." There is no on/off, nothing to configure, nothing to save. `mount()` calls `wireToggles` but the screen has no toggle groups, so it is entirely inert.
- **Expected behavior:** Either a working control, or clearer roadmap framing (the small "Preview" pill is easy to miss on a screen that otherwise looks live).
- **Recommended fix:** Ship a real enable/sample control, or label it as a preview the way `teamDiet` honestly does.
- **Related:** `features.js:308-342` (`coachVoice`).

---

**[P2-4] "Team dietary sheet" / "Team diet" and "Wellness Flags" are preview screens presented as live tools**
- **Screen:** Team Diet (from Plan + `+` menu), Wellness Flags (`safety`)
- **Current behavior:** `teamDiet` is an empty "Declarations are coming" state; `safety` is explicitly a design preview. The body copy is honest, but the entry points look like shipping features.
- **Expected behavior:** Roadmap surfaces are marked distinctly (or gated) so a coach evaluating the product does not tap into a dead end.
- **Recommended fix:** Add a consistent "Coming soon" affordance to preview entry points, or hide them behind a flag until real.
- **Related:** `features.js:226-240` (`teamDiet`), `:345-382` (`safety`).

---

**[P2-5] Sub-44px touch targets are pervasive and inconsistent with the standards editor**
- **Screen:** Roster, Inbox, Athlete profile, priority cards, Coach Profile, Home
- **Current behavior:** `.co-seg .co-chip` = 34px (roster filters, inbox categories, athlete-profile section chips), `.co-abtn` = 36px (priority actions, notes delete), header avatar = 34px, and many inline buttons at `height:30–32px` (staff Scope/Remove, trust-pass Grant/End, join Approve/Decline). The standards editor deliberately uses 44px (`coach.css:305,312` with the comment "a11y floor"), proving the rule is known but applied unevenly.
- **Expected behavior:** All interactive controls meet ≥44×44 (WCAG 2.5.5 / iOS HIG), or expand the hit area with padding.
- **Recommended fix:** Raise `.co-chip`/`.co-abtn` and the inline `sm` buttons to a 44px minimum hit area (visual size can stay compact with padding).
- **Related:** `coach.css:95-96,147-148`; inline `height:30/32px` in `coach.js`, `roles.js`.

---

**[P2-6] Gradient-clipped score number is a contrast/robustness risk**
- **Screen:** Home (Team Pulse "Group score")
- **Current behavior:** `.co-pulse-score .num` uses `background-clip:text; color:transparent` over the blue→teal gradient. This is the intended, founder-ratified signature — but gradient text can dip below contrast on parts of the sweep, and disappears entirely if `background-clip` fails.
- **Expected behavior:** The number stays legible and meets contrast in every stop and every fallback.
- **Recommended fix:** Set a solid fallback `color` before the clip, verify the lightest stop's contrast on `--surface-1`, and keep a non-transparent fallback for unsupported engines. Do not remove the signature.
- **Related:** `coach.css:47-52`. See memory: blue→teal is the ratified score signature.

---

**[P2-7] Notification Rules screen has a confusing title and subtitle**
- **Screen:** Notification Rules
- **Current behavior:** Title is "Notifications"; subtitle is "Planned on this phone from your latest roster view — open the app for the live picture." On a settings screen this reads as a staleness caveat, not a description of the controls. The checklist calls the destination "Set notification rules" while the screen says "Notifications."
- **Expected behavior:** The header describes what the screen controls; the label the coach tapped matches the destination.
- **Recommended fix:** Title "Notification rules"; subtitle describing the controls ("When you and your athletes get nudged"). Move the on-device planning caveat to a footnote near the relevant rows.
- **Related:** `settings.js:408-414` (`coachNotifSettings`).

---

**[P2-8] The `+` Create menu routes two distinct intents to the same settings page, and one to a coming-soon screen**
- **Screen:** Create menu
- **Current behavior:** "Add an athlete" → `coach-profile`, "Invite staff" → `coach-profile` (same page), "Team diet" → `team-diet` (coming-soon), "Adjust a schedule" → `coach-roster` (no schedule UI on arrival), "Message an athlete" → `coach-roster` (works: pick from roster).
- **Expected behavior:** Each create action lands on its specific action.
- **Recommended fix:** Deep-link "Add an athlete" and "Invite staff" to their specific sections/sheets (pairs with P1-3). Give "Adjust a schedule" a real destination or remove it until built.
- **Related:** `coach-create.js:11-21` (`OPTIONS`).

---

**[P2-9] Coach Profile is overloaded**
- **Screen:** Coach Profile
- **Current behavior:** One screen carries account identity, handle editor, team code with three code actions, full staff management (invite across 7 roles, scope, remove), and 7 team-settings rows — and it is the deep-link target for multiple checklist and menu items.
- **Expected behavior:** Distinct concerns on distinct surfaces; the account hub should not double as the staff console and settings index.
- **Recommended fix:** Split staff into `coach-staff` (fixes P1-3/P2-8), keep identity + code + a settings index here.
- **Related:** `roles.js:1000-1131` (`coachProfile`).

---

**[P2-10] The Plan tab stacks four different mental models**
- **Screen:** Plan
- **Current behavior:** Standing standards (room by room), per-athlete targets, trust passes, and program controls (AI voice, team diet) are stacked in one long scroll. Coherent, but dense, and it mixes "set the rule for everyone" with "set numbers for one athlete."
- **Expected behavior:** Clear separation between team-level standards and per-athlete targets.
- **Recommended fix:** Consider a two-segment split (Standards | Athletes) or clearer section framing; keep trust passes with the athlete they belong to.
- **Related:** `coach.js:203-291` (`coachPlan`).

---

**[P2-11] Side-stripe accents on priority cards and the standards preview (banned pattern)**
- **Screen:** Home (priority cards), Team Standard editor (preview card)
- **Current behavior:** `.co-pri::before` is a 3px colored left stripe keyed to tier; `.std-preview::before` is a 3px gradient left stripe. On the priority card the tier is already conveyed by a text chip and the score color, so the stripe is redundant decoration.
- **Expected behavior:** Convey tier with a full-bleed tint, a leading indicator, or the existing chip — not a colored left border.
- **Recommended fix:** Remove the stripes; if the tier needs more weight, tint the whole card surface subtly.
- **Related:** `coach.css:123-126,355-356`.

---

**[P2-12] Empty roster points to the profile for a code that Home surfaces directly**
- **Screen:** Empty Roster
- **Current behavior:** The empty state reads "Share your team code from your profile." The Home empty dashboard already shows the code inline with Copy/Share and a QR, and the code also lives in Coach Profile — so this pointer sends the coach on an extra hop for something Home hands them directly.
- **Expected behavior:** Offer the code/Share inline wherever the coach is told to share it.
- **Recommended fix:** Render the invite code + Share inline in the empty roster, or point to Home where it already lives.
- **Related:** `coach-roster.js:183`.

---

### P3 — Polish

- **[P3-1] "Review your standard" (checklist) opens a screen titled "Plan."** Label the coach tapped ≠ destination header. Recurring with the checklist's other steps. (`coach-home.js:50`, `coach.js:227`)
- **[P3-2] "Requirement templates" row in Coach Profile opens the assign composer, not templates.** Templates actually live in the standards editor. Over-promises. (`roles.js:1122`)
- **[P3-3] Empty "Team score" tile renders a stray teal dash** that reads as a broken/empty progress bar (`qc/c-empty.png`). Verify and replace with a clearly-empty treatment. (`coach-home.js:66-73`, `notScoredTeamTile`)
- **[P3-4] Grouping vocabulary is inconsistent:** "position room," "room," "group," "custom group," "position group" across onboarding, Plan, Roster, Home scope, and the checklist. Pick one model and name it consistently.
- **[P3-5] Header avatar initials are derived two different ways** (Home uses `S.coachIdentity.initials`; Roster recomputes from the handle). Can produce different initials on adjacent screens. (`coach-home.js:201`, `coach-roster.js:178`)
- **[P3-6] Back control and header avatar are `role="button"` divs without `tabindex`** — not keyboard-focusable. Acceptable for a touch WebView, not ideal. (`components.js:189,210`)
- **[P3-7] `copilot` remains a routable screen** duplicating the Inbox's "daily briefing" it was replaced by. Likely deep-link-only dead weight now. (`coach.js:1099`)
- **[P3-8] First Home hierarchy:** the "Your team is ready" confirmation card + score tile push the invite card and setup checklist below the fold (`qc/c-empty.png`). The day-one job (invite + finish setup) should sit above the celebratory chrome. (`coach-home.js:79-94`)

---

## 6. Patterns & Systemic Issues

1. **"Middle page" routing for first-run tasks.** Three separate entry points ("Add another staff member," `+` "Add an athlete," `+` "Invite staff") all land on the same dense Coach Profile page, and "Create position groups" lands on a roster that can't do the job. First-run actions should terminate on the action, not a hub. (P1-2, P1-3, P2-8)
2. **Checklist / destination label mismatches.** The setup checklist repeatedly names an action ("Review your standard," "Create position groups," "Set notification rules") whose destination screen is titled something else ("Plan," roster, "Notifications"). (P1-1, P1-2, P2-7, P3-1)
3. **Touch-target floor applied unevenly.** The standards editor is correct at 44px; almost everything else (chips, action buttons, inline `sm` buttons, avatar) is 30–36px. This is one rule, applied in one screen but not the system. (P2-5)
4. **Preview surfaces indistinguishable from live features.** AI Voice, Team Diet, Wellness Flags are honest in body copy but look shippable from their entry points. A single "preview/coming-soon" convention would fix all three. (P2-3, P2-4)

---

## 7. Positive Findings (keep and replicate)

- **Honest states everywhere.** Every coach screen has explicit loading (null), offline (`wifiOff`), and empty states, and never fabricates a score or roster. Offline reads as offline, not as "no athletes." This is a core product principle, executed consistently.
- **Failed writes never lie.** Comments, notes, assignments, staff invites, group edits, and bulk actions all gate UI state on the real success return, keep typed text on failure, and surface honest inline errors. (`coach.js`, `coach-roster.js`, `roles.js` throughout)
- **Scroll stability is engineered, not accidental.** Roster search patches `#roster-list` in place; the standards editor writes inputs straight into state without re-rendering (focus preservation); the athlete profile guards against refetch/repaint loops; nav restores exact scroll on Back. (`coach-roster.js:158-173`, `coach.js:720-740`, `router.js:239-245`)
- **The Team Standard editor is a model screen.** Clean module cards, a live "What the athlete sees" preview built through the *same* code path the athlete's Home uses (no drift), server-validated rails, correct 44px controls, and a prospective "effective from" that never rewrites today. (`coach.js:534-820`, `qc/c-editor.png`)
- **Timing & late-credit is correctly inline.** It is a module inside the standards editor, not a separate middle page — exactly the right call.
- **The visual system is cohesive and premium.** Tokenized color, the blue→teal signature tying the coach Pulse to the athlete ring, restrained stat tiles, and a calm dark surface. It does not read as templated.
- **Athlete-code sharing is strong.** Home shows the code in boxes + a scannable QR + Copy/Share (native share sheet with fallback), and Profile adds Customize and Regenerate with honest "old code stops working" behavior.
- **Permissions are real and fail safe.** The staff capability map (`staff-access.js`) never dangles a button the server would bounce, and fails open only while the role loads. View-only staff get an honest "you have view-only access" screen instead of dead controls.

---

## 8. Coverage of the Requested Evaluation Criteria

| Criterion | Result |
|---|---|
| Every button opens what it promises | Mostly yes. Exceptions: AI Voice (preview), Team Diet (coming-soon), "Requirement templates" → assign, "Create position groups" → dead-end roster, "Add staff" / "Add athlete" / "Invite staff" → dense profile page. (P1-2, P1-3, P2-3, P2-4, P2-8, P3-2) |
| Information hierarchy | Generally clear. First Home buries the day-one actions (P3-8); Plan and Coach Profile are overloaded (P2-9, P2-10). |
| Navigation & back behavior | Excellent origin/scroll restoration overall; one gap where Coach Profile resets the stack (P2-2); Coach Profile lacks an active-tab state (P2-1). |
| Mobile spacing & safe areas | Handled at the framework level (128px reserve, safe-area insets). |
| Bottom-nav overlap | Good globally; the roster sticky bulk-bar is the one likely collision (P1-4). |
| Scroll stability | Strong — deliberately engineered (Section 7). |
| Loading / empty / error / success | Strong and honest, with one gap: the setup checklist's success state never fires (P1-1). |
| Copy clarity | Good voice; issues are the notif title (P2-7), grouping vocabulary (P3-4), and checklist/destination mismatches (P3-1). |
| Accessibility | The measurable weak spot: sub-44px targets (P2-5), gradient-text robustness (P2-6), div buttons (P3-6). |
| Visual consistency | High; blemishes are the side-stripes (P2-11) and dual avatar-initial logic (P3-5). |
| Premium & intentional | Yes. Reads as a considered in-house system, not AI slop. |
| Onboarding tasks direct & actionable | The main shortfall (P1-1, P1-2, P1-3, P3-8). |
| Overloaded / unnecessary middle pages | The systemic issue (Section 6.1). |

---

## 9. Recommended Actions (in priority order)

Fixes map to `/impeccable` commands. You can run these one at a time, all at once, or in any order.

1. **[P1] `/impeccable onboard`** — rebuild the first-run activation: real checklist completion state, persistent-until-done, and direct destinations for "add staff" and "create group" (P1-1, P1-2, P1-3, P3-8).
2. **[P1] `/impeccable harden`** — fix the roster bulk-bar occlusion and verify safe-area clearance on device (P1-4).
3. **[P2] `/impeccable adapt`** — raise all interactive targets to the 44px floor the standards editor already uses (P2-5).
4. **[P2] `/impeccable clarify`** — notification-rules title/subtitle, checklist/destination label alignment, and one grouping vocabulary (P2-7, P3-1, P3-4).
5. **[P2] `/impeccable distill`** — split staff out of Coach Profile; give the Plan tab clearer separation (P2-9, P2-10, P2-8).
6. **[P2] `/impeccable critique`** — decide the treatment for preview surfaces (AI Voice, Team Diet, Wellness Flags) so roadmap reads as roadmap (P2-3, P2-4).
7. **[P3] `/impeccable polish`** — remove side-stripes, fix the empty score-tile bar, unify avatar initials, contrast-harden the gradient score (P2-6, P2-11, P3-3, P3-5).

Re-run `/impeccable audit` after fixes to watch the score climb (the a11y dimension will move fastest).

---

## Remediation Log

### 2026-07-19 — First-run activation batch (P1-1, P1-2, P1-3) — FIXED & verified

**What changed**

- **Real completion tracking (P1-1).** Added `RT.coachSetup` (persisted per-account, reset on account switch by `_wipeUserScopedState`) and `act.markCoachSetup(key)`. Each checklist step now reflects a genuine signal — code shared (Copy/Share tapped, or athletes already joined), standard saved, notification prefs touched, staff invite minted, group created — instead of a hardcoded `done`. The first step is no longer pre-checked. (`state.js`, `coach-home.js`, `coach.js`, `coach-roster.js`, `roles.js`)
- **Checklist persists after the first athlete (P1-1).** It now renders on the populated Home too, as a collapsed "Finish setting up your team · N" section, and hides only once every step is genuinely done. (`coach-home.js`)
- **"Create position groups" no longer dead-ends (P1-2).** Renamed to "Organize athletes into groups"; when there are no athletes the step is shown as "Unlocks once athletes join" and is *not* a tappable link to an empty roster. It becomes actionable once athletes exist. (`coach-home.js`)
- **Direct destinations, no more middle page (P1-3).** "Add another staff member" → `coach-profile/staff`, "Add an athlete" → `coach-profile/code`, and the `+` menu's "Invite staff" / "Add an athlete" match. Coach Profile now deep-links: on arrival it smooth-scrolls the targeted section (staff or code) into view via new `#cp-staff` / `#cp-code` anchors. (`coach-home.js`, `coach-create.js`, `roles.js`)

**Verification (headless browser against the served proto)**

- Fresh coach, empty roster: checklist routes to `coach-profile/code` and `coach-profile/staff`; group step reads "Organize athletes into groups / Unlocks once athletes join" and carries **no** `coach-roster` link; old labels gone; **0** false green checks.
- After `markCoachSetup('standard')` + `('sharedCode')`: **2** green checks, "Shared — athletes can join anytime" copy, and the flags persist in `RT.coachSetup`.
- Coach Profile renders with `sub:'staff'` without error and exposes both `#cp-staff` / `#cp-code` anchors; `collapseSection` renders the collapsed setup group. All six edited files pass `node --check`.

**Still open:** P1-4 (roster bulk-bar occlusion — needs on-device verification before a CSS change) and all P2/P3 items.

---

*Grounded in the current proto WebView code and the `qc/` renders; the requested `docs/coach-review/screenshots/` directory does not exist in the repo. The original audit was read-only; the first-run activation fixes above were applied and verified afterward at the user's direction.*
