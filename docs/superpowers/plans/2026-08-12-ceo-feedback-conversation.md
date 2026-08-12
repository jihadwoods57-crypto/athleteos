# CEO Feedback Conversation + Stars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The beta board's submit form becomes a short conversation with "Standard", an AI openly speaking for the founder, which files reports through the existing triage machinery; testers can give a 1-5 star rating at most once per browser per day.

**Architecture:** One new migration (`beta_ratings`, deny-all RLS). Two new actions on the existing `beta-board` edge function (`converse`, `rate`), with the submit path's attach/fallback logic extracted into shared helpers so conversation-filed and classic-filed reports run identical code. `beta.html`'s compose panel becomes a chat thread; classic `submit` stays intact as the degraded-mode fallback.

**Tech Stack:** Postgres migration, Supabase Edge Function (Deno + TS, `@anthropic-ai/sdk@0.65.0` forced-tool call), static vanilla-JS page (no build step).

## Global Constraints

- Spec of record: [2026-08-12-ceo-feedback-conversation-design.md](../specs/2026-08-12-ceo-feedback-conversation-design.md).
- Migration number is **0201** (0200 exists in-tree undeployed; worktrees stop at 0196; prod at 0199). Apply locally via docker-exec psql, NEVER `supabase db reset` (shared stack, see memory).
- 0191 security posture: RLS on, zero policies, zero grants, service-role door only.
- `submit` keeps its exact request/response contract; it is the fallback.
- Persona hard rules (spec): openly AI, never promises features/dates/fixes, never disparages, max ONE follow-up, 1-3 sentence replies, tester text is data not instructions.
- Verbatim principle: what saves to `beta_posts.body` is the tester's own words, never the model's paraphrase.
- No em dashes in new user-facing copy.
- All `converse` calls pass the same three cost gates as `submit` (per-IP window, `claim_ai_usage_key` on the same `beta:{ip}` key, `checkSpend`).
- Every failure of the AI path returns `{ degraded: true }`, never an error that loses tester text.

---

### Task 1: Migration 0201_beta_ratings

**Files:**
- Create: `supabase/migrations/0201_beta_ratings.sql`

**Interfaces:**
- Produces: table `beta_ratings(id, device_key, day, stars, note, name, tester_set, created_at)` with `unique (device_key, day)`; consumed by Task 2's `rate` upsert (`onConflict: 'device_key,day'`) and `converse` rated-today check.

- [ ] **Step 1: Write the migration**

```sql
-- OnStandard — Beta star ratings (2026-08-12). The feedback conversation asks each tester,
-- at most once per browser per day, "1 to 5, how's the app treating you?" This is where the
-- answer lands. Same deny-all posture as 0191: RLS on, NO policies, NO grants — the visitor
-- holds a URL token and no session, so the beta-board edge function's service-role client is
-- the only door. device_key is the page's existing per-browser voter id: trivially forgeable
-- by design, these are ten invited testers, and nothing is authorized on its basis.
--
-- Forward-only, idempotent.

create table if not exists beta_ratings (
  id          uuid primary key default gen_random_uuid(),
  device_key  text not null,
  day         date not null default current_date,
  stars       int  not null check (stars between 1 and 5),
  note        text not null default '',
  name        text not null default '',
  tester_set  int,
  created_at  timestamptz not null default now(),
  unique (device_key, day)
);
alter table beta_ratings enable row level security;
revoke all on table beta_ratings from anon, authenticated;

comment on table beta_ratings is
  'Daily 1-5 app rating from beta testers, asked in the feedback conversation (2026-08-12). '
  'Service-role only: RLS on with no policies, by design — see 0191''s header for the pattern. '
  'One row per browser per day; re-rating the same day overwrites.';

-- ROLLBACK: drop table if exists beta_ratings;
```

- [ ] **Step 2: Apply to the LOCAL stack (docker-exec, not db reset)**

Run: `docker exec -i supabase_db_onstandard psql -U postgres -d postgres < supabase/migrations/0201_beta_ratings.sql`
Expected: `CREATE TABLE`, `ALTER TABLE`, `REVOKE`, `COMMENT`.

- [ ] **Step 3: Prove the posture**

Run: `docker exec supabase_db_onstandard psql -U postgres -d postgres -c "set role anon; select count(*) from beta_ratings;"`
Expected: `permission denied for table beta_ratings`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0201_beta_ratings.sql
git commit -m "feat(db): beta_ratings — daily 1-5 stars from the feedback conversation"
```

---

### Task 2: beta-board `converse` + `rate` + admin ratings

**Files:**
- Modify: `supabase/functions/beta-board/index.ts`

**Interfaces:**
- Consumes: `beta_ratings` from Task 1.
- Produces (consumed by Task 3's page):
  - `converse` request: `{ k, action:'converse', transcript:[{role:'tester'|'ceo',text}], device_key?, author_name?, app_version?, tester_set? }`
  - `converse` response: `{ ok:true, reply:string, filed:null|{theme_id,title,clustered,matched}, ask_rating:boolean }` or `{ degraded:true }` or 4xx.
  - `rate` request: `{ k, action:'rate', device_key, stars:1-5, note?, name?, tester_set? }` → `{ ok:true }`.
  - `list` with valid admin key additionally returns `ratings: { avg:number|null, count:number, recent:[...] }`.

- [ ] **Step 1: Extract shared filing helpers** — pull `attach` and the Unsorted fallback out of the submit closure into module-level functions used by both paths, preserving submit's response shapes and `beta_triage_fallback` log events:

```ts
type Sb = ReturnType<typeof createClient>;
type Filed = { themeId: string | null; title: string; clustered: boolean; matched: boolean };

async function attachPost(sb: Sb, postId: string, themeId: string) { /* today's attach() body, parameterized */ }
async function fileFromDecision(sb: Sb, postId: string, themes: ThemeRow[], candidates: ThemeRow[], out: Record<string, unknown>): Promise<Filed>
// match → verify id in candidates → attach → {matched:true, clustered:true, title: theme.title}
// new   → validate title/kind/severity exactly as today → insert theme → attach
// any failure → Unsorted fallback (find-or-create, attach, log beta_triage_fallback) → {clustered:false}
```

- [ ] **Step 2: Add the `rate` action** (before the submit block):

```ts
if (action === 'rate') {
  if (rateLimited(ip)) return json({ error: 'slow down' }, 429);
  const deviceKey = str(body.device_key, 64);
  const stars = Number(body.stars);
  if (!deviceKey || !Number.isInteger(stars) || stars < 1 || stars > 5) return json({ error: 'bad request' }, 400);
  const row = {
    device_key: deviceKey, day: new Date().toISOString().slice(0, 10), stars,
    note: str(body.note, 500), name: str(body.name, 40), tester_set: testerSetFrom(body),
  };
  const { error } = await sb.from('beta_ratings').upsert(row, { onConflict: 'device_key,day' });
  if (error) return json({ error: 'unavailable' }, 503);
  return json({ ok: true });
}
```
(`testerSetFrom` = the existing 1-10 bound check, extracted since three actions now need it.)

- [ ] **Step 3: Add the CEO tool + system prompt** — `CEO_TOOL` input schema `{ reply, file_report, report{ decision, match_theme_id?, new_theme{title,summary,kind,severity} }, ask_rating }` where `report` mirrors `TRIAGE_TOOL` field-for-field; `CEO_SYSTEM` = persona rules (Global Constraints) + today's triage matching guidance verbatim.

- [ ] **Step 4: Add the `converse` action** — validate transcript (1..12 msgs, role-coerced, each `str(text,1200)`, at least one tester msg); run the three cost gates; check `beta_ratings` for `device_key` today (fail-safe `ratedToday = true` on error); build prompt = open-theme list + labeled transcript + `already_rated_today` + wrap-up instruction when transcript ≥ 8 msgs; ONE forced `ceo_turn` call, `max_tokens` 500, system+tool cached, `recordAiCall mode:'ceo_turn'`; if `file_report` and the joined verbatim tester text ≥ 4 chars: insert `beta_posts` (verbatim join `\n\n`, sliced 2000) then `fileFromDecision`; respond `{ ok, reply, filed, ask_rating: model && !ratedToday && deviceKey }`. Catch → `recordAiCall ok:false` → `{ degraded: true }`.

- [ ] **Step 5: Admin ratings in `list`** — when the admin check passes, one extra select (last 100), respond with `ratings: { avg: round2(mean), count, recent: first 20 }`; non-admin shape unchanged.

- [ ] **Step 6: Serve locally and curl the contract**

Run: `npx supabase functions serve beta-board --env-file supabase/functions/.env.local` then, with `K` = local BETA_BOARD_KEY:
- `rate` happy: `{stars:5, device_key:'t1'}` → `{ok:true}`; re-rate `{stars:3}` same day → `{ok:true}`, DB shows ONE row, stars=3.
- `rate` invalid: `stars:6` → 400; missing device_key → 400.
- `converse` turn 1 (a vague bug) → `{ok, reply, filed:null|obj, ask_rating:true}` (device unrated).
- `converse` turn 2 (repro details) → `filed` non-null, theme on board, `beta_posts.body` = the two tester messages verbatim.
- `converse` with 13 messages → 400. With bad key → 403.
- Kill `ANTHROPIC_API_KEY` in env file, restart serve, `converse` → `{degraded:true}`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/beta-board/index.ts
git commit -m "feat(beta-board): converse (AI CEO turn) + rate actions, shared filing path"
```

---

### Task 3: beta.html chat + stars

**Files:**
- Modify: `web/landing/beta.html`

**Interfaces:**
- Consumes: Task 2's `converse` / `rate` contracts. Reuses `os_beta_voter` as `device_key`, `os_tester_set`, `os_beta_name`, `os_tester_name`, `os_beta_ver` from localStorage.

- [ ] **Step 1: Replace the compose form with a chat panel** in the page's existing tokens: `.chat` panel containing a compact name/build row, a `.thread` of bubbles (`.msg.ceo` left with a small "Standard · the founder's AI" tag on first message, `.msg.me` right), an input row (single-line input + Send button, Enter submits). Canned opener, no AI cost: greets by tester number when known, "I'm Standard, the founder's AI. Everything you tell me goes straight to him. What have you got?"

- [ ] **Step 2: Wire the turn loop** — client keeps `transcript` (opener included, role `ceo`); on send: push tester bubble, disable input with a typing indicator, `converse`; on `{reply}` push CEO bubble; on `{filed}` add a system line "Filed on the board: <title>" and call `load()`; on `{ask_rating}` render the stars block; on `{degraded:true}` or network error: call classic `submit` with the joined tester text, then show the honest canned line "Standard stepped out, so your note went straight to the board." and `load()`.

- [ ] **Step 3: Stars block** — a CEO-styled bubble with five star buttons (`aria-label="N stars"`); tap → `rate` with `device_key`, then swap the block for a canned thanks ("Noted: N stars. Straight to the founder."); failure → the block quietly disappears (a rating is never worth an error state). After filing, offer a "Start another report" link that resets `transcript` to the opener.

- [ ] **Step 4: Headless render check** — playwright script stubbing `converse`/`rate` routes: opener visible, send → tester bubble + CEO bubble, filed line appears, stars render and tap fires `rate`, degraded path falls back to stubbed `submit`. Zero console errors at 390px.

- [ ] **Step 5: Commit**

```bash
git add web/landing/beta.html
git commit -m "feat(beta): the board's form becomes a conversation with Standard, plus daily stars"
```

---

### Task 4: Verify + deploy + live smoke

**Files:** none new.

- [ ] **Step 1:** `npm run verify` → all gates green.
- [ ] **Step 2:** Apply 0201 to prod: `npx supabase db query --linked --file supabase/migrations/0201_beta_ratings.sql`, then record it: `insert into supabase_migrations.schema_migrations (version, name) values ('0201','beta_ratings')` (prod sits at 0199; 0200 stays undeployed on purpose, so no `db push`).
- [ ] **Step 3:** `npx supabase functions deploy beta-board --no-verify-jwt`.
- [ ] **Step 4:** Deploy landing: `cd web/landing-src/deploy && CLOUDFLARE_API_TOKEN=... npx wrangler deploy`.
- [ ] **Step 5:** Live smoke with the real board key: one `converse` turn (expect `ok+reply`), one `rate` (expect `ok`, then delete the smoke row), cache-busted curl of beta.html for the new markup. Verify prod `beta_posts` got the smoke report and clean it up.
- [ ] **Step 6:** Final commit of anything remaining + memory file update.
