# Scoping Primitive — athlete → group → coach

**Date:** 2026-06-30 · **Status:** DESIGN (not yet built) · **Blocks:** position-group scoping (Phase 4),
strength/position-coach honesty, and every org-level roll-up (owner/AD). · **Builds on:**
`docs/founding/2026-06-30-role-architecture-redesign.md` (the 3-axis model), migrations `0011`
(`org_memberships`) / `0012` (`can_view` cutover) / `0013` (hardening).

## Why this is the keystone

The Role Review Board's most-damaging finding (Strength Coach = 3, Position Coach = 4) and the
"position-group lie" both trace to **one missing object**: there is no `group` between an athlete and
a coach. Today:

- Onboarding captures `posGroups` as generic keys (`skill`/`line`/`offense`) that **do not map** to a
  roster's real position codes (`LB`/`DB`/`DL`), so the answer can't be honored.
- `rosterGroups(roster)` derives groups by parsing `RosterRow.pos` — a display convenience, not an
  identity. A coach's "room" is a transient client-side filter that resets to "All."
- A head coach, a position coach, a strength coach, and a coordinator all see the **whole team**,
  because `can_view` is athlete-level (can this viewer see this athlete?) with no notion of *which
  slice* a coach owns.
- Owner/AD roll-ups are impossible: there is nothing to aggregate *by*.

A first-class `group` fixes all four at once, and it is the same object owner/AD roll-ups will read.
This is arch-fix #1 in the redesign spec.

## The model (additive — a new migration `0014`, no rewrite of `0012`)

Three tables + one scope flag. All RLS team-scoped like the rest of the schema.

> **Migration number:** the G1 `revoke_viewer` draft (`docs/specs/2026-06-29-g1-revoke-viewer.md`)
> also claims `0014`. Whichever lands first takes `0014`; sequence this as the next free number
> (likely `0015`). Both are unapplied today (live migrations end at `0013`).

```sql
-- 0014_groups.sql (DESIGN — validate on staging Postgres before applying; never apply live first)

-- A named slice of an org/team: a position room, a squad, a training group, a custom cohort.
create table groups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,                              -- "Linebackers", "Skill", "AM Group"
  kind            text not null default 'position'            -- position | squad | training | custom
                    check (kind in ('position','squad','training','custom')),
  created_at      timestamptz not null default now()
);

-- An athlete's membership in a group (an athlete can be in several: a position AND a training group).
create table group_members (
  group_id    uuid not null references groups(id) on delete cascade,
  athlete_id  uuid not null references auth.users(id) on delete cascade,
  status      link_status not null default 'active',          -- reuse the existing enum
  primary key (group_id, athlete_id)
);

-- Which groups a coach/staff member oversees, and HOW: a lens (sees all, defaults to this group) vs
-- a restriction (may ONLY see this group). This single flag is the difference between a head coach
-- and a position coach.
create table coach_groups (
  staff_id   uuid not null references auth.users(id) on delete cascade,
  group_id   uuid not null references groups(id) on delete cascade,
  scope      text not null default 'lens'                     -- lens | restricted
               check (scope in ('lens','restricted')),
  primary key (staff_id, group_id)
);
```

### How `can_view` changes (the one careful part)

`can_view(athlete)` stays the **upper bound** of visibility (the `0012`/`0013` predicate is
unchanged). Group scope is applied as a **narrowing**, two flavors:

- **`lens` (head coach / coordinator):** `can_view` is unchanged — they still see the whole team.
  The group is only a **default filter** in the UI (their room first, "All" one tap away). No
  migration risk: this is purely client-side default state.
- **`restricted` (position-only / strength coach who must not see other rooms):** add a predicate so
  a restricted coach can see an athlete **only** if they share a group:

  ```sql
  -- A restricted staffer sees an athlete only through a shared active group.
  create or replace function shares_group_with(target uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from coach_groups cg
      join group_members gm on gm.group_id = cg.group_id and gm.status = 'active'
      where cg.staff_id = auth.uid() and cg.scope = 'restricted' and gm.athlete_id = target
    );
  $$;
  -- can_view gains:  ... OR (is_restricted(auth.uid()) AND shares_group_with(athlete))
  -- and a restricted staffer's team-wide branch is gated off. Validate equivalence like 0012's A6.
  ```

  This carries the same equivalence-check discipline as the `0012` cutover (RUNBOOK Section A6): prove
  on staging that a restricted coach gains exactly their group and loses the rest, and a lens coach is
  unchanged, before live.

## Onboarding → real groups (closing the lie)

Replace the free-floating `posGroups` keys with **real group creation at setup**:

1. A Coach's onboarding "Position groups you coach" step **creates `groups` rows** under their org and
   **`coach_groups` rows** linking them (default `scope = 'lens'`; a "I only coach this room" toggle
   sets `restricted`).
2. When an athlete joins via the team code, they pick / are assigned their position, which creates a
   `group_members` row in the matching group. (The athlete's `position` field already exists; it
   becomes the seed for group assignment instead of a display string.)
3. The roster query returns each athlete's `group_id`(s); `RosterRow` gains an optional `groupId`.

Now "Linebackers" is an identity a coach owns, not a substring of `pos`.

## Client changes (small, once the data exists)

- `RosterRow` gains `groupId?: string`; `rosterGroups()` reads real groups when present, falls back to
  the `pos`-parse for the seeded demo (so the demo is unchanged and never shows a fabricated room).
- The coach roster/dashboard **defaults its filter to the coach's group(s)** (`coach_groups`), with an
  explicit "All / whole team" chip for `lens` coaches. A `restricted` coach simply never receives the
  other rows.
- `readinessSummary()` and the Risk Engine (`attention.ts`) get scoped to the active group for free —
  they already take a row list; pass the filtered list.
- New persisted store field `coachGroupId: string | null` so the chosen room sticks across sessions.

## Honest phasing (no fabrication, verify-green at each step)

1. **Migration `0014` (additive tables only)** — `groups`/`group_members`/`coach_groups`. Changes no
   behavior. Validate on staging.
2. **`lens` scoping (client-only)** — default the roster filter to the coach's group; "All" one tap.
   Ships with the backend off using real data when present, demo unchanged. No `can_view` change.
3. **`restricted` scoping (`can_view` narrowing)** — the `shares_group_with` predicate + equivalence
   check on staging (mirror RUNBOOK A6). This is the only step that touches the access boundary; it
   goes through the same staging-first gate as `0012`.
4. **Onboarding wiring** — create real groups + memberships at setup, replacing `posGroups` keys.
5. **Owner/AD roll-ups (V2)** — aggregate `groups` by org. The same object, no new model. Do not build
   for beta.

## Open decisions for the founder

- **Default scope:** should a position coach be `lens` (sees all, defaults to room) or `restricted`
  (room only)? Recommendation: **`lens` by default**, `restricted` opt-in — most HS staffs share the
  full roster, and `lens` carries zero migration risk. A college position coach who must be walled off
  flips one toggle.
- **Multi-group athletes:** an athlete in both a position group and a training group is supported by
  the `group_members` PK on `(group_id, athlete_id)`. Confirm that's the desired granularity before
  building the join UI.
