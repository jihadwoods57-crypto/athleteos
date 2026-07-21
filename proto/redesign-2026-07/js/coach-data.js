/* OnStandard Coach OS — shared coach data cache (Task 5).
   Every coach screen (coach-home, coach-roster, coach-insights, and the existing coach/trainer
   screens in screens/coach.js) reads the roster + activity + requirements-engine "extras" from
   HERE instead of keeping its own private copy — one fetch, one repaint, one honest state.
   Lift-and-rewire only: the ROSTER/ACT loaders below are moved verbatim from screens/coach.js,
   no behavior change for anything that already used them. */
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

/* Coach roster cache: null = not loaded (show loading), else { teams, rows } from real data.
   Fetched once on mount, repainted via window.__render; the athletes' scores are their own real
   numbers (days.score), and a member with no day row today is honestly "No logs today". */
let ROSTER = null;
let rosterLoading = false;
export async function loadCoachRoster(force) {
  if (rosterLoading) return;
  if (ROSTER && !force) return;
  rosterLoading = true;
  try {
    const r = await roles.loadCoachRoster();
    // Pending join requests per team (athlete names before their link is active).
    const pending = [];
    for (const t of r.teams) {
      const reqs = await roles.pendingTeamRequests(t.id);
      for (const q of reqs) pending.push({ teamId: t.id, ...q });
    }
    r.pending = pending;
    r.offline = false;
    ROSTER = r;
    // Coach OS core (0071): requirement sets, groups, exceptions, today's interventions, and
    // this staff member's own scope — best-effort, scoped to the first team (mirrors the rest
    // of this cache's single-team assumption). A failure here must NOT read as a roster outage:
    // it's isolated in its own try/catch so a good roster fetch never gets marked offline
    // because the extras fetch (a separate set of tables) had trouble.
    if (r.teams.length) {
      try { await loadExtras(r.teams[0].id); }
      catch { CD.extras = { sets: [], groups: [], exceptions: [], interventions: [], rooms: [], scope: null }; }
    }
  } catch {
    // A fetch that actually threw (vs the lower layers' swallow-to-[]) must NOT leave the screen
    // stuck on "Loading…" forever — mark offline so the render shows a distinct, retryable state.
    ROSTER = { teams: [], rows: [], pending: [], offline: true };
  } finally {
    rosterLoading = false; // always clear so a retry can re-run
  }
  // coach-athlete also depends on the roster (name + membership guard for a stale/dead link).
  // coach-home/coach-roster/coach-create/coach-insights (later tasks) depend on it too —
  // harmless to repaint a route that isn't wired yet.
  if (location.hash === '#coach' || location.hash === '#copilot' || location.hash === '#coach-inbox'
    || location.hash.startsWith('#coach-athlete') || location.hash.startsWith('#coach-assign') || location.hash.startsWith('#coach-plan')
    || location.hash === '#coach-home' || location.hash === '#coach-roster' || location.hash === '#coach-create' || location.hash === '#coach-insights') window.__render();
  // Coach data just became ready (roster + extras). Re-run the notification sync so this coach's
  // device now schedules the COACH plan from live roster status — the boot-time sync (hydrateDay)
  // ran before this fetch, when entriesFor() was still null and posted nothing. syncNotifications
  // itself routes to the coach branch only when RT.authRole === 'coach'; harmless for any other
  // role. This is the ONLY data-arrival re-sync trigger a coach gets (checked: nothing else fires).
  try { if (window.__act && window.__act.syncNotifications) window.__act.syncNotifications(); }
  catch { /* best-effort — a sync failure never blocks the roster render */ }
}

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
  extras: null,
};

async function loadExtras(teamId) {
  const [sets, groups, exceptions, interventions, access, rooms] = await Promise.all([
    roles.fetchRequirementSets(teamId), roles.fetchCoachGroups(teamId),
    roles.fetchActiveExceptions(teamId), roles.fetchTodayInterventions(teamId),
    roles.fetchMyStaffAccess(teamId), roles.fetchTeamRooms(teamId),
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
const SCOPE_KEY = 'onstd-coach-scope-v1';
export function getScope() {
  try { const j = JSON.parse(localStorage.getItem(SCOPE_KEY) || 'null'); if (j && j.kind) return j; } catch { /* fresh */ }
  const s = CD.extras && CD.extras.scope;
  // Slice F: a comma-list position scope ('LB, WR' — a coordinator's side) can't seed a
  // single-room filter; default to 'team', which post-0078 is already server-narrowed to
  // exactly their responsibility — nothing over-shows.
  return s && s.kind === 'position' && !String(s.value || '').includes(',')
    ? { kind: 'position', value: s.value } : { kind: 'team', value: null };
}
export function setScope(scope) {
  try { localStorage.setItem(SCOPE_KEY, JSON.stringify(scope)); } catch { /* in-memory only */ }
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
function localClock(tz, nowMs) {
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
    if (!CD.roster) await loadCoachRoster();           // need the row + extras (sets/exceptions)
    const teamId = CD.roster && CD.roster.teams[0] && CD.roster.teams[0].id;
    const since30 = roles.daysAgoISO(30);
    const [day, meals, trustPass, interventions, assignments, notes] = await Promise.all([
      roles.fetchDay(athleteId, roles.todayISO()),
      roles.fetchRecentMeals(athleteId, since30),
      roles.fetchActiveTrustPass(athleteId),
      roles.fetchAthleteInterventions(teamId, athleteId, since30),
      roles.fetchAthleteAssignments(athleteId, since30),
      roles.fetchCoachNotes(teamId, athleteId),
    ]);
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
      interventions, assignments, notes, exceptions, row, status, offline: false };
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
    if (location.hash === `#coach-athlete/${athleteId}`) window.__render();
  }
}
