# Parent "fueling consistency" view — spec

**Status:** DRAFT for founder read. Nothing in this doc ships until you've read it.
Authored 2026-09-17 by the 8 AM build session, per backlog #1 (the M4 scout finding,
2026-09-04). No code in this doc; the build is a known quantity once you say go.

---

## Why this, in one paragraph

The 09-04 market scout found one product conversation no rival owns: **under-fueling is
the parent conversation**. Sports-medicine guidance (RED-S, the athlete triad) tells
parents of teen athletes to watch whether their kid is fueling *enough and regularly* —
while every rival either sells surveillance (Teamworks-style mandatory tracking, which
athletes are publicly pushing back on) or sells the parent nothing at all. The empty
position is a parent view that reads as **care, not surveillance**: it answers "is my
athlete fueling consistently?" and refuses to answer "what did they eat?". We are
already most of the way there by accident of good security design — see next section.

## The accident in our favor: v1 needs zero new data exposure

The guardian read boundary (migration 0081) is an explicit SELECT list: **date, score,
grade, name. Never** weight, photos, meals, or check-ins. Two RPCs exist behind it:

- `guardian_children()` — each linked athlete's name + latest day/score/grade.
  The hub uses this today.
- `guardian_child_days(child, days_back)` — up to 120 days of `(day, score, grade)`
  per child. **Granted, consent-gated, authored in 0081 (applied at go-live with the
  rest of it — the hub already reads through the same migration's `guardian_children`)
  — and no screen has ever called it.**

Consistency is *presence over time*: which days carry a scored day row, how the gaps
cluster. That is derivable entirely from `guardian_child_days`. So v1 is a
presentation-layer feature on data the athlete already agreed to share. No new RPC, no
new columns, no consent renegotiation.

**What a "logged day" is — the precise, load-bearing definition.** A `days` row is not
a meal signal: rows are upserted by check-ins, focus/commitment taps, even onboarding,
and the server's weight path (`log_my_weight`, 0181) can insert a **weight-only** row
with no score. So the pure core counts a day as logged **only when its `score` is
non-null** — a day the athlete's app actually pushed a scored day. This does two jobs
at once: it excludes weight-only rows, so *the fact that a weight was logged on a given
day never reaches the parent* (that presence signal would otherwise leak through the
dots, on a surface whose boundary box promises weight stays private); and it makes the
strip's word "logged" literally true. It still means a check-in-only day counts as
logged — see open question 5, which is exactly the founder call on whether that is the
right v1 meaning.

Better: the athlete's invite screen **already promises** the parent will see "your
daily score, streak, and completion" — but the hub renders only score/grade/latest-day.
Today the invite over-promises. This feature makes an existing promise true instead of
making a new one.

## The one question the view answers

> "Is my athlete fueling consistently?"

Framed strictly as **logging consistency**, because that is all we truthfully know.
The load-bearing honesty rule, everywhere on this surface:

> **A quiet day means nothing was logged, not that nothing was eaten.**

That sentence (verbatim, see copy inventory) appears on the detail view. We never let
absence-of-data read as absence-of-meals, and we never let this view diagnose. The word
"under-fueling" appears nowhere in the UI, ever. We show a pattern; the parent has the
conversation. That IS the product: the app is proof of showing up, the humans do the rest.

## Deliberately never shown (the taste boundary — this list is the feature)

- **Calories and macros.** The enforcement is 0081's SELECT-list boundary (calories
  simply are not in the guardian read path, for any athlete); the market position
  ("accountability without calorie counting", PRODUCT.md → the ASO listing) is why we
  keep it that way on purpose. PRODUCT.md's red line — calorie math is never the
  athlete's homework — points the same direction.
- **Weight.** Not stored in the guardian boundary; stays that way.
- **Meal photos or meal contents.** The parent never sees what was on the plate.
- **Which meals** (v1). "Logged breakfast: no" at 8 AM is a surveillance ping, not
  care. Day granularity only. (Meal-slot presence would also be NEW exposure beyond
  0081's promise — see "If we ever want more data" below.)
- **Times of day.** No "logged at 11:43 PM" — that invites policing.
- **Check-in answers.** Already outside the boundary; stays outside.
- **Comparisons.** No "other athletes log X days a week", no percentile, no leaderboard.
- **A diagnosis.** No "under-fueling risk", no red alarm states, no streak-guilt.
  The strongest language this surface ever uses is "quieter than usual".

## What the parent sees

### 1. Hub: a consistency line on each athlete card

On the existing "Your athletes" card (under "Latest day:"), a quiet strip: one small
dot per day, oldest left. The window is defined once, for the strip AND the counts, so
no two builders compute two different numbers: **"the last 14 days" means the 14
complete days ending yesterday.** Filled dot = a logged day (scored, per the
definition above); hollow dot = no logged day. Today is a 15th, visually distinct
marker at the right edge — pending until a scored day arrives, filled after — and sits
in neither the numerator nor the denominator of any count. Same rule for the 30-day
window on the detail view. Beneath the strip, one line of plain English:

- `Logged 12 of the last 14 days` (the usual case)
- `Logged every day for two weeks` (14/14 — say it warmly, no confetti)
- `No days logged yet` (never linked-and-empty read as failure; see honest states)

Dots are **neutral ink** (the muted text color), not green, not gradient. Green is
status, the gradient is for score surfaces, and a calendar of dots is neither. The
score number on the card keeps its existing color treatment; the strip stays quiet
beside it.

The card becomes tappable and opens the detail view (today it is inert).

### 2. Detail: the "Fueling consistency" screen (new, one per athlete)

`backHead(athlete name, 'Fueling consistency')`, then:

1. **The 30-day picture.** Rows of the same dots, one row per week, weekday-aligned,
   month labels where they change. Under it, the honesty line, verbatim:
   *"A quiet day means nothing was logged, not that nothing was eaten."*
2. **Two plain-English facts** (computed, never editorialized):
   - `Logged 24 of the last 30 days`
   - `Longest quiet stretch: 3 days` (omit the line entirely when it's 0 or 1 —
     a one-day gap is life, not a fact worth stating)
3. **The score line, existing treatment.** Latest score + grade, exactly the number
   the hub already shows (gradient/score-color rules unchanged). No trend arrow in
   v1 — a falling score next to a gap graph starts diagnosing on its own.
4. **The care note, at most one, at the bottom, only when earned:**
   - Quiet week (4+ of the last 7 days quiet, but logging existed before):
     *"It's been a quieter week than usual. A good moment to ask how training is
     going, in person, not through the app."*
   - Otherwise: no note. Silence is the default. This surface must not manufacture
     things to say.
5. **The boundary box** (reuse the hub's `sidebox` pattern):
   *"What you can see: which days were logged, and the day's score and grade. Meal
   photos, weight, and check-in answers stay between your athlete and their coach."*

### 3. Every "what they see" sentence updates together (same flag, same commit)

The feature makes three existing boundary sentences false the moment the strip ships;
all three change behind the same flag or the app lies somewhere:

- **Parent hub sidebox** (today: "…the date of their latest logged day; that's the
  whole view.") becomes: *"Their daily score and grade, and which days they logged;
  that's the whole view. Meal photos, weight, and check-in answers stay between your
  athlete and their coach."*
- **Parent hub empty state** gains the same "which days they logged" phrasing.
- **Athlete's "Invite a parent" screen**, both the sidebox body AND the `backHead`
  subtitle (today "They see your score & streak" — a streak nothing renders, before
  or after this feature). Body becomes: *"Your daily score and grade, and which days
  you logged. Never your meal photos, weight, or check-in answers."* Subtitle:
  *"They see your score & logged days"*.

This also **retires the over-promise**: "streak, and completion" language goes away in
favor of what the feature actually renders. Recommendation (founder call, cheap either
way): a minor athlete's guardian-consent screen gets the same sentence, so the athlete
who is being seen knows exactly what is seen. Trust is the product; the athlete
reading the exact same boundary the parent reads is how it feels like care.

## Honest states (each one is a rule, not a suggestion)

- **Failed fetch ≠ empty history.** `guardianChildDays` today returns `[]` on error —
  the exact "graceful-[] lie" the fetcher contract bans, harmless only while nothing
  called it. The build **fixes it to `null` = failed** (same contract as
  `guardianChildren`) and the detail screen shows the standard error state with retry.
  A network blip must never render as "your kid logged nothing for 30 days".
- **Hub strip on failed fetch:** omit the strip entirely (card renders as today).
  Never a strip of 14 hollow dots over an outage.
- **Genuinely no data:** "No days logged yet" + one line: *"When they log their first
  day, it shows up here."* No sad-face, no nudge.
- **Today is not a quiet day yet.** Today's marker renders as pending (smaller/dimmer,
  distinct from hollow) until a scored day arrives. At 7 AM nothing has been logged
  and nothing is wrong.
- **No day-boundary lying:** day identity comes from the athlete's day dates as the
  server returns them; the client never re-derives which calendar day a row belongs
  to. The one anchor the client must supply is "today" for the pending marker, and
  parent and athlete can sit in different timezones (the RPC can even return a row
  dated after the parent's local today). Defined once in the pure core:
  `todayISO = max(parent-local ISO date, latest returned day)`. The table-driven
  tests include the parent-behind-athlete case.

## Data, security, consent

- **v1 reads:** `guardian_children()` (hub, unchanged) + `guardian_child_days(child, 30)`
  (detail + hub strip; the hub can fetch lazily per card or reuse the detail fetch —
  build-time decision, with the roster-fan-out lesson from 0219 in mind if rosters of
  linked kids ever exceed a handful, which for parents they don't).
- **No new SQL — but probes ARE owed.** No migration and no new SECURITY DEFINER
  surface; the 0081 gating (active guardianship + minor-consent check) is the whole
  authorization story. However, `guardian_child_days` has **zero probes in the SQL
  authorization suite today** (only `guardian_children` is probed), and it is a
  DEFINER RPC taking an arbitrary `child uuid` — exactly the shape the 09-04 lesson
  is about. Its first real caller pays that debt: stranger / athlete-self / anon /
  revoked-guardianship / minor-without-consent probes land in the suite as part of
  the build (`verify:full` runs them).
- **If we ever want more data** (meal-slot presence, trend classification): that is
  new exposure beyond 0081's SELECT-list promise. It needs (a) a new RPC with its own
  attack probes in the SQL suite (charter gotcha: DEFINER RPCs get probed as athlete,
  stranger, anon), (b) updated "what they see" copy on BOTH sides before the data
  flows, and (c) your explicit go. Parked deliberately; nothing in v1 forecloses it.

## Flag and rollout

New user-facing surface → ships **dark** (shipping-discipline rule 7). Since v1 is
purely presentational on existing reads, the honest gate is the repo's client-constant
pattern (like `ROLLCALL_OFF`): `PARENT_CONSISTENCY_ON = false` in one module, hiding
the strip, the card tap, and the invite-copy change; flip + zip rebuild turns it on.
A server `feature_flags` row adds nothing here because no server behavior changes.
**Open ruling attached:** rule 7 says the audit session flips flags on, and that
session is retired — so the flip is yours (or the ruling on who inherits it) either way.

## Build shape (for whichever session builds it)

1. **Pure core first** (testable, no backend): `consistencyStats(days, todayISO)` →
   `{ logged14, logged30, longestGap, quietWeek, dots: [...] }`. Table-driven tests:
   gaps at range edges, empty, single day, all days, today-pending, the quiet-week
   threshold both sides.
2. `guardianChildDays` fetcher-contract fix (`[]`→`null` on failure) + its test, and
   the `guardian_child_days` attack probes into the SQL authorization suite (see
   Data & security — the probe debt this feature inherits and pays).
3. Detail screen + hub strip + card tap, behind the constant.
4. Copy changes (invite screen, minor-consent screen if ruled yes), same flag.
5. QC: sweep shots of hub + detail in both themes, seeded with a gap pattern that
   exercises the quiet-week note; and a seeded FAILED-fetch shot proving the error
   state (the honest states are the feature; they get shots too).

Estimate: one focused session. Nothing here is bigger than the mute-parity day.

## Open questions for you (recommendations attached, nothing blocked on them)

1. **Quiet-week threshold:** proposed 4+ quiet of the last 7, only when there was
   logging before. Feels right; happy to tune after real-parent feedback.
2. **The transparency mirror on the minor-consent screen:** recommend yes (above).
3. **Name:** "Fueling consistency" is the working title. It says the product's word
   ("fueling") while the honesty line keeps it truthful. Alternative considered and
   rejected: "Logging history" (accurate but reads like a sysadmin tool, not care).
4. **Word on the strip when perfect:** "Logged every day for two weeks" — warm,
   factual, no gamification. If you want even quieter, "Logged 14 of 14 days".
5. **What a filled dot means, exactly.** v1 counts any *scored* day as logged — which
   includes a day where the athlete only did their check-in and logged no meals. On a
   screen named "Fueling consistency" that is a soft over-count. It is still honest
   (the word on screen is "logged", and the honesty line carries the rest), and the
   truthful alternative — meal-presence granularity — is new data exposure beyond
   0081's promise, which v1 deliberately refuses. Recommendation: ship v1 with the
   scored-day meaning and revisit only if real parents read the dots as meal claims.
   If that ever bothers you enough, it moves to the "more data" track above, with
   its consent-copy and probe costs.
