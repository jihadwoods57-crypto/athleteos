import { S, RT, roleProfileRoute } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, errorState, skeletonRows } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadBook, bookKindFor, entriesFor, getScope, scopeFilter } from '../coach-data.js';

/* nav:'operator' — load whichever book the signed-in role owns (see coach-home.js). */
const loadMyBook = (force) => loadBook(force, bookKindFor(RT.authRole));
import { CATALOG, resolveRequirementSet, catalogFromItems } from '../requirements.js';
import { weekWindows, weeklyBrief, athletesToWatch, mostMissed, weekVsMonth, interventionOutcomes } from '../insights.js';

/* Insights v1 starter (slice A): today's deterministic read over the real roster.
   Weekly trends / most-missed / movers land in slice E — the unlock note below is
   honest about that, and coach_interventions is ALREADY recording so slice E's
   "did the intervention work?" has history from today forward. */

/* ---------------- Slice E: the "This week" lower half ----------------
   Module cache + in-flight guard, same idiom as ANN_CACHE/loadAnnouncements and
   INBOX_DATA/loadInboxData in screens/coach.js: one fetch per team, repainted via
   window.__render, never refetched on every repaint. ONE rollup fetch spanning
   monthFrom..today covers this week, last week, AND the trailing 28-day window —
   weekWindows() (insights.js) derives all three from the same todayISO. Outcomes span
   the trailing 56 days, comfortably past team_intervention_outcomes' own 14-day floor
   so a team that just crossed the unlock threshold isn't starved of qualifying rows. */
let INSIGHTS_DATA = null; // { teamId, rollup, outcomes }
let insightsLoadingId = null;
async function loadInsights(teamId, force) {
  if (!teamId) return;
  if (INSIGHTS_DATA && INSIGHTS_DATA.teamId === teamId && !force) return;
  if (insightsLoadingId === teamId) return;
  insightsLoadingId = teamId;
  const today = roles.todayISO();
  const { monthFrom } = weekWindows(today);
  const kind = CD.kind;
  try {
    const [rollup, outcomes] = await Promise.all([
      roles.fetchTeamDayRollup(teamId, monthFrom, today, kind),
      roles.fetchInterventionOutcomes(teamId, roles.daysAgoISO(56), kind),
    ]);
    // null = the read FAILED, which is NOT "not enough history yet". Until the fetchers grew a
    // failure sentinel this branch could not be reached and the week silently read as sparse.
    // Outcomes alone failing is not an outage: the week still renders, its section stays absent.
    INSIGHTS_DATA = rollup === null
      ? { teamId, rollup: [], outcomes: [], offline: true }
      : { teamId, rollup, outcomes: outcomes || [] };
  } catch { INSIGHTS_DATA = { teamId, rollup: [], outcomes: [], offline: true }; } // audit G-3: honest error, not perpetual "Reading the week…"
  finally { insightsLoadingId = null; }
  if (location.hash === '#coach-insights') window.__render();
}

/* Which of the built-in CATALOG's fixed ids map onto insights.js's per-kind "done" rules
   (weeklyBrief/mostMissed branch on req.kind === 'meal'/'weigh'/'checkin') — CATALOG itself
   carries no `kind` field (see requirements.js). Anything not listed here (recovery,
   hydration) is honestly counted through its own tasks_done id instead, same as the server
   does for those items — no fabricated kind, just a coarser real signal. v2: no 'weekly' entry
   — the weekly check-in ritual (and its CATALOG id) is deleted (Task 7); insights.js's
   req.kind === 'checkin' branch now only ever sees kind:'checkin' on a pre-cutover stored item,
   never a live CATALOG one. */
const CATALOG_KIND = { breakfast: 'meal', lunch: 'meal', dinner: 'meal', weight: 'weigh' };

/* reqsByAthlete for the insights engine: {id, title, kind, required, freq, ...} per roster
   athlete, using the EXACT governance resolveRequirementSet already gives entriesFor
   (coach-data.js:129-149) — athlete > position > team custom set, else the built-in CATALOG.
   catalogFromItems maps a set's raw items into the CATALOG-shaped requirement athleteStatus
   consumes (title/freq/required/proof/window/...) — exactly the shape needed here too, except
   it drops the item's own `kind`, which weeklyBrief/mostMissed need to pick the right per-day
   "done" signal (positional meal count vs weight_logged vs checkin_done vs tasks_done). So kind
   is read straight off the raw item and reattached by id rather than recomputed. */
function buildReqsByAthlete(roster, extras) {
  const sets = (extras && extras.sets) || [];
  const out = {};
  for (const r of roster) {
    if (!r || !r.athleteId) continue;
    const set = resolveRequirementSet(sets, r.athleteId, r.position);
    if (set) {
      const kindById = {};
      for (const it of (set.items || [])) {
        if (!it || it.id == null) continue;
        // v2: no live item is ever kind:'checkin' — the ritual and KIND_DEFAULTS.checkin are
        // both deleted (Task 7/8). A pre-cutover row can still literally carry kind:'checkin'
        // on a stale item; reattaching it unchanged would make mostMissed (insights.js:321)
        // report it as a real weekly requirement forever (nothing can ever complete it again).
        // Treat it like any other unrecognized kind — undefined here, so the fallback below
        // reads it as 'custom', same silent disposition as a lift/custom item.
        kindById[String(it.id)] = it.kind === 'checkin' ? undefined : it.kind;
      }
      out[r.athleteId] = catalogFromItems(set.items).map(req => ({ ...req, kind: kindById[req.id] || 'custom' }));
    } else {
      out[r.athleteId] = CATALOG.map(c => ({ ...c, kind: CATALOG_KIND[c.id] }));
    }
  }
  return out;
}

function humanizeKind(k) {
  return String(k || 'other').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/* Mirrors coach-home.js's private scopeLabel — duplicated rather than imported (each screen
   keeps its own small copy of this, same as coach-announce.js's variant); getScope()'s shape
   is the shared contract, not this rendering. */
function scopeLabel(scope) {
  const everyone = CD.kind === 'practice' ? 'All clients' : 'Entire team';
  if (!scope || scope.kind === 'team') return everyone;
  if (scope.kind === 'position') return `${scope.value} room`;
  if (scope.kind === 'group') {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === scope.value);
    return g ? g.name : 'Group';
  }
  if (scope.kind === 'athlete') {
    const r = CD.roster && CD.roster.rows.find(x => x.athleteId === scope.value);
    return r ? r.name : (CD.kind === 'practice' ? 'One client' : 'One athlete');
  }
  return everyone;
}

const dotLine = (text, cls) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:5px 0;font-size:13.5px;font-weight:600;color:var(--text);line-height:1.5"><span class="dot ${cls}" style="width:7px;height:7px;border-radius:50%;margin-top:7px;flex:none"></span><span>${esc(text)}</span></div>`;

const EMPTY_COPY = `
    <div class="co-eyebrow">This week</div>
    <div class="co-empty"><div class="ic">${icon('bars', 24)}</div>
    <div class="tt">Trends unlock as history builds</div>
    <div class="ts">Weekly change, most-missed requirements, and whether your nudges are working — this screen fills in from your team's real data. Every action you take is already recording toward it.</div></div>`;

/* Builds the whole "This week" lower half, or the honest placeholder when there isn't enough
   history yet. Kept as one function so render() below stays a straight read. */
function weekSection() {
  const teamId = CD.roster.teams[0] && CD.roster.teams[0].id;
  if (!teamId) return EMPTY_COPY; // no team at all — never will have history either

  const data = INSIGHTS_DATA && INSIGHTS_DATA.teamId === teamId ? INSIGHTS_DATA : null;
  if (data && data.offline) {
    return `
    <div class="co-eyebrow">This week</div>
    ${errorState({ title: "Couldn't load the week", body: 'Your weekly trends are safe — reconnect and they load right here.', retryId: 'insights-week-retry' })}`;
  }
  if (!data) {
    return `
    <div class="co-eyebrow">This week</div>
    ${skeletonRows(2, 'Reading the week')}`;
  }

  const scope = getScope();
  const scopedRoster = scopeFilter(CD.roster.rows, scope);
  const scopedIds = new Set(scopedRoster.map(r => r.athleteId));
  const rollup = data.rollup.filter(r => r && scopedIds.has(r.athlete_id));

  const uniqueDays = new Set(rollup.map(r => r.day)).size;
  if (uniqueDays < 2) return EMPTY_COPY;

  const today = roles.todayISO();
  const reqsByAthlete = buildReqsByAthlete(scopedRoster, CD.extras);
  const brief = weeklyBrief({ rollup, roster: scopedRoster, todayISO: today, reqsByAthlete });
  const watch = athletesToWatch({ rollup, roster: scopedRoster, todayISO: today });
  const missed = mostMissed({ rollup, reqsByAthlete, todayISO: today }).slice(0, 3);
  const vsMonth = weekVsMonth({ rollup, todayISO: today });
  const scopedOutcomes = (data.outcomes || []).filter(o => o && scopedIds.has(o.athlete_id));
  const outcomes = interventionOutcomes({ outcomes: scopedOutcomes, roster: scopedRoster, todayISO: today });

  const decliners = watch.decliners.slice(0, 3);
  const disengaging = watch.disengaging.slice(0, 3);
  const recoverers = (outcomes.unlocked ? outcomes.recoverers : []).slice(0, 3);

  const sections = [];

  // ---- This week (weeklyBrief) ----
  if (brief.lines.length || brief.byRoom.length) {
    sections.push(`
    <div class="co-eyebrow">This week · ${esc(scopeLabel(scope))}</div>
    <section class="card" style="padding:var(--s3) var(--s4)">
      ${brief.lines.map(l => dotLine(l.text, l.dir === 'up' ? 'g' : l.dir === 'down' ? 'r' : 'b')).join('')}
      ${brief.byRoom.map(r => dotLine(r.text, r.completionDelta > 0 ? 'g' : 'r')).join('')}
    </section>`);
  }

  // ---- Athletes to watch (decliners / disengaging / recoverers) ----
  if (decliners.length || disengaging.length || recoverers.length) {
    const athRow = (a, sub) => `
      <div class="lrow" data-go="coach-athlete/${esc(a.athleteId)}">
        <div class="lm"><div class="lt">${esc(a.name)}</div><div class="ls">${esc(sub)}</div></div>
      </div>`;
    sections.push(`
    <div class="co-eyebrow">${CD.kind === 'practice' ? 'Clients' : 'Athletes'} to watch</div>
    <section class="card" style="padding:6px 16px">
      ${decliners.length ? `<div class="eyebrow" style="margin:10px 2px 0">Trending down</div>${decliners.map(d => athRow(d, d.text)).join('')}` : ''}
      ${disengaging.length ? `<div class="eyebrow" style="margin:10px 2px 0">Going quiet</div>${disengaging.map(d => athRow(d, d.text)).join('')}` : ''}
      ${recoverers.length ? `<div class="eyebrow" style="margin:10px 2px 0">Bouncing back</div>${recoverers.map(r => athRow(r, `${r.lift >= 0 ? '+' : ''}${r.lift} avg score lift after an intervention`)).join('')}` : ''}
    </section>`);
  }

  // ---- Most missed ----
  if (missed.length) {
    sections.push(`
    <div class="co-eyebrow">Most missed</div>
    <section class="card" style="padding:var(--s3) var(--s4)">
      ${missed.map(m => dotLine(m.text, 'a')).join('')}
    </section>`);
  }

  // ---- Week vs month ----
  if (vsMonth.text) {
    sections.push(`
    <div class="co-eyebrow">Week vs month</div>
    <section class="card" style="padding:var(--s3) var(--s4)">
      ${dotLine(vsMonth.text, vsMonth.weekAvg > vsMonth.monthAvg ? 'g' : vsMonth.weekAvg < vsMonth.monthAvg ? 'r' : 'b')}
    </section>`);
  }

  // ---- Are interventions working? — always shown (locked or unlocked), the one section
  // exempt from "silence over noise": a coach who opens this should always see WHERE the
  // outcomes tracker stands, never nothing at all. ----
  const sinceLabel = new Date(`${outcomes.sinceISO}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  sections.push(`
  <div class="co-eyebrow">Are interventions working?</div>
  <section class="card" style="padding:var(--s3) var(--s4)">
    ${outcomes.unlocked
      ? `${dotLine(outcomes.text, 'b')}${(outcomes.byKind || []).map(k => dotLine(`${humanizeKind(k.kind)} · ${k.n} use${k.n === 1 ? '' : 's'} · ${k.avgLift >= 0 ? '+' : ''}${k.avgLift} avg lift`, 'b')).join('')}`
      : `<div style="display:flex;gap:10px;align-items:flex-start"><span style="flex:none;color:var(--text-3);margin-top:1px">${icon('lock', 15)}</span><span style="font-size:13.5px;font-weight:600;color:var(--text-2);line-height:1.5">Intervention tracking started ${esc(sinceLabel)} — outcomes unlock once there's enough tracked history.</span></div>`}
  </section>`);

  return sections.join('');
}

export const coachInsights = {
  nav: 'operator', tab: 'profile',   // reached from You → Analytics; no longer its own tab
  render() {
    /* Insights is reached from You → Insights now that the fifth tab is the profile, so it needs
       a real back chevron: an avatarHead/titleHead is for a TAB ROOT, and a screen with neither a
       tab nor a back button is a dead end you can only leave by guessing at the tab bar.
       roleProfileRoute() keeps the trainer's back landing on trainer-profile, not the coach's. */
    const head = backHead('Insights', 'What the numbers say', roleProfileRoute());
    // Audit G-4: offline before the loading gate (CD.extras is null on a cold offline load too),
    // so an offline coach gets an honest retry instead of a permanent "Reading the day…".
    if (CD.roster && CD.roster.offline) return `${head}${errorState({ title: "Can't reach insights", body: `Your ${CD.kind === 'practice' ? "clients'" : "team's"} numbers are safe — reconnect and the read loads right here.`, retryId: 'insights-retry' })}`;
    if (CD.roster === null || !CD.extras) return `${head}${skeletonRows(3, 'Reading the day')}`;
    const entries = entriesFor({ kind: 'team', value: null }) || [];
    const by = (k) => entries.filter(e => e.status.key === k);
    const lines = [];
    if (by('overdue').length) lines.push(`${by('overdue').length} ${CD.noun}${by('overdue').length > 1 ? 's are' : ' is'} overdue right now: ${by('overdue').slice(0, 3).map(e => e.row.name.split(' ')[0]).join(', ')}${by('overdue').length > 3 ? '…' : ''}.`);
    if (by('no_activity').length) lines.push(`${by('no_activity').length} ${by('no_activity').length > 1 ? 'have' : 'has'} no activity in the last day.`);
    if (by('below_standard').length) lines.push(`${by('below_standard').length} logged below the standard today.`);
    if (by('needs_review').length) lines.push(`${by('needs_review').length} log${by('needs_review').length > 1 ? 's are' : ' is'} in — waiting on a score or your review.`);
    const top = entries.filter(e => e.row.score != null).sort((a, b) => b.row.score - a.row.score)[0];
    if (top) lines.push(`${top.row.name} leads the day at ${top.row.score}.`);
    if (!lines.length) {
      const logged = entries.filter(e => e.row.loggedToday).length;
      lines.push(!entries.length ? `No ${CD.kind === 'practice' ? 'clients' : 'athletes'} on the roster yet.`
        : logged ? `${logged} of ${entries.length} ${logged === 1 ? 'has' : 'have'} logged today — nothing needs your attention right now.`
        : 'Quiet so far — no logs yet today.');
    }
    // Recurring standing-bar motif — the same signature language as Home, so Insights opens
    // on the team's real shape at a glance before the sentences explain it.
    const keys = entries.map(e => e.status.key);
    const cnt = (p) => keys.filter(p).length;
    const g = cnt(k => k === 'on_standard'), a = cnt(k => k === 'due_soon' || k === 'below_standard' || k === 'needs_review');
    const r = cnt(k => k === 'overdue'), d = cnt(k => k === 'no_activity' || k === 'excused');
    const seg = (cls, c) => c ? `<span class="seg ${cls}" style="flex:${c}"></span>` : '';
    const leg = (cls, c, l) => c ? `<span class="it"><span class="dot ${cls}"></span><b>${c}</b> ${l}</span>` : '';
    const lineDot = (l) => /overdue/i.test(l) ? 'r' : /no activity/i.test(l) ? 'd' : /below|waiting|review/i.test(l) ? 'a' : /leads/i.test(l) ? 'g' : 'b';
    /* One block, not two. The standing bar used to be its own eyebrow ("Where the team stands")
       over its own card, and that card held nothing but a 12px bar and a legend — a heading and a
       container built for two marks, floating above a second heading and a second container that
       said the same thing in sentences. The bar is the picture and the read is the caption; they
       belong to each other. So the bar leads the read's card, a hairline separates it from the
       lines, and the screen loses a redundant heading and an empty frame. */
    return `${head}
    <div class="co-eyebrow tight">Today's read</div>
    <section class="card" style="padding:var(--s4)">
      ${entries.length ? `<div class="co-standing" style="margin-top:0">${seg('g', g)}${seg('a', a)}${seg('r', r)}${seg('d', d)}</div>
      <div class="co-legend" style="padding-bottom:var(--s4);border-bottom:1px solid var(--hairline-soft);margin-bottom:var(--s2)">${leg('g', g, 'on standard')}${leg('a', a, 'need attention')}${leg('r', r, 'overdue')}${leg('d', d, 'no activity')}</div>` : ''}
      ${lines.map(l => `<div style="display:flex;gap:10px;align-items:flex-start;padding:5px 0;font-size:13.5px;font-weight:600;color:var(--text);line-height:1.5"><span class="dot ${lineDot(l)}" style="width:7px;height:7px;border-radius:50%;margin-top:7px;flex:none"></span><span>${esc(l)}</span></div>`).join('')}
    </section>
    <div class="co-note">Computed from your roster's real logs — nothing here is generated.</div>

    ${weekSection()}
    <div class="co-bottom"></div>`;
  },
  mount(root) {
    loadMyBook().then(() => {
      const bookId = CD.roster && CD.roster.book[0] && CD.roster.book[0].id;
      if (bookId) loadInsights(bookId);
    });
    // Audit G-4/G-3 retries: the top gate refetches the roster; the week section refetches the rollup.
    const iRetry = root && root.querySelector('#insights-retry');
    if (iRetry) iRetry.addEventListener('click', () => { iRetry.disabled = true; loadMyBook(true).then(() => window.__render()); });
    const wRetry = root && root.querySelector('#insights-week-retry');
    if (wRetry) wRetry.addEventListener('click', () => {
      const bookId = CD.roster && CD.roster.book[0] && CD.roster.book[0].id;
      if (bookId) { wRetry.disabled = true; loadInsights(bookId, true); }
    });
  },
};
