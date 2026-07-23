/* OnStandard Operator OS — shared data cache for BOTH operator roles.
   Every coach screen (coach-home, coach-roster, coach-insights, and the existing coach/trainer
   screens in screens/coach.js) reads the roster + activity + requirements-engine "extras" from
   HERE instead of keeping its own private copy — one fetch, one repaint, one honest state.

   A "book" is the set of people an operator is responsible for: a COACH's team or a TRAINER's
   practice. Both produce the identical row shape (roles.js projectRows), so every engine
   downstream (status, priority, inbox, insights) works on either without knowing which it got.
   What differs is CAPABILITY, not shape — see CAPS below.

   NOTE: this module deliberately does NOT import state.js. state.js imports FROM here, and
   closing that cycle makes RT undefined at module-eval time in an ESM WebView — an intermittent
   boot failure that reproduces on device and not in preview. The book kind is always passed in
   by the caller, never read off RT. */
import * as roles from './roles.js';
import { CATALOG, resolveRequirementSet, catalogFromItems } from './requirements.js';
import { athleteStatus } from './status.js';
import { effectiveRoomLabel } from './rooms.js';

/* The position value a roster row resolves its standard against: the athlete's ASSIGNED room label
   (0101) when set, else their raw position. Unassigned (every athlete until a coach assigns) → raw
   position, byte-identical to before. */
function resolvePos(row) {
  return effectiveRoomLabel(row.roomId, (CD.extras && CD.extras.rooms) || []) || row.position;
}

/* What an operator can actually DO with their book. Pure data, no imports.
   Three distinct reasons a practice cap is 0, and the distinction must stay legible — someone
   reading this later will otherwise "fix" the permanent ones:
     · reachable today  — can_view (0081) already includes is_trainer_of, and owns_practice
                          gates the practice's own tables. No server work.
     · until 0136/0137  — the table is `team_id uuid not null references teams(id)`, or the RPC
                          gates is_team_staff. Needs the dual-owner migration.
     · never            — position rooms, staff scopes, practice/game-day patterns and 1-to-many
                          broadcast are TEAM concepts. A trainer with 12 clients works 1:1. */
const CAPS = {
  team: {
    roster: 1, activity: 1, inbox: 1, athleteProfile: 1, targets: 1, approvals: 1,
    interventions: 1, notes: 1, exceptions: 1, groups: 1, standards: 1, assignments: 1, rollups: 1,
    rooms: 1, staffRoles: 1, weekPattern: 1, announcements: 1, recruiting: 1,
    offers: 0, payments: 0, packages: 0,
  },
  practice: {
    roster: 1, activity: 1, inbox: 1, athleteProfile: 1, targets: 1, approvals: 1,
    interventions: 0, notes: 0, exceptions: 0, groups: 0, standards: 0, assignments: 0, // → 0136
    rollups: 0,                                                                          // → 0137
    rooms: 0, staffRoles: 0, weekPattern: 0, announcements: 0, recruiting: 0,            // never
    offers: 1, payments: 1, packages: 1,
  },
};
const EMPTY_EXTRAS = { sets: [], groups: [], exceptions: [], interventions: [], rooms: [], scope: null, myRole: null };

/* Operator book cache: null = not loaded (show loading), else { book, teams, rows, kind } from real
   data. Fetched once on mount, repainted via window.__render; the athletes' scores are their own
   real numbers (days.score), and a member with no day row today is honestly "No logs today". */
let ROSTER = null;
let rosterLoading = false;
let KIND = 'team';

/** Load the signed-in operator's book. `kind` is 'team' (coach) or 'practice' (trainer) and MUST
    be passed by the caller — see the no-state.js-import note at the top of this file.
    loadCoachRoster below keeps the old name and signature, so no existing caller moves. */
export async function loadBook(force, kind) {
  const k = kind || KIND || 'team';
  if (rosterLoading) return;
  if (ROSTER && ROSTER.kind === k && !force) return;
  rosterLoading = true;
  const prevKind = KIND;
  KIND = k;                                  // CD.caps must be right before loadExtras gates on it
  try {
    const r = k === 'practice' ? await roles.loadTrainerBook() : await roles.loadCoachRoster();
    // One book shape for both roles. `teams` is an ALIAS of the same array, not a copy — every
    // shipped coach screen reads CD.roster.teams[0].id, and keeping that binding live is what
    // makes this generalization a ~0-diff change on the coach side.
    r.book = k === 'practice' ? r.practices : r.teams;
    r.teams = r.book;
    r.kind = k;
    // Pending join requests (names before the link is active). The practice RPC returns
    // client_id/client_name; normalize to the athlete_* shape the inbox already renders, so one
    // template serves both books.
    const pending = [];
    for (const b of r.book) {
      const reqs = k === 'practice' ? await roles.pendingPracticeRequests(b.id) : await roles.pendingTeamRequests(b.id);
      for (const q of reqs) {
        pending.push(k === 'practice'
          ? { teamId: b.id, bookId: b.id, athlete_id: q.client_id, athlete_name: q.client_name, position: null }
          : { teamId: b.id, bookId: b.id, ...q });
      }
    }
    r.pending = pending;
    r.offline = false;
    ROSTER = r;
    // Coach OS core (0071): requirement sets, groups, exceptions, today's interventions, and
    // this staff member's own scope — best-effort, scoped to the first book (mirrors the rest
    // of this cache's single-book assumption). A failure here must NOT read as a roster outage:
    // it's isolated in its own try/catch so a good roster fetch never gets marked offline
    // because the extras fetch (a separate set of tables) had trouble.
    if (r.book.length) {
      try { await loadExtras(r.book[0].id); }
      catch { CD.extras = { ...EMPTY_EXTRAS }; }
    }
  } catch {
    // A fetch that actually threw (vs the lower layers' swallow-to-[]) must NOT leave the screen
    // stuck on "Loading…" forever — mark offline so the render shows a distinct, retryable state.
    ROSTER = { book: [], teams: [], rows: [], pending: [], offline: true, kind: k };
    KIND = prevKind === k ? prevKind : k;
  } finally {
    rosterLoading = false; // always clear so a retry can re-run
  }
  // coach-athlete also depends on the roster (name + membership guard for a stale/dead link).
  // coach-home/coach-roster/coach-create/coach-insights depend on it too. The trainer routes
  // render from the same cache, so they repaint on the same arrival.
  const h = location.hash;
  if (h === '#coach' || h === '#copilot' || h === '#coach-inbox' || h === '#trainer'
    || h.startsWith('#coach-athlete') || h.startsWith('#coach-assign') || h.startsWith('#coach-plan')
    || h.startsWith('#trainer-client')
    || h === '#coach-home' || h === '#coach-roster' || h === '#coach-create' || h === '#coach-insights') window.__render();
  // Operator data just became ready (roster + extras). Re-run the notification sync so this
  // operator's device now schedules the OPERATOR plan from live roster status — the boot-time sync
  // (hydrateDay) ran before this fetch, when entriesFor() was still null and posted nothing.
  // syncNotifications itself routes to the operator branch only for a coach/trainer; harmless for
  // any other role. This is the ONLY data-arrival re-sync trigger an operator gets.
  try { if (window.__act && window.__act.syncNotifications) window.__act.syncNotifications(); }
  catch { /* best-effort — a sync failure never blocks the roster render */ }
}

/** The coach's book, by its original name and signature — every shipped coach screen still calls
    exactly this. Kept as a named export (not just an alias) so the coach path is impossible to
    break by changing loadBook's default. */
export async function loadCoachRoster(force) { return loadBook(force, 'team'); }
/** The trainer's book. Same cache, same engines, capability-reduced. */
export async function loadTrainerBook(force) { return loadBook(force, 'practice'); }
/** Which book an auth role owns. Takes the role as an ARGUMENT — this module must not import
    state.js (see the cycle note at the top), so every caller passes RT.authRole in. */
export const bookKindFor = (role) => (role === 'trainer' ? 'practice' : 'team');

/* Roster-wide activity feed (WS4a): recent meals across the team, newest first, with
   per-device unseen dots. Photos are real signed URLs (cached), never stock plates. */
let ACT = null;            // null = loading; { rows, photos: {mealId: url} }
let actLoading = false;
let actFetchedAt = 0;      // freshness window: a tab visit refetches, a repaint doesn't loop
export async function loadActivity(force) {
  if (actLoading) return;
  if (ACT && !force && Date.now() - actFetchedAt < 30000) return;
  actLoading = true;
  try {
    const rows = await roles.fetchTeamActivity(roles.daysAgoISO(1), 20);
    const photos = {};
    await Promise.all(rows.slice(0, 10).filter(m => m.photo_path).map(async (m) => {
      const u = await roles.signedMealPhotoUrl(m.photo_path);
      if (u) photos[m.id] = u;
    }));
    ACT = { rows, photos };
  } catch { ACT = { rows: [], photos: {} }; }
  finally { actLoading = false; actFetchedAt = Date.now(); }
  if (location.hash === '#coach' || location.hash === '#coach-inbox') window.__render();
}
export const actTime = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  let h = d.getHours() % 12; if (h === 0) h = 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
};

export const CD = {
  get roster() { return ROSTER; },
  get act() { return ACT; },
  get profile() { return PROFILE; },
  /** 'team' (coach) | 'practice' (trainer) — which kind of book is loaded. */
  get kind() { return KIND; },
  /** What this operator can do with it. Coach caps are all 1, so no shipped coach screen
      needs to consult this; only new operator-shared surfaces do. */
  get caps() { return CAPS[KIND] || CAPS.team; },
  extras: null,
};

/** A team-owned write must never be attempted against a practice book: the id would be a practice
    uuid and the insert would violate the FK against teams — silently, because roles.js swallows
    the error and returns false. Call this before any capability-gated write. */
export function can(cap) { return !!(CD.caps && CD.caps[cap]); }

/** The id of the book currently loaded — a team uuid for a coach, a practice uuid for a trainer.
    Prefer this over reading CD.roster.teams[0].id, which reads as team-only but isn't. */
export function bookId() { return (ROSTER && ROSTER.book && ROSTER.book[0] && ROSTER.book[0].id) || null; }

/** Log an operator action against the CURRENT book — the ONE choke point for it.
    coach_interventions.team_id FKs to teams, so on a practice book an un-guarded call violates
    the FK; roles.logIntervention swallows that error and returns false, which callers surface as
    a phantom "check your connection". Here a practice is a successful NO-OP instead, so the
    caller's real action (the push, the navigation) is never blocked by bookkeeping that cannot
    exist yet. Becomes a real write for practices at migration 0136. */
export async function logBookIntervention(args) {
  if (!CD.caps.interventions) return true;
  const id = bookId();
  if (!id) return false;
  return roles.logIntervention({ ...args, teamId: id });
}

async function loadExtras(bookId) {
  const c = CD.caps;
  // Each fetch is capability-gated, but the RESULTING SHAPE is identical either way — `sets` is
  // [] not undefined. That is what lets entriesFor stay untouched: resolveRequirementSet([]) is
  // null, so a practice book falls through to the built-in CATALOG, which is the honest answer
  // until 0136 gives a practice its own standards. Asserted in operator.test.mjs.
  const [sets, groups, exceptions, interventions, access, rooms] = await Promise.all([
    c.standards ? roles.fetchRequirementSets(bookId) : [],
    c.groups ? roles.fetchCoachGroups(bookId) : [],
    c.exceptions ? roles.fetchActiveExceptions(bookId) : [],
    c.interventions ? roles.fetchTodayInterventions(bookId) : [],
    c.staffRoles ? roles.fetchMyStaffAccess(bookId) : null,
    c.rooms ? roles.fetchTeamRooms(bookId) : [],
  ]);
  // Slice F: one read carries role + scope. `scope` keeps its pre-F shape for every existing
  // consumer; `myRole` is the client-side capability hint (staff-access.js) — the server
  // (0077/0078) is the real wall. `rooms` is T-04 slice 1 (position rooms, read-only here).
  CD.extras = {
    sets, groups, exceptions, interventions, rooms,
    scope: access ? access.scope : null,
    myRole: access ? access.role : null,
  };
}

/* Which slice of the roster the coach is currently looking at (team / one position room /
   a saved group / one athlete) — persisted so it survives a tab switch or reopen. Defaults to
   the signed-in staff member's own position-room scope (0071 team_staff) when they have one,
   else the whole team. */
/* Namespaced PER BOOK. It used to be one key for every role, which meant a device that signed in
   as a coach (persisting {kind:'position', value:'LB'}) and later as a trainer inherited that
   scope — and since practice_roster hardcodes position: null, scopeFilter matched nothing and the
   trainer saw an EMPTY book with no error to explain it. */
const scopeKey = () => `onstd-scope-${KIND}-v1`;
export function getScope() {
  try { const j = JSON.parse(localStorage.getItem(scopeKey()) || 'null'); if (j && j.kind) return j; } catch { /* fresh */ }
  const s = CD.extras && CD.extras.scope;
  // Slice F: a comma-list position scope ('LB, WR' — a coordinator's side) can't seed a
  // single-room filter; default to 'team', which post-0078 is already server-narrowed to
  // exactly their responsibility — nothing over-shows.
  return s && s.kind === 'position' && !String(s.value || '').includes(',')
    ? { kind: 'position', value: s.value } : { kind: 'team', value: null };
}
export function setScope(scope) {
  try { localStorage.setItem(scopeKey(), JSON.stringify(scope)); } catch { /* in-memory only */ }
}

export function scopeFilter(rows, scope) {
  if (!scope || scope.kind === 'team') return rows;
  if (scope.kind === 'position') return rows.filter(r => (r.position || '').toUpperCase() === String(scope.value || '').toUpperCase());
  if (scope.kind === 'group') {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === scope.value);
    const ids = new Set((g && g.athlete_ids) || []);
    return rows.filter(r => ids.has(r.athleteId));
  }
  if (scope.kind === 'athlete') return rows.filter(r => r.athleteId === scope.value);
  return rows;
}

/** Athlete-local minute-of-day + day-of-week from an IANA timezone (profiles.timezone, 0088), so
 *  coach-facing "overdue"/"due soon" is judged in the ATHLETE's day, not the coach's device clock
 *  (logic-audit P0-1). Null/absent tz or any failure → null and the caller falls back to the coach
 *  clock, so a pre-0088 roster or an athlete who hasn't captured a tz is completely unaffected.
 *  nowMs stays absolute (the coach's real instant); only the wall-clock projection changes. */
export function localClock(tz, nowMs) {
  if (!tz) return null;
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).formatToParts(new Date(nowMs));
    const val = (t) => (p.find((x) => x.type === t) || {}).value;
    let h = parseInt(val('hour'), 10); if (h === 24) h = 0; // some engines emit 24 at midnight
    const m = parseInt(val('minute'), 10);
    const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[val('weekday')];
    if (!isFinite(h) || !isFinite(m) || dow == null) return null;
    return { nowMin: h * 60 + m, nowDow: dow };
  } catch { return null; }
}

/** Scope-filtered [{ row, status }] for the given scope — the one place coach screens compute
    an athlete's live status. Pure w.r.t. this module's caches: resolves each athlete's governing
    requirement set (athlete > position > team > built-in CATALOG when no set is configured), then
    runs the pure status engine at each athlete's OWN local clock (their timezone; coach clock when
    none), so a coach in another timezone never sees a phantom "overdue". */
export function entriesFor(scope) {
  if (!ROSTER || !CD.extras) return null;   // still loading — screens render skeletons
  const now = new Date(); const nowMs = now.getTime();
  const coachMin = now.getHours() * 60 + now.getMinutes(); const coachDow = now.getDay();
  const excusedIds = new Set(CD.extras.exceptions.map(e => e.athlete_id));
  return scopeFilter(ROSTER.rows, scope).map((row) => {
    // resolveRequirementSet(sets, athleteId, position) → the governing SET row (or null), not a
    // reqs array — catalogFromItems maps its raw .items into the CATALOG-shaped requirements
    // athleteStatus expects. No configured set for this athlete → the built-in CATALOG governs.
    const set = resolveRequirementSet(CD.extras.sets, row.athleteId, resolvePos(row));
    const reqs = set ? catalogFromItems(set.items) : CATALOG;
    const lc = localClock(row.timezone, nowMs) || { nowMin: coachMin, nowDow: coachDow };
    return {
      row,
      status: athleteStatus({
        nowMin: lc.nowMin, nowMs, nowDow: lc.nowDow, row, reqs,
        excused: excusedIds.has(row.athleteId),
        needsReview: false, // slice D wires flagged-meal review state
      }),
    };
  });
}

/* Per-athlete profile cache (Task 4): one athlete's day, recent meals + signed photos, trust
   pass, coach interventions/assignments/notes, and their live status (same engine
   entriesFor uses, resolved at THIS call's clock). Guarded like loadCoachRoster: a generation
   counter so a stale/superseded load can never clobber a newer one, and a thrown fetch degrades
   to { athleteId, offline: true } rather than leaving the screen stuck loading forever. */
let PROFILE = null, profileLoadingId = null, profileGen = 0;
export async function loadAthleteProfile(athleteId, force) {
  if (!athleteId) return;
  if (profileLoadingId === athleteId && !force) return;
  if (PROFILE && PROFILE.athleteId === athleteId && !force) return;
  const gen = ++profileGen; profileLoadingId = athleteId;
  try {
    // Load THIS operator's book, not always the coach one — a trainer calling loadCoachRoster
    // here would fetch teams they don't have and leave the profile without its row.
    if (!CD.roster) await loadBook(false, KIND);       // need the row + extras (sets/exceptions)
    const bookId = CD.roster && CD.roster.book[0] && CD.roster.book[0].id;
    const c = CD.caps;
    const since30 = roles.daysAgoISO(30);
    // interventions/notes are team-owned tables until 0136. Passing a PRACTICE id into them would
    // read nothing anyway (RLS), but gating keeps the intent explicit and the shape honest: a
    // trainer's profile simply has no notes/interventions section rather than a permanently empty one.
    const [day, meals, trustPass, interventions, assignments, notes, basics, weights] = await Promise.all([
      roles.fetchDay(athleteId, roles.todayISO()),
      roles.fetchRecentMeals(athleteId, since30),
      roles.fetchActiveTrustPass(athleteId),
      c.interventions ? roles.fetchAthleteInterventions(bookId, athleteId, since30) : [],
      c.assignments ? roles.fetchAthleteAssignments(athleteId, since30) : [],
      c.notes ? roles.fetchCoachNotes(bookId, athleteId) : [],
      roles.fetchAthleteBasics(athleteId), // base_goal/base_weight/targets → the score breakdown's nutrition config
      roles.fetchAthleteWeights(athleteId, 30), // 0103: empty map for weight-restricted roles — surfaces just go absent
    ]);
    // Stitch today's weigh-in back onto the day row (current_weight left the direct grant).
    // Restricted roles get nothing here, so the activity "Weighed in" line and the breakdown's
    // weight simply don't exist for them — absence, never a blank or a fake.
    if (day && weights && weights.has(String(day.date))) day.current_weight = weights.get(String(day.date));
    const photos = {};
    await Promise.all((meals || []).slice(0, 12).filter(m => m.photo_path).map(async (m) => {
      const u = await roles.signedMealPhotoUrl(m.photo_path); if (u) photos[m.id] = u;
    }));
    const row = (CD.roster.rows || []).find(r => r.athleteId === athleteId) || null;
    const exceptions = ((CD.extras && CD.extras.exceptions) || []).filter(e => e.athlete_id === athleteId);
    // Mirrors entriesFor's own defensive style (`if (!ROSTER || !CD.extras) return null`):
    // status depends on CD.extras (requirement sets) being loaded — when it isn't, leave
    // status null rather than throwing into the offline catch below.
    let status = null;
    if (row && CD.extras) {
      const now = new Date(); const nowMs = now.getTime();
      // Mirrors entriesFor's resolveRequirementSet → catalogFromItems shape exactly, including
      // its CATALOG fallback when no requirement set governs this athlete/position, and the same
      // athlete-local clock (their timezone; coach clock when none) so the profile header's status
      // agrees with the roster chip instead of drifting on the coach's device time.
      const set = resolveRequirementSet(CD.extras.sets, row.athleteId, resolvePos(row));
      const reqs = set ? catalogFromItems(set.items) : CATALOG;
      const lc = localClock(row.timezone, nowMs)
        || { nowMin: now.getHours() * 60 + now.getMinutes(), nowDow: now.getDay() };
      status = athleteStatus({
        nowMin: lc.nowMin, nowMs, nowDow: lc.nowDow,
        row, reqs,
        excused: exceptions.length > 0, needsReview: false,
      });
    }
    if (gen !== profileGen) return;                    // a newer load superseded us
    PROFILE = { athleteId, day, meals: meals || [], photos, trustPass,
      interventions, assignments, notes, exceptions, row, status, basics, offline: false };
    // Receipt moved to the screen's mount(), where a real viewer id (RT.userId/S.coachIdentity)
    // is actually available — this loader has no viewer identity to write, so a call here was
    // a silent no-op (markDayViewed short-circuits without viewerId). See coach.js coachAthlete.mount.
  } catch {
    // Fuller offline shape so screens can't crash indexing into missing collections.
    if (gen === profileGen) PROFILE = {
      athleteId, offline: true, meals: [], photos: {},
      interventions: [], assignments: [], notes: [], exceptions: [],
    };
  } finally {
    if (gen === profileGen) profileLoadingId = null;
    if (location.hash === `#coach-athlete/${athleteId}` || location.hash === `#trainer-client/${athleteId}`) window.__render();
  }
}
