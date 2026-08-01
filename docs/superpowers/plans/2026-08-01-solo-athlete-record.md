# Solo Athlete — "The Record Is the Witness" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the coachless athlete's experience honest, give them a reason to come back that is their own accumulating record, and convert them to a connected coach at the moment that record is worth showing.

**Architecture:** Copy and gating fixes land first (they stop active harm and depend on nothing). One migration adds two `profiles` columns. Two new surfaces — the Home record line and the connect-offer card — follow the established **pure planner + DOM driver** split: all decisions live in a new pure module `proto/redesign-2026-07/js/solo-record.js` tested under `node:test`, while `home.js` only renders what the planner returns. This mirrors `tour-plan.js` / `tour.js`.

**Tech Stack:** Plain ESM JS (the shipped WebView proto at `proto/redesign-2026-07/`), Deno/TypeScript Supabase edge functions, Postgres migrations, Jest 30 (`*.test.ts`, babel-jest) and `node:test` (`*.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-01-solo-athlete-record-design.md`

## Global Constraints

- **The shipped UI is `proto/redesign-2026-07/`, NOT `src/screens/`.** `src/screens` is the older RN app.
- **Never `git add -A` or `git add .`** Another agent commits on this tree concurrently and will sweep your staged work. Every commit uses explicit paths, exactly as written in each task.
- **Re-check the branch before every commit:** `git rev-parse --abbrev-ref HEAD`. If it is not the branch you started on, stop and ask.
- **`__render()` re-runs `mount()`.** Never start an animation, fire a one-time moment, or reset screen state inside `mount()` — it replays. One-time state resets belong in `render()`; one-time moments are guarded by a persisted marker.
- **An outage must never render as an empty record.** `js/roles.js` returns a `{ error: true }` sentinel on a failed fetch (see `fetchMyTeams:22`, `fetchMealComments:478`). Treat `{error:true}` as "keep last-known / render nothing", never as zero.
- **`esc()` every interpolated value** in proto template strings. `npm run lint:xss` (`scripts/lint-innerhtml-esc.mjs`) is a real gate.
- **`settings.js` line 531 contains a curly apostrophe** (`what’s`, U+2019). Exact-match edits in that file must preserve it.
- **Verification command run before every commit:** `npm run lint:xss && npm run typecheck && npm run test && npm run test:proto`
  (The full `npm run verify` additionally runs `npm run bundle`, a slow real iOS export — not needed per-task.)
- **Test commands:** single Jest file `npx jest src/core/<name>.test.ts` · single Jest test `npx jest src/core/<name>.test.ts -t "<name>"` · whole proto suite `npm run test:proto` · single proto file `node --test proto/redesign-2026-07/js/<name>.test.mjs`
- **PowerShell note:** Jest writes its summary to stderr; PowerShell 5.1 wraps that in a red `NativeCommandError` even on a fully passing run. Read the `Tests:` line, not the colour. Do not add `2>&1`.
- **Not in this plan:** the athlete-owned proof ledger (spec §4.1), full GDPR export, and multi-org surfacing. Each gets its own plan.

## File Structure

**Create**
- `supabase/functions/_shared/escalation-copy.ts` — pure decline-copy decision for the `flag_for_coach` path. Follows the existing `_shared/activity-copy.ts` / `_shared/meal-opener.ts` pattern.
- `supabase/functions/_shared/escalation-copy.test.ts` — Jest, pure.
- `supabase/migrations/0176_solo_record.sql` — two `profiles` columns.
- `proto/redesign-2026-07/js/solo-record.js` — pure planner: the Home record line, the connect-offer decision, and its copy. No DOM, no imports from `state.js`.
- `proto/redesign-2026-07/js/solo-record.test.mjs` — `node:test`, pure.
- `src/core/soloMilestoneSolo.test.ts` — regression: milestones fire with no coach.

**Modify**
- `supabase/functions/meal-chat/index.ts:432-467` — resolve the recipient before composing the decline.
- `proto/redesign-2026-07/js/screens/meal.js:1389` and `:864` — gate two coach claims.
- `proto/redesign-2026-07/js/screens/settings.js:291` — narrow the data-export claim.
- `proto/redesign-2026-07/js/ob2.js:373` — Individual tier blurb.
- `src/core/pricing.ts:47` — same blurb, kept in parity.
- `proto/redesign-2026-07/js/screens/ob2-athlete.js` — new meal-count step; `supporters` capture unchanged.
- `proto/redesign-2026-07/js/state.js` — persist `supporters`, hydrate/stamp the connect-offer marker, two `DEFAULT_RT` fields.
- `proto/redesign-2026-07/js/exec.js:16-21` — `mapPressure` accepts the onboarding vocabulary.
- `proto/redesign-2026-07/js/screens/settings.js:542-544` — pressure chips derive from saved state.
- `proto/redesign-2026-07/js/screens/connect.js:60` — disclose retroactive visibility.
- `proto/redesign-2026-07/js/screens/home.js` — render the record line and the connect-offer card.
- `proto/redesign-2026-07/js/notify-plan.js` — record-aware evening copy.

---

## Task 1: Honest escalation copy

The AI's `flag_for_coach` path tells every athlete *"I've flagged it for your coach so they can pick it up"* — including solo athletes, where the `team_members` lookup at `index.ts:452` runs **after** the message is already written at `:441` and finds nobody. This is the medical/injury safety hand-off, so the athlete must be told the truth about what will actually happen.

**Files:**
- Create: `supabase/functions/_shared/escalation-copy.ts`
- Create: `supabase/functions/_shared/escalation-copy.test.ts`
- Modify: `supabase/functions/meal-chat/index.ts:432-467`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `declineCopy(opts: { willNotify: boolean }): string` — exported from `_shared/escalation-copy.ts`. No later task depends on it.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/escalation-copy.test.ts`:

```ts
/**
 * The AI's decline must describe what will ACTUALLY happen. A solo athlete told "I've flagged it
 * for your coach" is told something false about a medical or injury question — the one place in
 * the product where a false promise has physical consequences.
 */
import { declineCopy } from './escalation-copy';

describe('declineCopy', () => {
  it('promises a coach ONLY when a coach will really be notified', () => {
    expect(declineCopy({ willNotify: true })).toContain('coach');
  });

  it('never mentions a coach when nobody will be notified', () => {
    expect(declineCopy({ willNotify: false }).toLowerCase()).not.toContain('coach');
  });

  it('never claims a hand-off happened when nobody will be notified', () => {
    const solo = declineCopy({ willNotify: false }).toLowerCase();
    expect(solo).not.toContain('flagged');
    expect(solo).not.toContain('passed it');
  });

  it('still declines, and points the solo athlete at a real kind of person', () => {
    const solo = declineCopy({ willNotify: false });
    expect(solo).toMatch(/not me|for a person/i);
    expect(solo.toLowerCase()).toMatch(/doctor|athletic trainer/);
  });

  it('both variants are non-empty and single-paragraph', () => {
    for (const willNotify of [true, false]) {
      const t = declineCopy({ willNotify });
      expect(t.length).toBeGreaterThan(20);
      expect(t).not.toContain('\n');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest supabase/functions/_shared/escalation-copy.test.ts`
Expected: FAIL — `Cannot find module './escalation-copy'`

- [ ] **Step 3: Write the minimal implementation**

Create `supabase/functions/_shared/escalation-copy.ts`:

```ts
/* The decline the athlete reads when the AI refuses a medical / injury / weight-cutting /
   disordered-eating question and hands it to a human.

   There are two truths to tell, and which one is true depends on whether anyone is actually
   listening. A solo athlete has no coach to receive the flag, and telling them one received it
   is the single most consequential false statement the product could make: they asked about an
   injury and were told a person is now handling it. Nobody is. */

export interface DeclineOpts {
  /** True only when a staff notification row will really be written for this athlete. */
  willNotify: boolean;
}

/** The athlete-facing decline text. Pure. */
export function declineCopy({ willNotify }: DeclineOpts): string {
  if (willNotify) {
    return "That one's for a person, not me. I've flagged it for your coach so they can pick it up.";
  }
  // No coach on this account. Decline just as firmly, promise nothing, and name the kind of
  // person who should actually answer it.
  return "That one's for a person, not me — a doctor or athletic trainer who knows your history. "
    + 'You have no coach connected here, so this stays between us until you connect one.';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest supabase/functions/_shared/escalation-copy.test.ts`
Expected: PASS — `Tests: 5 passed, 5 total`

- [ ] **Step 5: Reorder meal-chat so the recipient is known before the copy is written**

In `supabase/functions/meal-chat/index.ts`, add the import beside the other `_shared` imports at the top of the file:

```ts
import { declineCopy } from '../_shared/escalation-copy.ts';
```

Then replace lines 432–467 — from `if (tool?.name === 'flag_for_coach') {` through the closing `}` of the `if (withinFlagCap)` block — with:

```ts
    if (tool?.name === 'flag_for_coach') {
      const reason = String(tool.input?.reason ?? 'other').slice(0, 32);
      const note = String(tool.input?.note ?? '').replace(/—/g, ',').trim().slice(0, 300);

      // A jailbreak must not become a way to spam a coach: at most 3 flags per athlete per day.
      const { data: fclaim } = await service.rpc('claim_ai_usage_key', { p_key: `meal_flag:${mealRow.athlete_id}`, p_limit: 3 });
      const withinFlagCap = (Array.isArray(fclaim) ? fclaim[0] : fclaim)?.allowed !== false;

      // WHO IS LISTENING — resolved BEFORE the decline is composed. This lookup used to run after
      // the message was already written, so a solo athlete was told their coach had it while this
      // query was still returning nobody. On a medical question that is not a copy bug.
      let teamId: string | null = null;
      if (withinFlagCap) {
        const { data: tm } = await service.from('team_members')
          .select('team_id').eq('athlete_id', mealRow.athlete_id).eq('status', 'active').limit(1).maybeSingle();
        teamId = tm?.team_id ?? null;
      }
      const staffRows = teamId
        ? ((await service.from('team_staff').select('staff_id').eq('team_id', teamId).eq('status', 'active').limit(5)).data ?? []) as Array<{ staff_id: string }>
        : [];

      const declineText = declineCopy({ willNotify: staffRows.length > 0 });

      await service.from('meal_comments').insert({
        meal_id: mealId, athlete_id: mealRow.athlete_id, author_id: mealRow.athlete_id,
        role: 'ai', kind: 'message', text: declineText,
        meta: { t: 'escalated' },
      });

      let notified = false;
      const notifiedStaffIds: string[] = [];
      for (const st of staffRows) {
        await service.from('notifications').insert({
          user_id: st.staff_id, kind: `meal_flag:${mealId}`,
          title: 'An athlete asked something for you',
          body: note || 'They asked a question the AI would not answer.',
        });
        notified = true;
        notifiedStaffIds.push(st.staff_id);
      }
```

Leave everything from the `// PUSH — best-effort` comment (line 469) onward exactly as it is: `notifiedStaffIds` and `notified` keep the same names and meanings.

- [ ] **Step 6: Verify the existing escalation contract tests still pass**

`src/core/mealFlagEscalation.test.ts` asserts the deployed prompt and tool contract by reading `meal-chat/index.ts` as source text. It must still pass.

Run: `npx jest src/core/mealFlagEscalation.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full gate**

Run: `npm run lint:xss && npm run typecheck && npm run test && npm run test:proto`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add supabase/functions/_shared/escalation-copy.ts supabase/functions/_shared/escalation-copy.test.ts supabase/functions/meal-chat/index.ts
git commit -m "fix(meal-chat): stop telling coachless athletes their question reached a coach

The flag_for_coach decline promised a hand-off before the team_members
lookup ran, so a solo athlete asking about an injury was told a person
was handling it. Nobody was. Resolve the recipient first, then compose."
```

---

## Task 2: Gate the two remaining coach claims in the meal thread

`meal.js:1389` tells a rate-limited solo athlete *"Your coach still sees this."* `meal.js:864` heads a two-participant You+AI conversation *"Team Discussion."* This file already gates four other strings on `S.coach.hasCoach` (`:630`, `:840`, `:872`, `:1448`), so both fixes follow an established local idiom.

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/meal.js:864`, `:1389`

**Interfaces:**
- Consumes: `S.coach.hasCoach` (existing, `state.js`).
- Produces: nothing.

- [ ] **Step 1: Gate the rate-limit note**

Replace line 1389:

```js
          if (parsed && parsed.error === 'limit') setNote("You've hit today's AI coaching limit — back tomorrow. Your coach still sees this.");
```

with:

```js
          if (parsed && parsed.error === 'limit') setNote(S.coach.hasCoach
            ? "You've hit today's AI coaching limit — back tomorrow. Your coach still sees this."
            : "You've hit today's AI coaching limit — back tomorrow. This log is saved either way.");
```

- [ ] **Step 2: Gate the thread heading**

Replace line 864:

```js
      <span>Team Discussion</span>
```

with:

```js
      <span>${S.coach.hasCoach ? 'Team Discussion' : 'Discussion'}</span>
```

- [ ] **Step 3: Verify no other ungated coach claim remains in this file**

Run: `grep -n "your coach\|Your coach\|Team Discussion" proto/redesign-2026-07/js/screens/meal.js`
Expected: every remaining hit is either inside an `S.coach.hasCoach` ternary or inside a comment. Read each hit and confirm before continuing.

- [ ] **Step 4: Run the gate**

Run: `npm run lint:xss && npm run test:proto && npm run typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add proto/redesign-2026-07/js/screens/meal.js
git commit -m "fix(meal): stop promising a coach to athletes who have none

The AI rate-limit note claimed 'your coach still sees this' and the
two-person You+AI thread was headed 'Team Discussion'. Both now gate on
S.coach.hasCoach, matching the four strings already gated in this file."
```

---

## Task 3: Narrow the data-export claim and rewrite the Individual tier

`settings.js:291` claims *"You can download or delete everything, below."* The export ships 4 of ~15 tables and no media (`state.js:2437-2464`). Deletion **is** complete (`0007_delete_account.sql`), so only the download half overstates.

`ob2.js:373` sells the Individual tier on *"one connected supporter"* — to an athlete being steered there precisely because they have none. `src/core/obPlanPricingParity.test.ts` locks the **prices** to `src/core/pricing.ts`; the blurb text is changed in both files to keep them reading the same.

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/settings.js:291`
- Modify: `proto/redesign-2026-07/js/ob2.js:373`
- Modify: `src/core/pricing.ts:47`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Narrow the export claim**

Replace line 291 of `settings.js` (note the curly apostrophe is not in this line, but line 531 elsewhere in the file has one — do not touch that line):

```js
      <div class="ts">Nothing is public. Meal photos never leave your coach connection. You can download or delete everything, below.</div></div>
```

with:

```js
      <div class="ts">Nothing is public. Meal photos never leave your coach connection. You can delete everything, or download your profile, days, and meals, below.</div></div>
```

- [ ] **Step 2: Rewrite the Individual blurb in the proto catalog**

Replace line 373 of `proto/redesign-2026-07/js/ob2.js`:

```js
      sub: 'Daily Score, AI meal analysis, streaks, one connected supporter.' },
```

with:

```js
      sub: 'Daily Score, AI meal analysis, streaks, and your full record — yours to keep, and it follows you to any coach.' },
```

- [ ] **Step 3: Keep `src/core/pricing.ts` reading the same**

Replace line 47 of `src/core/pricing.ts`:

```ts
    blurb: 'Keep your history, score, AI coach, and daily game plan — on your own.' },
```

with:

```ts
    blurb: 'Your score, your AI coach, and your full record — yours to keep, and it follows you to any coach.' },
```

- [ ] **Step 4: Verify the pricing parity test still passes**

That test locks prices, not blurbs, so it must stay green after a copy-only change.

Run: `npx jest src/core/obPlanPricingParity.test.ts`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `npm run lint:xss && npm run typecheck && npm run test && npm run test:proto`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add proto/redesign-2026-07/js/screens/settings.js proto/redesign-2026-07/js/ob2.js src/core/pricing.ts
git commit -m "fix(copy): stop overstating the export, sell Individual on the record

Settings claimed you can download everything; the export ships 4 of ~15
tables and no media (deletion IS complete, so only the download half was
wrong). Individual sold 'one connected supporter' to athletes steered
there for having none — it now sells the portable record."
```

---

## Task 4: Migration 0176 — two `profiles` columns

There is no generic per-user flag store in this schema. The only precedent is a dedicated `profiles` column — `tour_seen_at`, added by `0165_tour_seen.sql`. Follow it exactly.

Two columns: the onboarding `supporters` answer (currently captured and discarded), and the connect-offer marker, which must be server-side so a reinstall or second device does not re-nag.

**Files:**
- Create: `supabase/migrations/0176_solo_record.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `profiles.solo_supporters text[]` and `profiles.solo_connect_offered_at timestamptz`, both self-writable through the existing `profiles_self_write` policy.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0176_solo_record.sql`:

```sql
-- 0176 — solo athlete record surfaces.
--
-- Two per-user facts the client needs and has nowhere to put. This schema has no generic
-- key/value flag table by design (0165's comment: a one-line device-local tip is not worth a
-- schema row apiece), so these follow the profiles.tour_seen_at precedent — a dedicated column
-- each, for a fact that must survive a reinstall.
--
-- solo_supporters: the onboarding "Who holds you to it?" answer. Already collected and, until
--   now, thrown away. An athlete who named a coach and then skipped the join code is a different
--   person from one who answered "Nobody yet", and the connect offer reads differently for each.
--
-- solo_connect_offered_at: when the connect offer was shown. Server-side deliberately —
--   RT.hadRoster is device-local, so today a reinstall silently re-arms the churn parachute.
--   A conversion card that re-fires on every new device is worse than one that never fires.
--
-- Both are self-scoped: the existing profiles_self_write policy already covers an athlete
-- writing their own row, and profiles_read already governs who may read it. No new policy.

alter table public.profiles
  add column if not exists solo_supporters text[],
  add column if not exists solo_connect_offered_at timestamptz;

comment on column public.profiles.solo_supporters is
  'Onboarding "Who holds you to it?" answer (coach|trainer|parents|teammates|nobody). Segments the connect offer.';
comment on column public.profiles.solo_connect_offered_at is
  'When the solo connect offer was shown. Server-side so a reinstall does not re-nag.';
```

- [ ] **Step 2: Verify it applies against a local stack**

Docker + local Supabase works in this repo (see the `item8b-quality-metrics` notes).

Run: `npx supabase db reset`
Expected: every migration through 0176 applies with no error.

If Docker is unavailable, verify syntax only and flag to the founder that 0176 is unapplied — **do not apply it to prod from this plan.** Applying to live prod is a separate, founder-gated step.

- [ ] **Step 3: Confirm the columns exist and are self-writable**

Run: `npx supabase db query --local "select column_name, data_type from information_schema.columns where table_name='profiles' and column_name in ('solo_supporters','solo_connect_offered_at');"`
Expected: two rows — `solo_supporters | ARRAY` and `solo_connect_offered_at | timestamp with time zone`.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add supabase/migrations/0176_solo_record.sql
git commit -m "feat(db): 0176 — solo_supporters + solo_connect_offered_at on profiles

Follows the 0165 tour_seen_at precedent (dedicated column, no generic
flag table). The connect-offer marker is server-side on purpose:
RT.hadRoster is device-local, so a reinstall re-arms it today."
```

---

## Task 5: Persist the `supporters` answer

`ob2-athlete.js:191` already captures `supporters` into `RT.ob`. It is read once for a line of copy at `:246` and never persisted — absent from `persistOnboarding` entirely. Task 10 needs it, and it needs to survive a reinstall.

**Files:**
- Modify: `proto/redesign-2026-07/js/state.js:2538-2547` (phase 2 of `persistOnboarding`)
- Create: `src/core/soloSupportersPersist.test.ts`

**Interfaces:**
- Consumes: `profiles.solo_supporters` (Task 4).
- Produces: `RT.profile.soloSupporters` — a `string[]`, hydrated on sign-in. Task 10 reads it.

- [ ] **Step 1: Write the failing test**

Create `src/core/soloSupportersPersist.test.ts`:

```ts
/**
 * The onboarding "Who holds you to it?" answer decides how the connect offer reads — an athlete
 * who named a coach and then skipped the join code already HAS one. It was collected and dropped
 * on the floor. These tests lock that it now reaches the profile write.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
  RT.userId = 'solo-1';
});

test('the supporters answer is folded into the profile fields that get written', () => {
  RT.ob = { supporters: ['coach', 'parents'] };
  expect(act._soloProfileFields(RT.ob)).toEqual({ solo_supporters: ['coach', 'parents'] });
});

test('"nobody yet" is a real answer and is persisted, not treated as empty', () => {
  RT.ob = { supporters: ['nobody'] };
  expect(act._soloProfileFields(RT.ob)).toEqual({ solo_supporters: ['nobody'] });
});

test('an unanswered step writes nothing at all (never an empty array)', () => {
  expect(act._soloProfileFields({})).toEqual({});
  expect(act._soloProfileFields({ supporters: [] })).toEqual({});
  expect(act._soloProfileFields(null)).toEqual({});
});

test('non-string junk is dropped rather than written through', () => {
  expect(act._soloProfileFields({ supporters: ['coach', 42, null, 'nobody'] }))
    .toEqual({ solo_supporters: ['coach', 'nobody'] });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/soloSupportersPersist.test.ts`
Expected: FAIL — `act._soloProfileFields is not a function`

- [ ] **Step 3: Add the pure helper and call it from phase 2**

In `proto/redesign-2026-07/js/state.js`, add this method to the `act` object immediately **above** `async persistOnboarding() {` (line 2511):

```js
  /* The solo-record profile fields derived from onboarding scratch. Pure and exported for test:
     the "Who holds you to it?" answer was collected and discarded, and it is what makes the
     connect offer read differently for an athlete who already named a coach. An unanswered step
     writes nothing — an empty array would be indistinguishable from "nobody", which is a real
     answer with different meaning. */
  _soloProfileFields(ob) {
    const list = (ob && Array.isArray(ob.supporters) ? ob.supporters : [])
      .filter((v) => typeof v === 'string' && v);
    return list.length ? { solo_supporters: list } : {};
  },
```

Then in phase 2 of `persistOnboarding`, replace lines 2539–2547:

```js
    if (!synced.extra) {
      if (!ob.dob && !ob.standard) synced.extra = true;
      else {
        const extra = {};
        if (ob.dob) extra.dob = ob.dob;
        if (ob.standard) extra.standard = ob.standard;
        synced.extra = await this.saveAthleteProfile(extra);
      }
    }
```

with:

```js
    if (!synced.extra) {
      if (!ob.dob && !ob.standard) synced.extra = true;
      else {
        const extra = {};
        if (ob.dob) extra.dob = ob.dob;
        if (ob.standard) extra.standard = ob.standard;
        synced.extra = await this.saveAthleteProfile(extra);
      }
    }
    // The supporters answer lives on `profiles`, not `athlete_profiles` — same table as the
    // connect-offer marker it feeds (0176). Best-effort: a pre-0176 database rejects this one
    // update and nothing else in onboarding is affected.
    const soloFields = this._soloProfileFields(ob);
    if (Object.keys(soloFields).length && sb && RT.userId) {
      try { await sb.from('profiles').update(soloFields).eq('id', RT.userId); }
      catch { /* pre-0176 DB or offline — the connect offer falls back to its unsegmented copy */ }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/soloSupportersPersist.test.ts`
Expected: PASS — `Tests: 4 passed, 4 total`

- [ ] **Step 5: Hydrate it back on sign-in**

Find the profile hydrate near `state.js:2733` (where `tour_seen_at` is read back). Add `solo_supporters` and `solo_connect_offered_at` to that same `select` column list, and assign:

```js
    RT.profile = { ...(RT.profile || {}), soloSupporters: row.solo_supporters || null };
    RT.soloConnectOfferedAt = row.solo_connect_offered_at || null;
```

Add the runtime field to `DEFAULT_RT`, immediately after line 236 (`keepRecordSeen`), matching the surrounding comment style:

```js
  soloConnectOfferedAt: null, // ISO when the solo connect offer was shown (server-backed, 0176) — survives a reinstall
```

- [ ] **Step 6: Run the gate**

Run: `npm run lint:xss && npm run typecheck && npm run test && npm run test:proto`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add proto/redesign-2026-07/js/state.js src/core/soloSupportersPersist.test.ts
git commit -m "feat(onboarding): persist the supporters answer instead of discarding it

'Who holds you to it?' was captured into RT.ob, read once for a line of
copy, and never written anywhere. An athlete who named a coach and then
skipped the join code already has one — that is the segmentation the
connect offer needs."
```

---

## Task 6: Ask for the meal count

`ob2-athlete.js:312` hardcodes `mealsPerDay` to the literal `3` for every athlete. The chip that used to set it lives only in the legacy flows OB2 never runs, and `stdFromSolo`'s docstring still describes it. An athlete authoring their own standard is the premise of the solo product.

The new step writes `standard.mealsPerDay`, which the existing commit step at `:312` already reads and phase 2 of `persistOnboarding` already writes.

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/ob2-athlete.js` (new step before `commit-q`)
- Create: `src/core/soloMealCountStep.test.ts`

**Interfaces:**
- Consumes: `chipRow` (existing, `ob2.js:212`), `capture` (existing).
- Produces: `RT.ob.standard.mealsPerDay` as a number 2–5. `stdFromSolo` (`requirements.js:249`) already consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/core/soloMealCountStep.test.ts`:

```ts
/**
 * The solo athlete's own meal count must reach the scored day. It was hardcoded to 3 — the
 * onboarding chip that set it was deleted, but stdFromSolo still expected it, so every solo
 * athlete was silently scored against a number they never chose.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { dayStandard } = require('../../proto/redesign-2026-07/js/day.js');

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
  RT.userId = 'solo-1';
  RT.activationDate = '2026-08-01T09:00:00.000Z';
  RT.reqSets = null;
});

test('a chosen 2-meal standard governs the scored day', () => {
  RT.profile = { standard: { mealsPerDay: 2 } };
  act._applyStandardFromSets();
  expect(dayStandard().mealsRequired).toBe(2);
});

test('a chosen 5-meal standard governs the scored day', () => {
  RT.profile = { standard: { mealsPerDay: 5 } };
  act._applyStandardFromSets();
  expect(dayStandard().mealsRequired).toBe(5);
});

test('no answer still resolves to a working day rather than an unscored one', () => {
  RT.profile = { standard: { mealsPerDay: 3 } };
  act._applyStandardFromSets();
  expect(dayStandard().mealsRequired).toBe(3);
});
```

- [ ] **Step 2: Run the test to verify it passes already**

Run: `npx jest src/core/soloMealCountStep.test.ts`
Expected: PASS. This is deliberate — the wiring works; what is missing is the screen that lets the athlete choose. These tests are the regression floor for the step you are about to add.

- [ ] **Step 3: Add the step**

In `proto/redesign-2026-07/js/screens/ob2-athlete.js`, insert this step object immediately **before** the `commit-q` step (which opens at line 277 with `/* ===== ch3 · Commit ===== */`). Place it after the `rate` step's closing `},`:

```js
  {
    id: 'meals', ch: 2, cta: 'Next',
    title: () => 'How many meals a day are you holding yourself to?',
    sub: () => 'This is your denominator — the score asks whether you hit this, not somebody else’s number. Change it any time.',
    body: () => chipRow('mealsPerDay', [
      { v: '2', t: '2 meals' }, { v: '3', t: '3 meals' }, { v: '4', t: '4 meals' }, { v: '5', t: '5 meals' },
    ]),
    /* chipRow writes RT.ob.mealsPerDay as a STRING at the top level; stdFromSolo reads a NUMBER
       at standard.mealsPerDay. Mirror it into standard{} here so the commit step at the end of
       ch3 (which spreads o.standard) and persistOnboarding phase 2 both carry it unchanged. */
    mount(root) {
      const grid = root.querySelector('[data-obkey="mealsPerDay"]');
      if (!grid) return;
      grid.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-val]');
        if (!chip) return;
        const n = Number(chip.getAttribute('data-val'));
        if (!(n >= 2 && n <= 5)) return;
        capture({ standard: { ...((RT.ob || {}).standard || {}), mealsPerDay: n } });
      });
    },
  },
```

- [ ] **Step 4: Confirm the commit step now carries a real answer**

Line 312 reads `(o.standard && o.standard.mealsPerDay) || 3`. With the step above it, a chosen value flows through and `3` becomes the genuine no-answer fallback rather than the only possible value. **Do not change line 312** — the fallback is correct.

Run: `grep -n "mealsPerDay" proto/redesign-2026-07/js/screens/ob2-athlete.js`
Expected: a hit in the new step's `chipRow` and `mount`, plus the existing `:312` fallback.

- [ ] **Step 5: Update the stale docstring**

In `proto/redesign-2026-07/js/requirements.js`, replace in the `stdFromSolo` doc comment:

```js
 *  standard → the same scored-day shape a coach standard produces. v1 configures only the meal
 *  count (onboarding's 2/3/4 chip); windows and titles fall back to the classic day.
```

with:

```js
 *  standard → the same scored-day shape a coach standard produces. v1 configures only the meal
 *  count (onboarding's `meals` step, 2–5); windows and titles fall back to the classic day.
```

If the surrounding wording differs slightly, match the file — the requirement is that it no longer describes a "2/3/4 chip" that does not exist.

- [ ] **Step 6: Run the gate**

Run: `npm run lint:xss && npm run typecheck && npm run test && npm run test:proto`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add proto/redesign-2026-07/js/screens/ob2-athlete.js proto/redesign-2026-07/js/requirements.js src/core/soloMealCountStep.test.ts
git commit -m "feat(onboarding): ask the solo athlete for their meal count

It was hardcoded to 3. The chip that set it lives only in the legacy
flows OB2 never runs, so every solo athlete was scored against a
denominator they never chose — in the one product whose premise is that
the athlete authors their own standard."
```

---

## Task 7: Make the intensity dial actually turn

`ob2-athlete.js:282-284` writes `pressure` as `all-in` | `steady` | `building`. `mapPressure` (`exec.js:16-21`) matches `gentl`/`support`/`max`/`intens`/`high`. **No onboarding value matches either branch**, so all three collapse to `accountable`. Settings writes a third vocabulary — chip *label text* — and its chip row hardcodes `on` to "Direct" rather than deriving from saved state.

With a coach this is cosmetic. Solo, scheduled notifications are the accountability mechanism.

**Files:**
- Modify: `proto/redesign-2026-07/js/exec.js:12-21`
- Modify: `proto/redesign-2026-07/js/screens/settings.js:542-544`
- Create: `src/core/pressureVocabulary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mapPressure(label)` unchanged in signature, now total over all three vocabularies.

- [ ] **Step 1: Write the failing test**

Create `src/core/pressureVocabulary.test.ts`:

```ts
/**
 * Three vocabularies write the same field. Onboarding writes slugs (all-in/steady/building),
 * Settings writes chip label text (Supportive/Direct/Intense), and legacy wrote knob labels.
 * mapPressure matched only the last two, so every onboarding answer collapsed to 'accountable'
 * and the intensity an athlete picked at signup did nothing. Solo, notifications ARE the
 * accountability, so this is the dial.
 */
// @ts-ignore — proto is plain ESM JS (allowJs), same pattern as exec.test.ts
import { mapPressure } from '../../proto/redesign-2026-07/js/exec.js';

describe('the onboarding slugs (ob2-athlete.js commit-q)', () => {
  it('all-in is maximum pressure', () => expect(mapPressure('all-in')).toBe('max'));
  it('building is gentle', () => expect(mapPressure('building')).toBe('gentle'));
  it('steady is the middle', () => expect(mapPressure('steady')).toBe('accountable'));
});

describe('the settings chip labels (settings.js ns-pressure)', () => {
  it('Supportive is gentle', () => expect(mapPressure('Supportive')).toBe('gentle'));
  it('Intense is maximum', () => expect(mapPressure('Intense')).toBe('max'));
  it('Direct is the middle', () => expect(mapPressure('Direct')).toBe('accountable'));
});

describe('the legacy knob labels still map', () => {
  it('Remind me gently', () => expect(mapPressure('Remind me gently')).toBe('gentle'));
  it('High accountability', () => expect(mapPressure('High accountability')).toBe('max'));
  it('Max pressure', () => expect(mapPressure('Max pressure')).toBe('max'));
  it('Hold me accountable', () => expect(mapPressure('Hold me accountable')).toBe('accountable'));
});

describe('the three vocabularies agree with each other', () => {
  it('every tier has one representative per vocabulary and they match', () => {
    expect(new Set(['all-in', 'Intense', 'Max pressure'].map(mapPressure)).size).toBe(1);
    expect(new Set(['building', 'Supportive', 'Remind me gently'].map(mapPressure)).size).toBe(1);
    expect(new Set(['steady', 'Direct', 'Hold me accountable'].map(mapPressure)).size).toBe(1);
  });
  it('unknown and empty input still falls back to the middle, never throws', () => {
    expect(mapPressure('')).toBe('accountable');
    expect(mapPressure(null)).toBe('accountable');
    expect(mapPressure(undefined)).toBe('accountable');
    expect(mapPressure('some future label')).toBe('accountable');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/core/pressureVocabulary.test.ts`
Expected: FAIL — `all-in` returns `'accountable'`, expected `'max'`; `building` returns `'accountable'`, expected `'gentle'`.

- [ ] **Step 3: Make `mapPressure` total**

Replace `exec.js` lines 12–21:

```js
/** Tone display string → engine pressure value. Accepts the onboarding knob labels
 *  ("Remind me gently" / "Hold me accountable" / "High accountability", plus legacy "Max
 *  pressure") and the notification-settings tone names (Supportive / Direct / Intense — spec
 *  §13.3). Tone changes wording only. */
export function mapPressure(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('gentl') || s.includes('support')) return 'gentle';
  if (s.includes('max') || s.includes('intens') || s.includes('high')) return 'max';
  return 'accountable';
}
```

with:

```js
/** Tone display string → engine pressure value. THREE vocabularies write this one field and all
 *  three must land here:
 *    1. onboarding slugs   — 'all-in' | 'steady' | 'building'   (ob2-athlete.js commit-q)
 *    2. settings chip text — 'Supportive' | 'Direct' | 'Intense' (settings.js #ns-pressure)
 *    3. legacy knob labels — 'Remind me gently' / 'Hold me accountable' / 'High accountability'
 *  The slugs matched nothing until 2026-08-01, so every athlete's onboarding answer silently
 *  collapsed to 'accountable'. That is cosmetic for a coached athlete and is the entire
 *  accountability dial for a solo one. Tone changes wording only, never the schedule. */
export function mapPressure(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('gentl') || s.includes('support') || s.includes('building')) return 'gentle';
  if (s.includes('max') || s.includes('intens') || s.includes('high') || s.includes('all-in')) return 'max';
  return 'accountable';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/core/pressureVocabulary.test.ts`
Expected: PASS — `Tests: 12 passed, 12 total`

- [ ] **Step 5: Derive the settings chips from saved state**

`settings.js:543` hardcodes `on` onto "Direct", so the row shows Direct before `wirePressure` corrects it on mount. Replace lines 542–544:

```js
    <div class="chip-row" id="ns-pressure" data-toggle-group>
      <span class="chp">Supportive</span><span class="chp on">Direct</span><span class="chp">Intense</span>
    </div>
```

with:

```js
    <div class="chip-row" id="ns-pressure" data-toggle-group>
      ${[['Supportive', 'gentle'], ['Direct', 'accountable'], ['Intense', 'max']]
        .map(([t, v]) => `<span class="chp ${mapPressure((RT.ob && RT.ob.standard && RT.ob.standard.pressure) || 'Hold me accountable') === v ? 'on' : ''}">${t}</span>`).join('')}
    </div>
```

Confirm `mapPressure` is already imported in `settings.js` — `wirePressure` at `:21` uses it, so it is. If the import is missing, add it beside the other `../exec.js` imports.

- [ ] **Step 6: Verify the existing notification-plan tests still pass**

Changing the pressure mapping changes which copy variants the planner picks.

Run: `npx jest src/core/notifyPlan.test.ts && npm run test:proto`
Expected: PASS. If a notification test fails, read it — it may be asserting the old collapsed behaviour, in which case update the assertion and note it in the commit body. Do not weaken a test to make it pass.

- [ ] **Step 7: Run the gate**

Run: `npm run lint:xss && npm run typecheck && npm run test && npm run test:proto`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add proto/redesign-2026-07/js/exec.js proto/redesign-2026-07/js/screens/settings.js src/core/pressureVocabulary.test.ts
git commit -m "fix(exec): make mapPressure total over all three pressure vocabularies

Onboarding wrote all-in/steady/building; mapPressure matched none of
them, so every athlete's chosen intensity collapsed to 'accountable'.
Cosmetic with a coach. Solo, notifications ARE the accountability."
```

---

## Task 8: Disclose retroactive visibility at connect

`connect.js:60` lists what a coach will see, in the present tense. `can_view()` (`0081_guardian_scoped_access.sql:27-34`) has **no date predicate**, so joining hands over the entire prior history. This is the strongest sentence available and it is currently unsaid — in a product with minors in it.

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/connect.js:60`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the disclosure**

Replace line 60:

```js
        <div class="ts">${isTeam ? 'This coach will see your score, requirements, meal logs, and check-ins.' : 'This trainer will see your recovery, readiness, and nutrition consistency.'}</div></div>
```

with:

```js
        <div class="ts">${isTeam ? 'This coach will see your score, requirements, meal logs, and check-ins — including everything you have already logged, from your first day.' : 'This trainer will see your recovery, readiness, and nutrition consistency — including everything you have already logged, from your first day.'}</div></div>
```

- [ ] **Step 2: Confirm the claim is true against the live policy**

Run: `grep -n "joined_at\|created_at" supabase/migrations/0081_guardian_scoped_access.sql`
Expected: **no** date filter inside `can_view`. If a date predicate is ever added, this copy must change with it.

- [ ] **Step 3: Run the gate**

Run: `npm run lint:xss && npm run test:proto && npm run typecheck`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add proto/redesign-2026-07/js/screens/connect.js
git commit -m "feat(connect): disclose that joining shares the whole prior history

can_view() has no date predicate, so a coach sees everything back to day
one the moment a code is redeemed. That was undisclosed — and it is also
the most persuasive sentence on the screen."
```

---

## Task 9: The solo-record pure planner

Both new surfaces are decisions, not markup. They go in one pure module so they are testable without a DOM, matching the `tour-plan.js` planner / `tour.js` driver split.

**Files:**
- Create: `proto/redesign-2026-07/js/solo-record.js`
- Create: `proto/redesign-2026-07/js/solo-record.test.mjs`

**Interfaces:**
- Consumes: nothing (pure — the caller passes everything).
- Produces, all named exports of `solo-record.js`:
  - `RECORD_MIN_DAYS = 3` (number)
  - `recordLine({ scoredDays, streak, hasCoach }) → { headline: string, sub: string } | null`
  - `shouldOfferConnect({ scoredDays, streak, hasCoach, offeredAt, hadRoster }) → boolean`
  - `connectOffer({ supporters, scoredDays, streak }) → { headline: string, sub: string, pill: string }`
  Task 10 renders all four.

- [ ] **Step 1: Write the failing test**

Create `proto/redesign-2026-07/js/solo-record.test.mjs`:

```js
/* The solo athlete's record surfaces — pure decisions, no DOM.
 * Run: node --test proto/redesign-2026-07/js/solo-record.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_MIN_DAYS, recordLine, shouldOfferConnect, connectOffer } from './solo-record.js';

/* ---------------- recordLine ---------------- */

test('a thin record says nothing at all rather than a hollow zero', () => {
  assert.equal(recordLine({ scoredDays: 0, streak: 0, hasCoach: false }), null);
  assert.equal(recordLine({ scoredDays: 2, streak: 2, hasCoach: false }), null);
});

test('the floor is exactly RECORD_MIN_DAYS', () => {
  assert.equal(RECORD_MIN_DAYS, 3);
  assert.equal(recordLine({ scoredDays: 2, streak: 0, hasCoach: false }), null);
  assert.notEqual(recordLine({ scoredDays: 3, streak: 0, hasCoach: false }), null);
});

test('a coached athlete never gets it — the seen-receipt owns that slot', () => {
  assert.equal(recordLine({ scoredDays: 40, streak: 12, hasCoach: true }), null);
});

test('it states the real numbers and never invents any', () => {
  const r = recordLine({ scoredDays: 21, streak: 6, hasCoach: false });
  assert.match(r.headline, /21/);
  assert.match(r.sub, /6/);
});

test('a broken streak is simply not mentioned, never reported as zero', () => {
  const r = recordLine({ scoredDays: 21, streak: 0, hasCoach: false });
  assert.match(r.headline, /21/);
  assert.doesNotMatch(r.sub, /\b0\b/);
});

test('missing or unusable inputs never throw and never fabricate', () => {
  assert.equal(recordLine({}), null);
  assert.equal(recordLine({ scoredDays: null, streak: null, hasCoach: false }), null);
  assert.equal(recordLine({ scoredDays: NaN, streak: 3, hasCoach: false }), null);
});

/* ---------------- shouldOfferConnect ---------------- */

const BASE = { scoredDays: 20, streak: 8, hasCoach: false, offeredAt: null, hadRoster: false };

test('fires once the record is worth showing', () => {
  assert.equal(shouldOfferConnect(BASE), true);
});

test('either threshold alone is enough', () => {
  assert.equal(shouldOfferConnect({ ...BASE, scoredDays: 14, streak: 0 }), true);
  assert.equal(shouldOfferConnect({ ...BASE, scoredDays: 7, streak: 7 }), true);
});

test('below both thresholds it stays quiet', () => {
  assert.equal(shouldOfferConnect({ ...BASE, scoredDays: 6, streak: 6 }), false);
  assert.equal(shouldOfferConnect({ ...BASE, scoredDays: 13, streak: 0 }), false);
});

test('never to a coached athlete', () => {
  assert.equal(shouldOfferConnect({ ...BASE, hasCoach: true }), false);
});

test('never twice — the server marker wins across devices', () => {
  assert.equal(shouldOfferConnect({ ...BASE, offeredAt: '2026-07-30T10:00:00.000Z' }), false);
});

test('never to someone keepRecordCard already owns', () => {
  // hadRoster means they HAD a coach and lost one; that is a different card and a different pitch.
  assert.equal(shouldOfferConnect({ ...BASE, hadRoster: true }), false);
});

/* ---------------- connectOffer ---------------- */

test('an athlete who named a coach is treated as already having one', () => {
  const o = connectOffer({ supporters: ['coach'], scoredDays: 21, streak: 7 });
  assert.match(o.sub, /21/);
  assert.match(o.headline + o.sub, /coach/i);
});

test('"nobody yet" gets the record-first framing, not a "connect them" assumption', () => {
  const o = connectOffer({ supporters: ['nobody'], scoredDays: 21, streak: 7 });
  assert.doesNotMatch(o.sub, /connect them/i);
  assert.match(o.sub, /21/);
});

test('a missing answer still produces usable unsegmented copy', () => {
  for (const supporters of [null, undefined, []]) {
    const o = connectOffer({ supporters, scoredDays: 15, streak: 4 });
    assert.ok(o.headline.length > 0);
    assert.ok(o.sub.length > 0);
    assert.ok(o.pill.length > 0);
  }
});

test('every variant tells the truth about retroactive visibility', () => {
  for (const supporters of [['coach'], ['nobody'], []]) {
    const o = connectOffer({ supporters, scoredDays: 21, streak: 7 });
    assert.match(o.sub, /day one|from your first day|all of it/i);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test proto/redesign-2026-07/js/solo-record.test.mjs`
Expected: FAIL — `Cannot find module ... solo-record.js`

- [ ] **Step 3: Write the planner**

Create `proto/redesign-2026-07/js/solo-record.js`:

```js
/* OnStandard — the solo athlete's record surfaces (PURE; no DOM, no state import, no clock).
 *
 * A coachless athlete has no one opening their day, and Home's seen-receipt — the surface the
 * product calls its core differentiator — is structurally empty for them. What is NOT empty is
 * the record itself, which is the one thing a logging app cannot copy: it is athlete-owned
 * (days/meals are keyed to profiles(id) with no org column) and it transfers intact to any coach
 * they ever connect, back to day one, because can_view() has no date predicate.
 *
 * So the record is what speaks in that slot, and the record reaching a certain weight is what
 * earns the right to ask them to connect someone.
 *
 * Everything here is a decision returning data. home.js renders it — same planner/driver split as
 * tour-plan.js. That is what makes it testable without a browser, and what keeps a repaint from
 * being able to change what the athlete is told. */

/** Days below which the record says nothing at all. Three, not one: day one is unscored by design
 *  (activation.js grants full first-day grace), so a record only becomes a statement worth making
 *  once it has survived a day the athlete could have broken it. */
export const RECORD_MIN_DAYS = 3;

/** Conversion thresholds — either one alone is enough. */
const OFFER_DAYS = 14;
const OFFER_STREAK = 7;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/**
 * The line that fills Home's seen-receipt slot for an athlete with no coach.
 * Returns null whenever there is nothing true and worth saying — a thin record, or a coached
 * athlete, whose slot belongs to the real receipt.
 * @returns {{headline: string, sub: string} | null}
 */
export function recordLine({ scoredDays, streak, hasCoach } = {}) {
  if (hasCoach) return null;
  const days = num(scoredDays);
  const run = num(streak);
  if (days < RECORD_MIN_DAYS) return null;
  return {
    headline: `${days} ${days === 1 ? 'day' : 'days'} on record`,
    // A broken streak is not mentioned at all. Reporting "0-day streak" to someone who just lost
    // one is a punishment the record was never supposed to hand out.
    sub: run >= 2
      ? `${run} straight right now. This record is yours — it goes with you to any coach.`
      : 'This record is yours — it goes with you to any coach.',
  };
}

/**
 * Has the record become worth showing someone?
 * @returns {boolean}
 */
export function shouldOfferConnect({ scoredDays, streak, hasCoach, offeredAt, hadRoster } = {}) {
  if (hasCoach) return false;
  if (offeredAt) return false;   // server-backed: asked once, on any device
  if (hadRoster) return false;   // keepRecordCard owns the athlete who HAD a coach and lost one
  return num(scoredDays) >= OFFER_DAYS || num(streak) >= OFFER_STREAK;
}

/**
 * The offer's copy, segmented by the onboarding "Who holds you to it?" answer.
 * The claim every variant makes — a coach sees all of it, from day one — is true today and
 * requires no engineering: can_view() scopes by relationship, never by date.
 * @returns {{headline: string, sub: string, pill: string}}
 */
export function connectOffer({ supporters, scoredDays, streak } = {}) {
  const days = num(scoredDays);
  const list = Array.isArray(supporters) ? supporters : [];
  const named = list.some((s) => s === 'coach' || s === 'trainer' || s === 'parents');
  const proof = `${days} ${days === 1 ? 'day' : 'days'}`;

  // They told us at signup that they have someone — they just never had the code in hand.
  if (named) {
    return {
      headline: 'Ready to put this in front of them?',
      sub: `You said someone holds you to this. Connect them and they see all of it — ${proof}, from your first day, not from today.`,
      pill: 'Connect',
    };
  }
  return {
    headline: 'This is worth showing someone',
    sub: `${proof} on record. Whenever you connect a coach, they see all of it from day one — nothing starts over.`,
    pill: 'Find a coach',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test proto/redesign-2026-07/js/solo-record.test.mjs`
Expected: PASS — `pass 16 / fail 0`

- [ ] **Step 5: Run the whole proto suite**

Run: `npm run test:proto`
Expected: all pass, count increased by 16 over the previous run.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add proto/redesign-2026-07/js/solo-record.js proto/redesign-2026-07/js/solo-record.test.mjs
git commit -m "feat(solo): pure planner for the record line and the connect offer

Decisions only, no DOM — same planner/driver split as tour-plan.js, so a
repaint cannot change what the athlete is told and the thresholds are
testable without a browser."
```

---

## Task 10: Render both surfaces on Home

`home.js` renders what Task 9 decides. The record line fills `#seen-row` (`:646`), whose receipt paint at `:782-803` already returns early for a solo athlete because there are no receipts. The connect offer joins the existing `attention` priority ladder at `:622`, one rung below `keepRecordCard`.

**Files:**
- Modify: `proto/redesign-2026-07/js/screens/home.js`
- Modify: `proto/redesign-2026-07/js/state.js` (the offer marker setter)

**Interfaces:**
- Consumes: `recordLine`, `shouldOfferConnect`, `connectOffer`, `RECORD_MIN_DAYS` (Task 9); `RT.soloConnectOfferedAt`, `RT.profile.soloSupporters` (Task 5); `profiles.solo_connect_offered_at` (Task 4).
- Produces: `act.markSoloConnectOffered()` on `state.js`.

- [ ] **Step 1: Add the marker setter**

In `proto/redesign-2026-07/js/state.js`, add immediately after `markKeepRecordSeen()` (line 2196), matching its style:

```js
  /* The solo connect offer was shown — never ask again, on any device. Local first so the card
     cannot re-render this session, then best-effort to the server (0176). Mirrors markTourSeen. */
  markSoloConnectOffered() {
    if (RT.soloConnectOfferedAt) return;
    RT.soloConnectOfferedAt = new Date().toISOString();
    save();
    try {
      if (window.sb && RT.userId) {
        void window.sb.from('profiles').update({ solo_connect_offered_at: RT.soloConnectOfferedAt }).eq('id', RT.userId);
      }
    } catch { /* best-effort — the local marker still holds for this device */ }
  },
```

- [ ] **Step 2: Import the planner into home.js**

Add beside the other local imports at the top of `proto/redesign-2026-07/js/screens/home.js`:

```js
import { recordLine, shouldOfferConnect, connectOffer } from '../solo-record.js';
```

- [ ] **Step 3: Render the record line into `#seen-row`**

In `home.js` `mount(root)`, find the receipt block at `:782-803`. Add this **immediately before** `const seenRow = root.querySelector('#seen-row');`:

```js
    // SOLO: nobody opens this athlete's day, so the slot the receipt would own says what the
    // record itself has become. Painted synchronously — it reads state we already have, and a
    // fetch that fails must never be able to paint "0 days" here (see the {error:true} rule).
    const soloRow = root.querySelector('#seen-row');
    if (soloRow && !S.coach.hasCoach) {
      const line = recordLine({
        scoredDays: (DAY.scoreHistory || []).length,
        streak: S.streak && typeof S.streak.days === 'number' ? S.streak.days : 0,
        hasCoach: false,
      });
      if (line) {
        soloRow.innerHTML = `
          <div class="seen-receipt">
            <span class="sic">${icon('shield', 15)}</span>
            <span class="stx"><b>${esc(line.headline)}</b> ${esc(line.sub)}</span>
          </div>`;
      }
    }
```

Confirm `S.streak` exposes `.days`. Run `grep -n "streak" proto/redesign-2026-07/js/state.js | grep -n "get streak" -A 6`; if the shape differs, use whatever `S.streak` really provides and pass a number. If `S.streak` is itself a number, pass it directly.

- [ ] **Step 4: Add the offer to the attention ladder**

In `home.js`, add this function immediately after `keepRecordCard()` closes (line 260):

```js
/* The connect offer — keepRecordCard's never-linked sibling. That card catches the athlete whose
   roster ENDED; this one catches the athlete who never had one, at the point their own record
   became worth showing somebody. Mutually exclusive by construction: shouldOfferConnect() returns
   false whenever hadRoster is true, so the two can never both want the slot. */
function connectOfferCard() {
  if (!shouldOfferConnect({
    scoredDays: (DAY.scoreHistory || []).length,
    streak: S.streak && typeof S.streak.days === 'number' ? S.streak.days : 0,
    hasCoach: S.coach.hasCoach,
    offeredAt: RT.soloConnectOfferedAt,
    hadRoster: RT.hadRoster,
  })) return '';
  const o = connectOffer({
    supporters: (RT.profile && RT.profile.soloSupporters) || (RT.ob && RT.ob.supporters) || null,
    scoredDays: (DAY.scoreHistory || []).length,
    streak: S.streak && typeof S.streak.days === 'number' ? S.streak.days : 0,
  });
  return `<div class="lrow" id="solo-connect" style="margin:12px 0 10px;background:linear-gradient(100deg, rgba(var(--blue-rgb),0.10), rgba(var(--green-rgb),0.05));border:1px solid var(--blue-border);border-radius:14px;padding:12px 13px;cursor:pointer">
    <div class="xico sm blue">${icon('users', 16)}</div>
    <div class="xr"><div class="xa">${esc(o.headline)}</div>
    <div class="xb" style="white-space:normal;line-height:1.45">${esc(o.sub)}</div></div>
    <span class="xpill blue">${esc(o.pill)}</span>
  </div>`;
}
```

If `icon('users', 16)` is not a registered icon, run `grep -n "users\|people" proto/redesign-2026-07/js/icons.js` and substitute a real one — `shield` is a safe fallback already used by `keepRecordCard`.

- [ ] **Step 5: Join the ladder**

Replace line 622:

```js
    const attention = sync || injuryCard || keepRecordCard();
```

with:

```js
    // A sync problem or an injury outranks any conversion moment. keepRecordCard (roster ENDED)
    // outranks the solo offer (never had one) — a churned athlete is the more urgent of the two,
    // and shouldOfferConnect() already excludes them, so this order is belt and braces.
    const attention = sync || injuryCard || keepRecordCard() || connectOfferCard();
```

- [ ] **Step 6: Wire the tap**

In `home.js` `mount(root)`, immediately after the `#keep-record` handler (`:672-676`), add:

```js
    const soloConnect = root.querySelector('#solo-connect');
    if (soloConnect) soloConnect.addEventListener('click', () => {
      act.markSoloConnectOffered();
      if (window.__go) window.__go('connect'); else location.hash = '#connect';
    });
```

Note the destination is `connect`, not `paywall`: the offer's whole pitch is connecting a human, and sending them to a purchase screen instead would be exactly the kind of thing this spec exists to remove.

- [ ] **Step 7: Verify the card cannot replay**

`__render()` re-runs `mount()`. The offer is guarded by `RT.soloConnectOfferedAt`, which `markSoloConnectOffered()` sets locally **before** any await, so a repaint immediately after a tap cannot re-show it.

Run: `npm run test:proto && npx jest src/core/soloSupportersPersist.test.ts`
Expected: PASS

- [ ] **Step 8: Run the gate**

Run: `npm run lint:xss && npm run typecheck && npm run test && npm run test:proto`
Expected: all green. `lint:xss` matters here — both new surfaces interpolate into `innerHTML` and every value is wrapped in `esc()`.

- [ ] **Step 9: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add proto/redesign-2026-07/js/screens/home.js proto/redesign-2026-07/js/state.js
git commit -m "feat(home): the record line and the connect offer for solo athletes

The seen-receipt slot is structurally empty without a coach, so the
record speaks there instead. Once it is worth showing — 14 scored days
or a 7-day streak — the offer asks them to connect someone, once, with
the true pitch that a coach sees all of it from day one."
```

---

## Task 11: Record-aware evening reminders

`notify-plan.js` is a pure planner that already runs solo and already treats `coachName` as optional (`:121`, `:131`). Solo, these notifications are the accountability mechanism, so the evening beat should carry what the athlete stands to break.

**Files:**
- Modify: `proto/redesign-2026-07/js/notify-plan.js`
- Modify: `proto/redesign-2026-07/js/state.js:1291` (the call site that supplies `coachName`)
- Create: `proto/redesign-2026-07/js/notify-record.test.mjs`

**Interfaces:**
- Consumes: `planNotifications` (existing).
- Produces: `planNotifications` gains one optional param, `streak = 0` — already in its signature at `:214`, so this task only makes the copy use it.

- [ ] **Step 1: Write the failing test**

Create `proto/redesign-2026-07/js/notify-record.test.mjs`:

```js
/* Solo accountability rides entirely on these notifications — there is no coach beat.
 * Run: node --test proto/redesign-2026-07/js/notify-record.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNotifications } from './notify-plan.js';

const REQS = [{ id: 'recovery', title: 'Check-in', proof: 'check', reminder: true, impact: 'high', window: [1080, 1380] }];

function plan(over = {}) {
  return planNotifications({
    nowMin: 1100, dateISO: '2026-08-01', reqs: REQS,
    prefs: { enabled: true }, coachName: null, streak: 0, ...over,
  });
}

test('a real run is named in the evening copy when there is no coach', () => {
  const withRun = plan({ streak: 11 }).map((n) => `${n.title} ${n.body}`).join(' ');
  assert.match(withRun, /11/);
});

test('no run means no invented number', () => {
  const none = plan({ streak: 0 }).map((n) => `${n.title} ${n.body}`).join(' ');
  assert.doesNotMatch(none, /\b0\b/);
});

test('a coached athlete still gets the coach line, not the streak line', () => {
  const coached = plan({ streak: 11, coachName: 'Coach Ruiz' }).map((n) => `${n.title} ${n.body}`).join(' ');
  assert.match(coached, /Coach Ruiz/);
});

test('the plan is still a well-formed plan in every case', () => {
  for (const over of [{ streak: 0 }, { streak: 11 }, { streak: 11, coachName: 'Coach Ruiz' }]) {
    for (const n of plan(over)) {
      assert.equal(typeof n.title, 'string');
      assert.equal(typeof n.body, 'string');
      assert.ok(n.title.length > 0 && n.body.length > 0);
    }
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test proto/redesign-2026-07/js/notify-record.test.mjs`
Expected: FAIL on the first case — the streak is not mentioned.

- [ ] **Step 3: Make the evening copy record-aware**

In `notify-plan.js`, replace the `recovery.soon` first variant (line 121):

```js
      (c) => ({ title: 'Tonight’s check-in', body: `20 seconds before you sleep${c.coach ? ` — ${c.coach} reads it before practice` : ''}.` }),
```

with:

```js
      // With a coach, the coach is the stake. Without one, the record is — so name the run the
      // athlete is about to extend or break. Never "0 days": a broken run is not a threat to make.
      (c) => ({ title: 'Tonight’s check-in', body: `20 seconds before you sleep${c.coach ? ` — ${c.coach} reads it before practice` : (c.streak >= 2 ? ` — ${c.streak} straight days ride on it` : '')}.` }),
```

Then confirm `streak` reaches the copy context object `c`. Find where the context passed to these variant functions is built (search for `coach:` within `notify-plan.js`) and add `streak` alongside it:

```js
    streak: typeof streak === 'number' && streak > 0 ? streak : 0,
```

`streak` is already a destructured parameter of `planNotifications` at line 214, so no signature change is needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test proto/redesign-2026-07/js/notify-record.test.mjs`
Expected: PASS — `pass 4 / fail 0`

- [ ] **Step 5: Confirm the call site already supplies the streak**

Run: `grep -n "planNotifications(" proto/redesign-2026-07/js/exec.js proto/redesign-2026-07/js/state.js`
Read each call. If `streak` is not passed, add it from the same source Home uses (`S.streak.days`). If it is already passed, change nothing.

- [ ] **Step 6: Run the gate**

Run: `npm run lint:xss && npm run typecheck && npm run test && npm run test:proto`
Expected: all green. `src/core/notifyPlan.test.ts` must still pass — if a copy assertion breaks, read it and update the expected string to the new copy. Do not weaken the assertion.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add proto/redesign-2026-07/js/notify-plan.js proto/redesign-2026-07/js/notify-record.test.mjs proto/redesign-2026-07/js/state.js
git commit -m "feat(notify): name the run in the evening beat when there is no coach

With a coach, the coach is the stake. Without one the record is, and
these notifications are the whole accountability mechanism. Never
mentions a broken run — '0 days' is not a threat worth making."
```

---

## Task 12: Lock in that milestones already work solo

`maybeShowLock` (`js/lock-moment.js`) already fires 7/30/100 milestones off `DAY.scoreHistory` with `THRESH = 80`, guarded by `RT.lastLockSeen` (per day) and `RT.lastMilestone` (per milestone). It reads **nothing** coach-related, so it works for a solo athlete today.

Nothing asserts that. A future coach-gating change would silently take the solo athlete's only celebration away, and §2 of the spec leans on it. This task adds the guard and builds nothing.

**Files:**
- Create: `src/core/soloMilestoneSolo.test.ts`

**Interfaces:**
- Consumes: `maybeShowLock` (existing).
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `src/core/soloMilestoneSolo.test.ts`:

```ts
/**
 * The lock stamp and its 7/30/100 milestones are a solo athlete's only celebration — there is no
 * coach to say anything. maybeShowLock reads DAY.scoreHistory and nothing coach-related, so it
 * works today; nothing asserted that, and a future coach-gate would silently remove the one
 * moment the record-as-witness design leans on.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;

/* eslint-disable @typescript-eslint/no-var-requires */
const { RT, act } = require('../../proto/redesign-2026-07/js/state.js');
const { DAY, dayResetLocal, addDaysISO } = require('../../proto/redesign-2026-07/js/day.js');
const { maybeShowLock } = require('../../proto/redesign-2026-07/js/lock-moment.js');

function isoAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  dom.window.localStorage.clear();
  act._wipeUserScopedState();
  RT.userId = 'solo-1';
  RT.myCoach = null;
  RT.myTrainer = null;
  document.body.innerHTML = '';
  dayResetLocal();
  DAY.date = isoAgo(0);
  DAY.scoreHistory = [{ date: addDaysISO(DAY.date, -1), score: 92 }];
});

test('the lock stamp shows for an athlete with no coach and no trainer', () => {
  expect(maybeShowLock(5)).toBe(true);
  expect(document.querySelector('.lockstamp')).not.toBeNull();
});

test('it fires once per locked day, not on every repaint', () => {
  expect(maybeShowLock(5)).toBe(true);
  document.body.innerHTML = '';
  expect(maybeShowLock(5)).toBe(false);
});

test('a milestone run gets the milestone treatment, with no coach present', () => {
  expect(maybeShowLock(7)).toBe(true);
  expect(document.querySelector('.lockstamp.milestone')).not.toBeNull();
});

test('nothing is claimed when yesterday has no provable row', () => {
  DAY.scoreHistory = [];
  expect(maybeShowLock(5)).toBe(false);
  expect(document.querySelector('.lockstamp')).toBeNull();
});

test('a sub-threshold day is never celebrated', () => {
  DAY.scoreHistory = [{ date: addDaysISO(DAY.date, -1), score: 61 }];
  expect(maybeShowLock(5)).toBe(false);
});
```

- [ ] **Step 2: Run it**

Run: `npx jest src/core/soloMilestoneSolo.test.ts`
Expected: PASS — `Tests: 5 passed, 5 total`

If `maybeShowLock` needs a global the jsdom bootstrap does not provide (it imports `motion.js`, `review-ask.js`, and `analytics.js`), add the missing global to the bootstrap block rather than mocking the module — the point of the test is that the real module works untouched.

- [ ] **Step 3: Run the full gate**

Run: `npm run lint:xss && npm run typecheck && npm run test && npm run test:proto`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add src/core/soloMilestoneSolo.test.ts
git commit -m "test(solo): lock in that the milestone stamp works without a coach

maybeShowLock already reads nothing coach-related, so 7/30/100 fire for
a solo athlete today — and nothing asserted it. This is the only
celebration a coachless athlete gets."
```

---

## Shipping note (not a task)

None of this reaches a device until `assets/proto.zip` is rebuilt and committed — **the OTA ships the zip, not the loose proto files**, and `eas update` skips preflight, so shipping a stale zip ships nothing. Migration 0176 must be applied to prod before the connect offer or the supporters write can persist; until then both degrade honestly (the offer falls back to device-local marking and unsegmented copy). Applying to prod is founder-gated and out of this plan.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §1 escalation decline | 1 |
| §1 rate-limit + "Team Discussion" | 2 |
| §1 export claim; §5 Individual tier | 3 |
| §1.1 meal count asked | 6 |
| §1.2 supporters persisted | 4, 5 |
| §1.3 pressure vocabulary | 7 |
| §2.1 Home record line | 9, 10 |
| §2.2 milestones | 12 (already built — regression only) |
| §2.3 record-aware reminders | 11 |
| §3.1–3.5 conversion card | 9, 10 |
| §3.4 server-side seen state | 4, 10 |
| §4.2 connect disclosure | 8 |
| §4.1 proof ledger | **Deferred to its own plan** (stated in Global Constraints) |
| §6 testing | Every task; the `{error:true}` rule is a Global Constraint and is exercised in Task 9's null cases |

**Placeholder scan:** No TBD/TODO. Every code step carries real code. Three steps (9's `S.streak` shape, 10's `icon('users')`, 11's context object) instruct the engineer to verify a real detail and give an explicit fallback rather than guessing — these are verification steps, not placeholders.

**Type consistency:** `recordLine`/`shouldOfferConnect`/`connectOffer` keep identical parameter names and shapes between Task 9's definitions and Task 10's call sites. `RECORD_MIN_DAYS = 3` matches the spec's pinned floor. `declineCopy({willNotify})` is defined and consumed only in Task 1. `act.markSoloConnectOffered()` is defined in Task 10 Step 1 and called in Task 10 Step 6. `RT.soloConnectOfferedAt` is declared in Task 5 Step 5 and read in Tasks 9/10. `profiles.solo_supporters` / `solo_connect_offered_at` are created in Task 4 and used in Tasks 5 and 10.

**Ordering:** Task 4 (migration) precedes Task 5 (writes the column) and Task 10 (writes the marker). Task 9 (planner) precedes Task 10 (renders it). Tasks 1, 2, 3, 6, 7, 8 are independent and may run in any order.
