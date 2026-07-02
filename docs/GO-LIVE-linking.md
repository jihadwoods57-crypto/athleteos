# Go-live checklist — Athlete↔Coach & Client↔Trainer linking

Everything below is built, tested, and committed on branch `claude/crew-update-wvkvhh`.
`npm run verify` is green (typecheck + 1243 jest tests + expo export). These are the only
**manual** steps left — none can be done safely from code without your credentials/decisions.

## 1. Apply the four new migrations (in order)
They are authored but NOT applied to the live project (per the repo guardrail). Apply after
the existing AI migrations (…`0021_food_cache`), in this exact order:

```
supabase db push        # applies 0022 → 0025 in filename order
```
- `0022_schools.sql` — `orgs.city/state`, `teams.discoverable`, extended `create_team`, starter school seed
- `0023_link_status_pending.sql` — adds `'pending'` to the `link_status` enum (own migration on purpose)
- `0024_join_requests.sql` — `request_join_team`, `discover_teams`, `resolve_team_code`, `pending_team_requests`
- `0025_practice_linking.sql` — `practices.handle`, `create_practice`, practice discovery/request/pending RPCs

> Numbering note: these were renumbered from 0017–0020 to 0022–0025 to avoid colliding with
> the AI crew's `0018`–`0021` migrations on this branch. No duplicate numbers remain.

## 2. Seed the full school directory
`0022` seeds a small real starter set so the picker works. Licensing is **not** a blocker —
NCES (public K-12) and IPEDS (colleges) are U.S. Dept. of Education **public-domain** data.
To load the full national list, an importer is ready:
```
# download a roster CSV (NCES CCD directory or IPEDS HD), then:
node scripts/import-schools.mjs <roster.csv> --type=school
supabase db push        # applies the generated 0026_schools_bulk.sql
```
It auto-detects NCES/IPEDS columns, dedupes, and skips anything already seeded (safe to
re-run). Until you run it, "Add your school/club" covers gaps.

## 3. Legal pages (Terms + Privacy)
Review-ready drafts already exist: `docs/legal/TERMS-OF-SERVICE.md` and
`docs/legal/PRIVACY-POLICY.md`. Remaining blanks are founder/counsel decisions the code
can't assert — legal entity name + address, effective date, governing law, data-retention
windows, and the Anthropic DPA terms (all marked `[FOUNDER + COUNSEL TO COMPLETE]`). Fill
those, have counsel review, then host at `https://onstandard.app/terms` and `/privacy`
(the URLs the app already links to).

## 4. Turn the backend on
Set `EXPO_PUBLIC_BACKEND_LIVE=true`. All linking is inert until this flips (the demo build
degrades gracefully — coach picker → freetext, connect code door works locally).

## 5. Deep links (optional, needs a device build)
The `onstandard://join?code=…` scheme is registered in `app.json`. Test on a device build
that tapping a coach's invite link opens the Connect overlay with the code prefilled. The
in-app "Connect your coach" card works without this.

## How to verify after go-live (SQL)
The node tests cover the store actions + invite parsing. The security invariants below need
a real project (psql), and are the ones to confirm once migrations are applied:
- A `pending` request is INVISIBLE to the coach's roster (`can_view` excludes it); becomes
  visible only after approve flips it to `active`; decline removes it.
- An athlete can't approve themselves; a coach can't approve for a team they're not staff on.
- Convergence: request-then-code and code-then-request both leave exactly ONE active row.
- Discovery RPCs (`discover_teams`, `resolve_team_code`, `find_practice_by_handle`) return
  only safe display columns — never a join code.
- A linked MINOR's meals/score still stay on-device until `guardianStatus='verified'`.

Full design: `docs/superpowers/specs/2026-07-01-athlete-coach-linking-design.md`.
