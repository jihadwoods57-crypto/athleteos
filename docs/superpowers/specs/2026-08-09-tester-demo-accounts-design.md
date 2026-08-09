# Per-tester demo accounts — design

**Date:** 2026-08-09
**Status:** approved, not yet implemented

## Problem

There is exactly one demo set on live prod today — `coach@` + `athlete1@` on team "Demo Varsity",
`trainer@` + `client1@` on practice "Rivera Performance", all sharing one password
([scripts/seed-demo-accounts.sql](../../../scripts/seed-demo-accounts.sql)). Ten beta testers
sharing those four accounts would overwrite each other's meals, scores, and rosters, and every
report would be uninterpretable.

Each tester needs their own isolated set, and needs to be able to get it without the founder
hand-delivering credentials ten times.

## Scope

Ten testers. Ten sets. Four accounts per set: coach, athlete, trainer, client — the same shape
that already works, so a tester can see both sides of every link. Forty new accounts, ten teams,
ten practices.

**Ten is a hard ceiling.** The eleventh visitor sees "all taken". Raising it means re-running the
seed with a larger N; it is deliberately not self-service.

The four existing demo accounts stay exactly as they are, on their current password. They remain
the founder's own demo and screenshot accounts.

### Out of scope

- A separate preview/test Supabase project (see `athleteos-test-project` — still owed, still the
  real fix)
- Seeded day history. Testers start from zero logged days, so they exercise the real logging flow
  from clean.
- A parent account per set. The seed has never created a parent link and that RPC path is untested.

## Decisions

| Question | Decision |
|---|---|
| Set contents | coach + athlete (own team), trainer + client (own practice) |
| Passwords | One per tester, shared across their four accounts; generated at run time, never in git |
| Existing four accounts | Untouched |
| Handoff | One shared link, self-claim, first-come |
| Identification | Name + email before reveal; email is also the recovery key |
| Count | 10, hard ceiling, no spares |

## Architecture

Four layers, built in this order. Each is useless until the one before it exists.

```
0195_tester_sets.sql          table + deny-all RLS
        ↓
seed-tester-accounts.sql      40 accounts, 10 teams, 10 practices, 10 handout rows
        ↓
functions/tester-claim        session-less API, URL-token gated, service-role
        ↓
web/landing/tester.html       the page the tester opens
```

### Layer 1 — migration `0195_tester_sets.sql`

One table:

```
tester_sets
  set_no              int primary key          -- 1..10
  password            text not null            -- plaintext, see the risk note
  email_coach         text not null
  email_athlete       text not null
  email_trainer       text not null
  email_client        text not null
  team_join_code      text
  practice_join_code  text
  claimed_at          timestamptz
  claimed_name        text
  claimed_email       text                     -- stored lowercased; unique where not null
  device_token        text                     -- random, matched against the browser's localStorage
  created_at          timestamptz not null default now()
```

RLS enabled with **no policies and no anon/authenticated grants** — the same deliberate shape as
0191's beta-board tables. Only the service role reads or writes it. A unique index on
`lower(claimed_email) where claimed_email is not null` makes re-claiming by the same email
impossible to duplicate at the DB level, not just in application logic.

Note the standing gotcha (`supabase-table-grants-gotcha`): a new table gets no grants by default.
That is the intent here — do **not** add `grant to authenticated`.

### Layer 2 — `scripts/seed-tester-accounts.sql`

Extends the method already proven in `seed-demo-accounts.sql`, wrapped in a `1..10` loop. Nothing
about the method changes; only the cardinality does.

Per tester `NN` (zero-padded):

- `tNN-coach@onstandard.app`, `tNN-athlete@onstandard.app`, `tNN-trainer@onstandard.app`,
  `tNN-client@onstandard.app`
- Coach creates a team; athlete joins it. Trainer creates a practice; client joins it.
- Distinct realistic person names and team/practice names, all declared in **one editable `values`
  table at the top of the file** so the whole cast can be changed in one place.

Non-negotiable steps carried over from the existing script, each of which has already cost an hour
once:

- Insert `auth.identities` alongside `auth.users`, or password sign-in fails outright.
- `coalesce` all **eight** text columns to `''`. GoTrue scans them into Go strings and a single
  NULL fails the entire schema query — every sign-in then returns *"Database error querying
  schema"*, which names nothing useful.
- Set `profiles.email_verified = true` (0176), or every account opens behind the "Verify your
  email" banner.
- Make links by calling the app's own RPCs while impersonating each user
  (`set_config('request.jwt.claim.sub', …)`), never by writing a link table by hand. If the RPC
  would reject it, the seed rejects it too.
- `create_team` has two overloads — call the **4-arg** one (0022). `create_practice` takes 3 args
  (0025). Both verified unchanged as of 0194.

Shape rules:

- Athlete = `base_goal = 'performance'` + a sport.
- Client = `base_goal = 'lose'` + **no** sport. `user_role` has no `client` value and must not gain
  one; the app derives the client experience from that profile shape.

Tagging: `raw_app_meta_data = {"demo": true, "tester": "03"}`.

Idempotent, and the ordering matters. `teams.created_by` / `practices.created_by` are
`ON DELETE SET NULL`, so deleting the users first orphans their teams beyond any way to identify
them — prod already carries several orphans from exactly this mistake ("Flow High", "Lincoln High",
"My Team", "WSU"). The teams and practices must therefore be deleted **by creator, before** the
users:

```sql
delete from teams     where created_by in (select id from auth.users where raw_app_meta_data ? 'tester');
delete from practices where created_by in (select id from auth.users where raw_app_meta_data ? 'tester');
delete from auth.users where raw_app_meta_data ? 'tester';
```

Deleting by creator rather than by name is what lets the team and practice names stay realistic and
freely editable — nothing downstream parses them.

Passwords enter as `__PW_01__` … `__PW_10__` placeholders, substituted at run time. **The
repository is public.** A committed password is a published authenticated foothold on the database
that holds real users' — including minors' — data, which is precisely the position from which RLS
gets probed (0147).

Final statement inserts the ten `tester_sets` rows — emails, password, and the join codes returned
by `create_team` / `create_practice` — and returns the full credential table for the operator.

### Layer 3 — `supabase/functions/tester-claim`

Modeled directly on `beta-board`: a session-less page, an anonymous browser holding a URL token, so
this function is the entire wall.

Four POST actions:

| Action | Input | Behavior |
|---|---|---|
| `resume` | device token | Returns that set. Refreshing never burns a new one. |
| `claim` | name, email | Email already holds a set → return it. Otherwise take the next free set atomically. All ten taken → `exhausted`. |
| `recover` | email | Returns that email's set, or 404. Covers "now I'm on my phone". |
| `status` | — | Founder-only, second key. Who claimed what, when. |

Assignment is one statement, so two testers tapping simultaneously cannot land on the same set:

```sql
update tester_sets
   set claimed_at = now(), claimed_name = $1, claimed_email = $2, device_token = $3
 where set_no = (select set_no from tester_sets
                  where claimed_at is null
                  order by set_no
                    for update skip locked
                  limit 1)
returning *;
```

Security:

- `?k=` constant-time compared against a `TESTER_CLAIM_KEY` secret; `status` additionally requires
  `TESTER_ADMIN_KEY`.
- `verify_jwt = false` pinned in `config.toml`, or the platform 401s before any of this runs.
- **ACAO explicitly pinned** to the onstandard.app origin pair. `public-offer-checkout` shipped
  without one and may be broken because of it; do not repeat that.
- Per-IP rate limit on `claim` and `recover` so the endpoint cannot be enumerated.
- Every response returns **only the caller's own row**. No action ever lists sets.
- No AI calls, so no spend gate.

### Layer 4 — `web/landing/tester.html`

Static, no build step, styled off `t.html` — dark, blue→teal sweep (the score-surface signature;
green stays status-only).

Four states:

1. **Form** — name + email, one button.
2. **Card** — "You're tester 03", the password, the four emails each labeled by role, one
   copy-all button.
3. **Exhausted** — all ten are taken, text the founder.
4. **Invalid link** — bad or missing `k`.

On load, if `localStorage` holds a device token, it calls `resume` and skips straight to the card.
Below the card sits a short start-here block: which account to sign in as first, how to switch
between the four, the TestFlight link, and a pointer to [beta.html](../../../web/landing/beta.html)
so feedback lands on the board instead of in the founder's texts.

### Layer 5 — `scripts/tester-accounts.mjs`

One file, three commands:

- `gen` — generates ten readable passwords, substitutes them into the SQL, writes the runnable file
  to the scratchpad (outside the repo), prints the `supabase db query` command.
- `verify` — **signs all forty accounts in for real** via `POST /auth/v1/token?grant_type=password`
  and reports pass/fail per account.
- `smoke` — exercises the deployed function end to end.

## Verification

Row inspection proves nothing here — a hand-inserted user can look perfect in every table and still
fail every sign-in. The gates are:

1. `tester-accounts.mjs verify` — 40/40 sign-ins succeed.
2. Roster check — `team_roster(<uuid>)` and `practice_roster(<uuid>)` (both take a UUID argument)
   confirm each athlete and client landed in their **own** tester's team/practice, with no
   cross-linking between sets.
3. `tester-accounts.mjs smoke` — claim assigns set 01; re-claiming with the same email returns set
   01 rather than burning 02; recover from a fresh device returns set 01; after ten claims the
   eleventh returns `exhausted`.
4. Manual — open the page on a phone, claim, sign into the athlete account, log one meal.

`raise notice` does not surface through `supabase db query`; the seed must **return rows** to
report anything.

## Teardown

Testers only, leaving the founder's four accounts intact:

```sql
delete from teams     where created_by in (select id from auth.users where raw_app_meta_data ? 'tester');
delete from practices where created_by in (select id from auth.users where raw_app_meta_data ? 'tester');
delete from auth.users where raw_app_meta_data ? 'tester';
delete from tester_sets;
```

The first two statements must run **before** the third. `created_by` is `ON DELETE SET NULL`, so
dropping the users first leaves the teams and practices unidentifiable and permanently orphaned.

**Footgun, to be warned about at the top of both seed scripts:** the existing teardown and
password-rotation one-liners key on `raw_app_meta_data->>'demo' = 'true'`, which after this change
sweeps all forty-four accounts including the founder's four.

## Risks

**Forty more credentialed sign-ins on live production.** There is still no environment separation.
This is the same exposure already accepted for four accounts, ten times over. Per-tester passwords
cap the blast radius at one set, and teardown is one command — but the honest fix remains a preview
project, and this is not it.

**Plaintext production passwords in a table.** Handing them out is the entire job, so they must be
readable. RLS blocks every path except service-role, so the table is no weaker than the accounts it
describes — but a database dump now includes ten live logins. Accepted for throwaway accounts that
get torn down at the end of the beta. The alternative, rejected as more moving parts for this scale:
have the function rotate that set's password at claim time via the admin API and display it once.

**A forwarded link burns a set.** Ten sets, ten testers, no slack. The name/email form is the only
friction, and it is not authentication. Mitigated by the founder controlling where the link goes,
and by `status` showing exactly who claimed what.
