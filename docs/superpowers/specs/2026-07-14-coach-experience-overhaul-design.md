# Coach Experience Overhaul — Design (founder correction notes, 2026-07-14)

**Status: DRAFT — awaiting founder approval.** No implementation has started.

Source: founder's correction notes (general + coach-account perspective), grounded
against the shipped proto WebView (`proto/redesign-2026-07`), the Supabase backend
(`supabase/migrations`, `supabase/functions`), and the brand/architecture docs.
Every "today" claim below has a file reference.

The notes decompose into **six workstreams** (WS1–WS6), ordered so each ships
independently. WS1 is pure fixes (no design risk); WS3 is the biggest new system
(requirements engine) and unblocks three separate notes; WS5 (Plan control center)
is the largest UX build and lands last.

---

## WS1 — Fixes & fast wins (no schema changes)

### 1a. Navigation wiring: shared screens leak coaches into athlete chrome
**Today.** "Team plan & billing" on the coach profile routes to the shared `billing`
screen (`js/screens/roles.js:803` → `js/screens/settings.js:219-256`). That screen
declares `tab:'profile'` with **no `nav`**, so the router falls back to the athlete
tab bar (`js/router.js:93`), and its back/Done buttons hard-code the athlete
`profile` route (`settings.js:223,252`). Same root cause on `privacy`, `settings`,
`terms`, `notif-settings`, `delete-account` (`js/screens/index.js:63-83`).

**Design.** Make shared utility screens **role-aware**: resolve `nav` and the
back/Done target from the signed-in role (coach → coach chrome + `coach-profile`;
trainer → trainer equivalents; athlete unchanged). The billing screen additionally
gets role-aware content: a coach sees the team plan (seat count, tier), not
"Athlete · $9.99/month". One helper (`roleHome()` / `roleNav()`) in `js/roles.js`,
consumed by every shared screen — no per-screen forks.

### 1b. Coach greeting
**Today.** The coach header is the static `titleHead('Coach view', '{team} · today')`
(`js/screens/coach.js:65`). The time-of-day greeting getter exists but is athlete-only
(`js/state.js:949-952`, used in `js/components.js:160-174`).

**Design.** The coach dashboard greets like a real account: **"Good afternoon,
Coach {preferred-name}"** with `{team} · today` as the subtitle. "Coach view" as a
label dies everywhere. Reuses `S.greeting`; the name comes from WS2's preferred
coach name (falls back to last name until WS2 ships).

### 1c. Custom team code UI
**Today.** The backend already supports vanity codes — `set_my_team_code()` /
`regenerate_my_team_code()` with `^[A-Z0-9]{4,12}$` validation and friendly
"already taken" errors (`supabase/migrations/0026_custom_codes.sql`). No proto UI
exposes it; the coach profile team-code card is copy-only (`roles.js:776-795`).

**Design.** The team-code card gains **Customize** (inline field, live validation,
taken-error surfaced) and **Regenerate** (confirm dialog — the old code stops
working). Same treatment for the trainer practice code.

### 1d. Coach → athlete detail ("needs attached") page bugs
**Today.** Tapping a Needs-attention row or roster row routes to `coach-athlete/{id}`
(`coach.js:105,43` → `coach.js:324-427`). The screen depends on `ROSTER` being loaded
first (`coach.js:338-339`) and on `loadAthlete` (`coach.js:308-322`) — a race or
partial load renders broken/empty states ("super buggy").

**Design.** Harden the load path: skeleton state while roster+day loads, retry on
failure, never "Athlete not found" for a real roster member mid-load. Then add the
**accountability action row** (see WS4c) so a late/missed athlete can be acted on,
not just observed.

---

## WS2 — Identity & theming

### 2a. Preferred coach name ("Coach JB", not "Coach John")
**Today.** Only `profiles.full_name` exists (`0001_schema.sql:23`); every athlete
surface shows the head coach's raw full name via the `team_head_coach_name` /
`resolve_team_code` RPC aliases (`0024_join_requests.sql`). No nickname concept
anywhere (verified across proto + schema).

**Design.**
- **Schema:** `profiles.coach_display_name text` (nullable; migration, authored
  not applied — guardrail). RPCs that surface `coach_name` return
  `coalesce(coach_display_name, 'Coach ' || last_word(full_name))`.
- **Capture:** coach signup (`js/screens/roles.js:102-110`) adds one step after
  name: *"How does your room address you?"* with generated suggestions — for
  "John Brown": `Coach Brown` · `Coach John` · `Coach JB` — plus a free-text field
  (accept anything reasonable, e.g. "Coach B"). Editable later from coach profile.
- **Surfaces:** athlete home coach references, meal-thread "Coach" labels, the AI's
  voice when it speaks for/about the coach, join-preview ("Coach JB's team"),
  weekly digest, and the WS1b greeting.

### 2b. Light mode
**Today.** The proto is **dark-only**: one `:root` palette explicitly labeled "Dark
premium system" (`css/tokens.css:1-60`); zero `prefers-color-scheme` /
`[data-theme]` machinery; no toggle in settings. (The native `src/` app has a
theming foundation per `docs/DARK-MODE-TODO.md`, but the shipped surface is the
proto, so this is a separate CSS effort.)

**Design.** Token-level theming: keep `:root` as dark (default, unchanged bytes for
current users), add a complete `[data-theme="light"]` block mirroring every token,
mapped from the committed light design system (`DESIGN.md`: canvas `#F8FAFC`, card
white, ink `#0F172A`, Athlete Blue spine). Settings gains **Appearance: Dark /
Light / System** (System = `prefers-color-scheme` listener; persisted). Sweep the
other four CSS files + inline styles for hardcoded hexes onto tokens first — that
sweep is most of the work. Score surfaces keep the blue→teal signature sweep in
both themes (founder brand rule). Acceptance: every text/surface pair AA in both
themes; no flash-of-wrong-theme on boot.

---

## WS3 — Requirements engine (the backbone: position rooms, custom standards, assignments, the + button)

This one system resolves four notes: position-room standards in onboarding,
more/fewer than 3 meals + weights, "no custom requirement-assignment backend yet",
and "what should the + button do".

### Today
- The requirement catalog is **hardcoded client-side** (`js/requirements.js:34-63`):
  breakfast/lunch/dinner (photo), weight Mon/Wed/Fri, hydration focus, recovery,
  weekly check-in. Meals/day is a 2–4 knob for **solo athletes only**
  (`js/screens/onboarding.js:157-159`, clamped in `js/ob-helpers.js:74`);
  coach-joined athletes see one flat team-wide standard, no position concept.
- Backend: **no requirements/assignments tables**. Targets are JSONB blobs
  (`athlete_profiles.targets/standard`, `teams.settings.tracked`). `position` is
  free text on `team_members`/`athlete_profiles`. `plan_assignments` (0032) exists
  but was never wired to the client (`0053:20-25`). The coach + button routes to a
  hard-coded "Custom assignments are coming" placeholder (`coach.js:151-171`).
- Constraint: the **scoring formula stays in `src/core` and is not coach-editable**
  (ratified D3 / weight rails, `docs/FOUNDER-DECISIONS.md`). Coaches customize
  *requirements* (what must be done); the engine converts completion → score.

### Design
**Schema (new migration, authored not applied):**
- `requirement_sets` — `id`, `team_id`, `scope_kind check in ('team','position','athlete')`,
  `scope_value` (null | position string | athlete_id), `items jsonb` (validated
  array in the existing catalog item shape: id, label, component, proof, freq,
  required), `created_by`, `updated_at`. One active set per (team, scope) —
  unique index. Resolution precedence: **athlete > position > team**.
- `requirement_assignments` — one-off/dated tasks (the + button's output):
  `id`, `team_id`, `athlete_id` (or `position` for a room-wide blast), `title`,
  `proof check in ('photo','form','scale','counter','check')`, `due_at`,
  `note`, `created_by`, `status`. Supersedes the unwired `plan_assignments` for
  task-shaped work (meal-plan assignment stays on 0032).
- RLS: coach staff of the team write; athlete + `can_view` read. Item shape
  validated by a CHECK/trigger so a bad client can't corrupt a room's standard.

**Requirement knobs (what a coach can set per set):** meals/day **1–6** (photo
proof), **lift/training sessions per week 0–7** (new `lift` catalog item, proof
`check` or `photo`, scheduled days), hydration target, recovery check-in on/off,
weigh-in days, weekly check-in day. All within the D3 rails — weights of scored
components stay engine-owned.

**Client:** `js/requirements.js` `CATALOG` becomes the *fallback*; `derive()` reads
the athlete's resolved set (team → position override → athlete override) fetched
at day load. Coach edits sets in the Plan control center (WS5); the athlete's Home
and onboarding Step 6 render whatever their resolved set says.

**Onboarding "Set the standard" page:** for a coach-joined athlete it shows **their
position room's standard** — resolved via the position they picked in Step 3
(`onboarding.js:100-104`) — titled *"Coach {preferred}'s standard for the {POS}
room"*, falling back to the team set when no position set exists. Solo athletes
keep their knobs, now 1–6 meals + lift sessions.

**The + button (recommendation).** The coach + FAB becomes the **Assign composer**
(it already routes to `coach-assign`): pick who (athlete(s) / a position room /
whole team) → pick what (from the coach's saved templates or custom: title, proof
type, due) → optional note → send (creates `requirement_assignments`, push via
`notify`). It's the coach's universal "put something on someone's plate" action —
the natural + for a firm accountability app, and it makes "Requirement templates"
on the coach profile real. Alternative considered: + = quick message; rejected —
messaging lives on athlete detail and meal threads (WS4), and a compose-message +
duplicates them.

---

## WS4 — Team page redesign (coach's daily surface)

### 4a. Replace "Coach tools" with a roster-wide activity feed
**Today.** Athletes have a Recent Activity meal feed (`js/screens/home.js:180-208`,
`S.activity` at `js/state.js:1143-1166`, `.act-card`). The coach has **no roster
feed** — only per-athlete "Today's proof" (`coach.js:367-377`) and a "Coach tools"
card (`coach.js:114-131`). Read receipts already exist server-side: `coach_views`
(`0043_coach_seen.sql`).

**Design.** The Coach-tools card is replaced by **Activity** — a lateral feed of
the whole roster's meals (and weigh-ins/check-ins) as they land, same `.act-card`
preview language as the athlete side, each card carrying an **athlete identity chip**
(avatar/initials + first name + position). Cards the coach hasn't opened carry an
**unseen dot**, driven by `coach_views` — "Coach should know which ones he hasn't
looked at yet." Tap → `coach-meal/{id}` (existing screen). Ordering: newest first;
unseen items also surface a count in the section header ("4 new"). The links that
lived in Coach tools relocate: Copilot's summary moves into WS5's Plan page AI,
dietary sheet + profile links move to the Profile tab.

### 4b. Aesthetic pass
The page renders as: greeting header (WS1b) → stat trio → *needs attention* →
**Activity feed** → roster (collapsed to top movers + "View full roster"). One
card language, more air, fewer borders — "clean, easy to digest, still extremely
well put together." Join requests appear as a single pill-banner when pending
rather than a full card. (Detailed visual spec at build time; system per
`DESIGN.md`, dark tokens per proto.)

### 4c. Late-player accountability actions
**Today.** A red-flagged row is tap-through-only; no coach action exists. DMs exist
in schema (`threads`/`messages`, minor-gated via `messaging_authorized()`, `0006`)
but the proto has no coach messaging UI. Copilot artifacts enforce human-sends-AI-drafts
(`0018`).

**Design.** On needs-attention rows and the athlete detail header: **Message**
(opens the thread; AI offers a firm, coach-voiced draft via copilot artifacts —
coach edits/sends, AI never auto-sends), **Nudge** (one-tap push via `notify`:
"Coach is waiting on your lunch"), **Assign** (deep-link into the + composer,
pre-filled with the missed requirement). Rate-sane: one nudge per athlete per
missed item per day.

### 4d. Meal-thread conversation limits
**Today.** `meal_comments` supports athlete/coach/ai roles, reactions, service-role-
only AI rows (`0046`, `0049`); the AI replies only on the athlete's ask path
(`meal-chat` fn, 10/day/athlete cap); coach posting is uncapped (`coach.js:505-533`).

**Design.** Per meal thread: **coach ≤ 2 messages**, **athlete ≤ 3**, **AI ≤ 1
supporting message on the coach side** (a short reinforcement after a coach message,
in the coach's voice/plan context) plus its existing athlete-ask replies — with the
AI *selective*: it responds only when asked or when a coach message benefits from
data support, never chiming in on every post. Enforced in the composer (counter UI:
"1 of 2") **and** server-side (count check in RLS/RPC so the cap is real). Keeps
threads accountability-shaped, not group-chat-shaped.

---

## WS5 — The Plan tab becomes the Coach Control Center

**Today.** The Plan tab is effectively dead: with no athlete id it renders "Open
from an athlete" (`coach.js:185-189`); with one, it's a 3-stepper macro editor
saved via `coach_set_goals` (`coach.js:198-244`, `0054`). Meanwhile the backend
already holds most control-center primitives: `meal_plans`/`meal_templates`/
`plan-generate` (0032), `trust_passes` + eligibility (0033/0039), AI voice route
(`coach-voice`), memory facts + performance profiles (0019/0020).

**Design — the page where the coach feels in control.** Sections, team-level by
default with a per-athlete drill-in:

1. **Standards** (WS3 UI): the team set + position-room cards (QB room · OL room…),
   each editable: meals/day, lift days, weigh-ins, check-in cadence. This defines
   what Home shows every athlete.
2. **Targets & goals:** roster grid of macro/weight targets (`athlete_profiles.targets`,
   `coach_set_goals`); per athlete, **AI recommendation** — "6'3 OL, coach wants him
   at 310 by Sept → suggested protein/calories" — via a `plan-generate`-style
   endpoint that *drafts*, coach approves (numbers-never-change-by-AI rule: AI
   proposes, the coach's save is what writes).
3. **Meal plans:** author/assign `meal_plans` (finally wiring 0032), with AI-drafted
   plans per athlete from sport/position/target.
4. **Log windows:** expected time windows per meal (stored on the requirement-set
   items) — drives "late" logic and nudges.
5. **AI tone & voice:** the coach picks the AI's register (steady / firm / max
   accountability) + the existing "AI in your voice" setup — the AI knows the plan
   and reinforces it in that tone everywhere it speaks.
6. **Trust passes:** eligibility list (≥7 on-standard days, server-enforced),
   grant/end (0033/0039).
7. **Accountability partners:** pair athletes; partners see each other's completion
   and get the miss-nudges. (New lightweight table; athlete-consented per the
   consent architecture.)
8. **Collaboration:** invite a nutritionist/dietitian as team staff (new
   `staff_role 'nutritionist'` value on `team_staff`) — they get Plan-page write
   access to targets/meal plans, and edits carry an author chip ("set by Sarah, RD").

Phasing inside WS5: 5.1 Standards+Targets (with AI recs) → 5.2 Meal plans + log
windows → 5.3 Tone, trust passes → 5.4 Partners, nutritionist collab.

**Copilot tab (recommendation: replace with Inbox).** Founder: "makes 0 sense."
Agreed — Copilot as a *destination* is a dead tab; its value (summaries, drafts)
belongs inside the surfaces where decisions happen. Replace the tab with **Inbox**:
join requests, unread meal threads, DMs, nudge outcomes, weekly digest — the
accountability to-do list a coach actually checks. Copilot's roster summary moves
to the top of Inbox as a daily AI briefing ("3 guys missed lunch; Devin's 2-day
slide"). Tab bar becomes **Team · Plan · [+] · Inbox · Profile**. Alternative
considered: Copilot → "Insights" (analytics); rejected for now — insights are
glanceable on Team/Plan, and a firm accountability app's fourth tab should be
actionable, not another report.

**Coach Profile tab (upgraded).** Identity card with preferred name + editable
("Coach JB" everywhere), team code card (WS1c customize), **staff & collaborators**
(assistants, nutritionist invites, pending), requirement templates (real, backed by
WS3), AI voice & tone shortcut, visibility rules, appearance (WS2b toggle),
role-correct team plan & billing (WS1a), sign out. The dietary-sheet and
full-roster links land here too.

---

## WS6 — Team directory: every major college + pro

**Today.** The onboarding "school" step is a live search over whatever `orgs` rows
exist — **nothing is seeded**; no college or pro team names exist anywhere
(`js/ob-directory.js` → `org-directory` fn → `orgs` table, `0022/0031`). An athlete
whose school isn't a row falls back to code-entry/skip.

**Design.** Seed the directory so it *feels national on day one*:
- Dataset: all **NCAA D1 schools** (~360, with city/state), plus **major pro
  franchises** (NFL/NBA/MLB/NHL/MLS ≈ 155), tagged with a new `orgs.level`
  (`college','pro','hs','club'`) and `league` where applicable. D2/D3/NAIA
  (~900 more) as a fast follow.
- Seeded orgs are directory-visible but **unclaimed**: selecting one still requires
  the coach code / join request (0024) — seeding fixes discovery, not access.
  A coach creating a team gets attach-to-existing-org matching ("UCF — is this
  your school?") instead of creating a duplicate org row.
- Onboarding Step 3's level chips (`Youth/HS/College/Pro`) pre-filter the search.
- Mechanics: a data seed migration (or admin import script) — no client changes
  beyond level badges in results.

---

## Sequencing & effort

| WS | Contents | Size | Depends on |
|---|---|---|---|
| WS1 | wiring, greeting, code UI, athlete-page hardening | days | — |
| WS2 | preferred coach name; light mode | ~1 sprint | — (2a before 1b's name) |
| WS3 | requirements engine + assign composer + onboarding standard | 1–2 sprints | — |
| WS4 | team page redesign, activity feed, actions, chat limits | ~1 sprint | WS3 (assign links), 0043 |
| WS5 | Plan control center (phased), Inbox tab, profile upgrade | 2–3 sprints | WS3 |
| WS6 | directory seeding | days (dataset sourcing is the work) | — |

Brand unification (logos) rides alongside WS1 — see companion decision below.

## Logo unification (WS1e)

**Today — three different logos:** app icon + landing page use the canonical blue
**Performance Dial** (`docs/brand/LOGO.md`, `assets/brand/onstandard-icon.svg`,
`web/landing/index.html:41-49`), but the **in-app** proto logo is a different mark
entirely — a green→cyan→blue ring-with-checkmark generated by `logoMark()`
(`js/components.js:144-158`) with a green-"On" wordmark (`css/flows.css:149-150`).

**Design.** Converge on the Performance Dial per `LOGO.md` (it's the founder's
hi-fi handoff and already owns the icon + landing): replace `logoMark()`'s SVG with
the dial's **on-dark variant** (track `rgba(255,255,255,.16)`, arc `#60A5FA`, head
ink/white) and set the wordmark to the spec'd two-tone — on dark: "On" white,
"Standard" `#60A5FA` — retiring the green "On" (green is status-only per the brand
rule). `DESIGN.md:47-48` still describes the old ring-check as the brand glyph;
update that line to the dial. One mark, three surfaces, one source of truth.

---

## Decisions needed from the founder

1. **+ button = Assign composer** (WS3) — confirm, or prefer quick-message?
2. **Copilot tab → Inbox** (WS5) — confirm, or prefer Insights/analytics?
3. **Meal-thread caps** — coach 2 / athlete 3 / AI 1 coach-side support: confirm counts.
4. **Directory scope** — D1 + big-five pro first, D2/D3 fast-follow: confirm, or all divisions day one?
5. **Meals/day bounds 1–6** and lift sessions 0–7/week — confirm rails.
6. **Nutritionist as team staff role** (sees/edits Plan page only) — confirm scope.
7. Migrations remain **authored-not-applied** (founder applies at go-live) — assumed unchanged.

## Out of scope (this design)

Native `src/` app parity (proto is the shipped surface), scoring-formula changes
(D3 rails are law), TV/leaderboard modes, parent/trainer surface redesigns.
