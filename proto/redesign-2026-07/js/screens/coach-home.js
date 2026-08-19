import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { avatarHead, esc, safeImg, collapseSection, skeletonRows, errorState, emptyState, emailVerifyBanner, wireEmailVerifyBanner, copyText } from '../components.js';
import * as roles from '../roles.js';
import { CD, loadBook, bookKindFor, loadActivity, actTime, entriesFor, getScope, setScope, logBookIntervention, passWorthy, bookId } from '../coach-data.js';
import { buildPriorities } from '../priority.js';
import { nudgePreset, nudgeResultCopy } from '../nudge-presets.js';
import { PLANS } from '../ob2.js';
import { teamPulse } from '../status.js';
import { scoreColor } from '../score-band.js';
import { encodeQR, addQuietZone, qrSvg } from '../qr.js';
import { paintBoard } from './coach-commitments.js';
import { flagStateByMeal } from '../inbox.js';
import { allowedCreateKeys } from '../staff-access.js';
import { paintStandardsBoard } from './coach-connected.js';
import { maybeStartTour } from '../tour.js';

/* This screen is nav:'operator' — it renders for a coach's team AND a trainer's practice, so it
   must load whichever book the signed-in role owns. Calling loadCoachRoster() here would fetch
   teams a trainer doesn't have and leave them staring at an empty dashboard. */
const loadMyBook = (force) => loadBook(force, bookKindFor(RT.authRole));

/* Operator vocabulary. Every noun a shared operator screen renders resolves HERE, so no string
   hardcodes "team" and then lies to a trainer looking at their practice. */
const VOCAB = {
  team: {
    everyone: 'Entire team', mine: 'My athletes', priorities: 'Coach priorities',
    setup: 'Set up your team', loading: 'Loading your team…',
  },
  practice: {
    everyone: 'All clients', mine: 'My clients', priorities: 'Client priorities',
    setup: 'Set up your practice', loading: 'Loading your clients…',
  },
  // The dietitian/nutritionist lens (0197 practices.discipline): same book, same mechanics,
  // named for what this operator actually runs. Any sport — discipline describes the operator,
  // not the roster.
  nutrition: {
    everyone: 'All clients', mine: 'My clients', priorities: 'Client priorities',
    setup: 'Set up your nutrition practice', loading: 'Loading your clients…',
  },
  // The TEAM dietitian lens (0202 teams.discipline, the obd sign-up): a roster of athletes,
  // run by a nutrition professional. Team nouns, fueling priorities.
  teamNutrition: {
    everyone: 'Entire team', mine: 'My athletes', priorities: 'Fueling priorities',
    setup: 'Set up your team', loading: 'Loading your team…',
  },
};
/* CD.kind only settles after the first loadBook resolves, so a trainer's very first paint would
   flash team vocab — the signed-in role already knows the answer, so prefer it.
   ("Finish setting up…" became "Set up…" — founder 2026-08-10: the old header read as a nag,
   and on a practice book it literally never went away because trainer progress never persisted;
   0197 fixed the persistence, this fixes the tone.) */
const isPractice = () => CD.kind === 'practice' || RT.authRole === 'trainer';
/* The nutrition lens has THREE doors now, not one (2026-08-18): a nutrition practice (0197),
   a team whose OWNER is the dietitian (0202, the obd sign-up), or a staff member the head
   coach invited with the Dietitian chip (team_staff role 'nutritionist' — the invite that
   implicitly promised this board and never delivered it). */
export const isNutritionBook = () => (isPractice()
  ? !!(RT.practice && RT.practice.discipline === 'nutrition')
  : !!(RT.team && RT.team.discipline === 'nutrition') || (CD.extras && CD.extras.myRole) === 'nutritionist');
const vocab = () => VOCAB[isPractice()
  ? (RT.practice && RT.practice.discipline === 'nutrition' ? 'nutrition' : 'practice')
  : (isNutritionBook() ? 'teamNutrition' : 'team')];

/* Athlete-invite link + share text (mirrors the trainer's inviteLink/inviteShareText inline,
   the same way state.js mirrors src/core in plain JS). Empty code → empty string: never link or
   share a dead code before the team's join code is real. */
function inviteLink(code) {
  const c = (code || '').trim().toUpperCase();
  return c ? `https://onstandard.app/join?code=${c}` : '';
}
function inviteShareText(code, teamName) {
  const c = (code || '').trim().toUpperCase();
  if (!c) return '';
  const name = (teamName && teamName.trim()) || 'my team';
  return `Join ${name} on OnStandard. Use code ${c} or open ${inviteLink(c)}`;
}

/* SIGNATURE-matched invite card for the empty dashboard: the athlete code in boxes, a scannable
   QR, and Copy / Share — the coach's first useful action is to hand out the code. */
function coachInviteCard(code, teamName) {
  const link = inviteLink(code);
  const svg = qrSvg(addQuietZone(encodeQR(link, 'M')), 96, '#0B0D12', `QR code to join ${esc(teamName)}`);
  return `<section class="card" style="padding:18px">
    <div class="eyebrow" style="margin:0 0 10px">Invite code</div>
    <div class="code-boxes invite-code" style="padding:0;margin-bottom:14px">
      ${code.split('').map((ch) => `<div class="cb filled">${esc(ch)}</div>`).join('')}
    </div>
    <div style="display:flex;gap:14px;align-items:center">
      <div style="flex:none"><div class="hq-qr">${svg}</div><div class="hq-qcap">SCAN TO JOIN</div></div>
      <div style="flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.45">${isPractice() ? 'Clients scan the code or enter it to join your practice.' : 'Athletes scan the code or enter it to join your team.'} Only you hand it out.</div>
    </div>
    <div class="btn-row mt">
      <button class="btn ghost sm" id="coach-copy-code">${icon('clipboard', 16)} Copy code</button>
      <button class="btn sm" id="coach-share-invite" style="background:linear-gradient(150deg,var(--blue),var(--blue-deep));color:#fff">${icon('share', 16)} Share invite</button>
    </div>
  </section>`;
}

/* First-run checklist — real per-step completion, never a hardcoded "done". Each flag is a
   genuine signal: a shared code, a saved standard, touched notification prefs, a minted staff
   invite, a real group (persisted per-account in RT.coachSetup by act.markCoachSetup, or derived
   from live state). Athletes already on the roster imply the code was shared. */
export function coachSetupState() {
  const cs = (RT && RT.coachSetup) || {};
  const hasAthletes = !!(CD.roster && CD.roster.rows && CD.roster.rows.length);
  const groups = (CD.extras && CD.extras.groups) || [];
  const st = {
    sharedCode: !!cs.sharedCode || hasAthletes,
    standard: !!cs.standard,
    notif: RT.coachNotifPrefs != null || !!cs.notif,
    staff: !!cs.staff,
    group: !!cs.group || groups.length > 0,
    hasAthletes,
  };
  // Required = share code + review standard. "Team ready" and the amber gating key off these (T-05 #11).
  st.requiredDone = (st.sharedCode ? 1 : 0) + (st.standard ? 1 : 0);
  st.requiredTotal = 2;
  st.ready = st.requiredDone === st.requiredTotal;
  return st;
}
/* Setup steps split into REQUIRED (share code, review standard) and OPTIONAL. */
export function coachSetupSteps(st) {
  const practice = isPractice();
  const noun = practice ? 'client' : 'athlete';
  return {
    required: [
      { key: 'sharedCode', done: st.sharedCode, t: `Share your ${noun} code`,
        s: st.sharedCode ? `Shared. ${noun}s can join anytime` : `Invite ${noun}s to start tracking execution`,
        // coach-profile is nav:'coach' — the router silently bounces a trainer off it, so a
        // practice book routes to the Practice HQ, which owns the client-code invite card.
        go: practice ? 'trainer-profile' : 'coach-profile/code' },
      { key: 'standard', done: st.standard, t: 'Review your standard', s: 'Meals, windows, and requirements', go: 'coach-plan-set/team' },
    ],
    optional: [
      // coach-notif-settings is nav:'operator' (see screens/settings.js — trainerProfile links it
      // too), so the notification step is real on BOTH books. Staff invites stay team-only:
      // coach-profile/staff is genuinely nav:'coach' and a practice has no staff roles.
      { key: 'notif', done: st.notif, t: 'Set notification rules',
        s: practice ? 'When you and your clients get nudged' : 'When you and your athletes get nudged',
        go: 'coach-notif-settings' },
      ...(practice ? [] : [
        { key: 'staff', done: st.staff, t: 'Invite your staff', s: 'Coordinators, position coaches, and more', go: 'coach-profile/staff' },
      ]),
      // Until anyone has joined there is nothing to organize — the row used to render as a dead
      // 0.7-opacity "Soon" tap on a brand-new book (founder 2026-08-10: day zero showed a row
      // that did nothing). It appears the moment the roster is real.
      ...(st.hasAthletes ? [
        { key: 'group', done: st.group, t: practice ? 'Organize your clients' : 'Organize your roster',
          s: practice ? 'Group clients however you work' : 'Group by room or unit',
          go: practice ? 'trainer-roster' : 'coach-roster' },
      ] : []),
    ],
  };
}
function allSetupSteps(st) { const g = coachSetupSteps(st); return [...g.required, ...g.optional]; }
function setupIncompleteCount(st) { return allSetupSteps(st).filter((i) => !i.done).length; }

/* One checklist row. Done → green check; a required-incomplete step gets a BLUE numbered marker;
   optional-incomplete stays neutral.

   These were amber. Amber is the app's warning hue (streak at risk, off pace, injury), and a
   brand-new coach's very first screen was an amber-washed, amber-bordered, amber-numbered block
   telling them they had failed two things they had not yet had a chance to do. A setup checklist
   is a to-do list, not an alarm; blue is the accent that carries action.

   The incomplete markers used to be EMPTY 38px boxes — an amber square and a grey square with no
   glyph inside. At that size an empty bordered box reads as a failed image, not as "step not done
   yet", which is a large part of why the first-run screen looked broken. They now carry their
   step number (required) and a neutral dot (optional): same restraint, but they say something. */
function setupRow(i, required, n) {
  const marker = i.done
    ? `<div class="xico sm green">${icon('check', 15)}</div>`
    : required
      ? `<div class="xico sm" style="background:var(--blue-surface);border:1.5px solid var(--blue-border);color:var(--blue-bright);font-size:14px;font-weight:800">${n}</div>`
      : `<div class="xico sm gray"><span style="width:7px;height:7px;border-radius:50%;background:var(--text-3);display:block"></span></div>`;
  return `<div class="lrow" ${i.go ? `data-go="${i.go}" style="cursor:pointer"` : 'style="cursor:default;opacity:0.7"'}>
      ${marker}
      <div class="lm"><div class="lt">${esc(i.t)}</div><div class="ls">${esc(i.s)}</div></div>
      ${i.go ? icon('chevron', 17, 'style="color:var(--text-3)"') : (i.done ? '' : `<span style="font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-3)">Soon</span>`)}
    </div>`;
}
/* The onboarding plan pick, honored. The onboarding plan step captured a choice into RT.ob.plan
   and nothing ever read it — a coach "picked Starter", felt subscribed, landed here on the free
   preview, and would meet their plan again only by rediscovering it in Settings and choosing it a
   SECOND time. This card closes that loop: it names the plan they already picked and takes them to
   the real checkout, preselected. It disappears forever once they start checkout, dismiss it, or
   actually subscribe (module-cached subscription probe — never blocks render). */
const PLAN_CTA = { sub: undefined };   // undefined = not probed yet; null = probed, none
function obPlanCard() {
  const picked = RT.ob && RT.ob.plan;
  if (!picked || RT.obPlanCtaDone) return '';
  // Resolve from the operator plan lists (ob2.js) — the proto's planById knows only consumer
  // plans, and a consumer pick has its own rail (the IAP paywall), so it is correctly not here.
  const plan = [...PLANS.pro, ...PLANS.org, ...PLANS.seat].find((p) => p.id === picked && !p.custom);
  if (!plan) return '';
  if (PLAN_CTA.sub === undefined) {
    PLAN_CTA.sub = null;
    void (async () => {
      try {
        const s = await roles.fetchMySubscription();
        if (s && s.tier === 'team' && (s.status === 'active' || s.status === 'past_due')) {
          act.markObPlanCtaDone();   // already subscribed — the loop closed itself
          if (window.__render) window.__render();
        }
      } catch { /* keep showing; plan-upgrade routes an existing subscriber to the portal */ }
    })();
  }
  return `<div class="lrow" id="ob-plan-cta" style="margin:0 0 10px;background:linear-gradient(100deg, rgba(var(--green-rgb),0.10), rgba(var(--blue-rgb),0.05));border:1px solid var(--green-border);border-radius:var(--r-card-sm);padding:12px 13px;cursor:pointer">
    <div class="xico sm green">${icon('flame', 16)}</div>
    <div class="xr"><div class="xa">Your ${esc(plan.name)} plan is waiting</div>
    <div class="xb" style="white-space:normal;line-height:1.45">Free for 14 days. Nothing charges today.</div></div>
    <span class="xpill green">Start trial</span>
  </div>`;
}

/* Required + optional groups with a progress line. Required-incomplete carries a restrained BLUE
   tint (see setupRow: this is a to-do list, not a warning). Shared by the empty and populated
   dashboards, so guidance survives the first join. */
function setupChecklistCard(st) {
  const { required, optional } = coachSetupSteps(st);
  const left = st.requiredTotal - st.requiredDone;
  const progress = st.ready
    ? `<div style="display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;color:var(--green-bright);margin:0 2px 8px">${icon('check', 13)} Required setup complete</div>`
    : `<div style="font-size:11.5px;font-weight:800;letter-spacing:0.02em;color:var(--blue-bright);margin:0 2px 8px">${st.requiredDone} of ${st.requiredTotal} required steps done · ${left} to go</div>`;
  return `
    ${progress}
    <section class="card" style="padding:6px 16px;${st.ready ? '' : 'background:var(--blue-surface);border-color:var(--blue-border)'}">
      ${required.map((i, n) => setupRow(i, true, n + 1)).join('')}
    </section>
    <div class="eyebrow" style="margin-top:14px">Optional</div>
    <section class="card" style="padding:6px 16px">
      ${optional.map((i) => setupRow(i, false)).join('')}
    </section>`;
}

/* The muted "Team score —" tile that used to sit on the empty dashboard is gone with the three
   empty sections it headed (see emptyTeamDashboard). Its honesty rule still stands and is still
   enforced where a score CAN be shown: pulseCard() renders '—' rather than a fabricated 0 when
   no athlete has scored yet (T-13 / #do-not-show-active). */

/* Honest code-card state when there's no live code yet: loading / offline (with retry) / no team
   (with a real CREATE action) — never a fake "minting… a few seconds" (T-13). */
function codeStateBox() {
  const state = S.operatorIdentity.state;
  if (state === 'loading') {
    return `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">${esc(vocab().loading)}</div><div class="ts">Checking your ${isPractice() ? 'practice' : 'team'} and code.</div></div></div>`;
  }
  if (state === 'offline') {
    return `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('wifiOff', 17)}</div>
      <div style="flex:1"><div class="tt">Can't reach the server</div><div class="ts">Your code is safe — reconnect and it shows right here.</div>
      <button class="btn ghost sm" id="coach-team-retry" style="width:auto;padding:0 16px;margin-top:8px">${icon('wifiOff', 15)} Try again</button></div></div>`;
  }
  /* state === 'minting': signed in as a coach with NO team row. This used to claim a code was
     being created and tell the coach to reopen the app — but nothing was minting and nothing
     retried, so a create_team that failed during signup ended the product for that account.
     It is now the one thing it should always have been: a form that creates the team. */
  if (isPractice()) {
    // A trainer has no team row to create — the practice (and its client code) is minted by
    // trainer onboarding on the server. The Practice HQ owns that state honestly; send them there
    // instead of a coach team-create form that would write a team row onto a trainer account.
    return `<section class="card" style="padding:18px">
      <div class="eyebrow" style="margin:0 0 10px">Your client code</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.45;margin-bottom:12px">Your practice isn't fully set up on the server yet, so there's no client code to hand out. Your Practice HQ shows it the moment it exists.</div>
      <button class="btn sm" data-go="trainer-profile" style="width:100%;background:linear-gradient(150deg,var(--blue),var(--blue-deep));color:#fff">${icon('user', 16)} Open Practice HQ</button>
    </section>`;
  }
  const ob = (RT.ob && RT.ob.coach) || {};
  const suggested = ob.teamName || (RT.profile && RT.profile.school) || '';
  return `<section class="card" style="padding:18px">
    <div class="eyebrow" style="margin:0 0 10px">Create your team</div>
    <div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.45;margin-bottom:12px">Your team isn't set up yet, so there's no athlete code to hand out. Name it and we'll create it now.</div>
    <input id="coach-team-name" type="text" class="input" placeholder="e.g. Lincoln Varsity Football"
      value="${esc(suggested)}" autocomplete="organization" maxlength="60"
      style="width:100%;height:46px;margin-bottom:12px" />
    <button class="btn sm" id="coach-team-create" style="width:100%;background:linear-gradient(150deg,var(--blue),var(--blue-deep));color:#fff">${icon('users', 16)} Create team</button>
    <div id="coach-team-err" style="font-size:12px;font-weight:700;color:var(--red);margin-top:9px;line-height:1.4"></div>
  </section>`;
}

/* The truthful empty dashboard: readiness gate first (amber "Let's get your team ready" until the
   required steps are done, then green "ready"), the invite code, the required/optional setup, and a
   muted team-status tile below the actionable content (F7). Never a fabricated score or fake mint. */
export function emptyTeamDashboard(code, teamName) {
  const st = coachSetupState();
  /* Day zero has exactly one job: get the code into athletes' hands. Everything else is noise
     until someone joins, so this screen is now ordered by what the coach can actually DO.

     What was here before: a ~200px hero card that pushed the invite code — the only working
     action on the screen — below the fold, and then THREE consecutive empty sections ("Team
     status" with a muted em-dash tile, "Roster: no athletes yet", "Live activity: no logs yet")
     each with its own eyebrow. Four headings announcing nothing reads as a broken dashboard,
     not an empty one. They collapse into a single honest line about what fills in and when.

     The readiness state is not lost — setupChecklistCard() already prints "N of 2 required steps
     done", so the hero card was restating its own checklist a card early. */
  /* The line must not promise a code that isn't on screen: with no team yet the card below is a
     CREATE form, not an invite code. */
  const practice = isPractice();
  const bookWord = practice ? 'practice' : 'team';
  const noun = practice ? 'clients' : 'athletes';
  const orient = !code
    ? `<div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin:0 2px 12px;line-height:1.45">Set your ${bookWord} up below to get the code ${noun} join with.</div>`
    : st.ready
      ? `<div style="display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:var(--green-bright);margin:0 2px 12px;line-height:1.45">${icon('check', 14)} Your ${bookWord} is ready. Hand out the code and your board fills in as ${noun} log.</div>`
      : `<div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin:0 2px 12px;line-height:1.45">No ${noun} yet. Hand out the code below — your roster, live activity, and ${bookWord} score all fill in from their logs.</div>`;
  return `
    ${orient}
    ${'' /* data-tour wraps card OR create-form: a brand-new operator's tour opens on this, the
          one action day zero actually has — the board anchors below don't exist yet. */}
    <div data-tour="invite">${code ? coachInviteCard(code, teamName) : codeStateBox()}</div>
    ${obPlanCard()}
    ${/* Setup card, honestly sized to its state (founder, 2026-08-06): while required steps are
          open it stays a full inline checklist — day zero's whole job. Once both required steps
          are done it collapses to the same one-line section the populated board uses (optional
          steps inside), and once EVERYTHING is done it leaves the screen entirely — a finished
          checklist parked on Home forever read as the app nagging about nothing. */''}
    ${/* While the team is still LOADING the checklist's inputs are unknown — sharedCode derives
          from the roster, which hasn't arrived. This used to render "0 of 2 required steps done ·
          2 to go" directly under a card saying "Loading your team…": the screen admitting it
          doesn't know and asserting a count in the same viewport. Don't grade what hasn't loaded. */''}
    ${S.operatorIdentity.state === 'loading' ? ''
    : st.ready
      ? (setupIncompleteCount(st) ? collapseSection('coach-setup', vocab().setup, setupIncompleteCount(st), setupChecklistCard(st), false) : '')
      : `<div class="eyebrow">${esc(vocab().setup)}</div>${setupChecklistCard(st)}`}
    <div class="eyebrow">What fills in next</div>
    <section class="card" style="padding:13px 16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-3);line-height:1.55">Once ${noun} join with your code, this screen becomes your command center: today's ${bookWord} score, who's on standard, who needs a nudge, and every meal as it's logged.</div>
    </section>
    <div class="co-bottom"></div>`;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
let SHOW_SCOPES = false;        // scope sheet open?
let SHOW_PULSE = false;         // pulse breakdown open?

/* Trust Pass milestone (0196): who just earned a reward and holds no active pass yet, from the
   roster's own active-pass map. Same batch call the roster's trust-pass section already makes
   (roles.fetchRosterPasses), just cached separately per screen so a route this screen doesn't
   share can't leave a stale map behind. */
let TP_MAP = null;
let tpMapLoading = false;
async function loadPassMap(force) {
  if (tpMapLoading || (TP_MAP && !force)) return;
  const rows = CD.roster ? CD.roster.rows : [];
  if (!rows.length) return;
  tpMapLoading = true;
  try {
    const m = await roles.fetchRosterPasses(rows.map((r) => r.athleteId));
    // null = FAILED: leave TP_MAP unset (the milestone card simply doesn't render) rather than
    // caching an empty map that claims nobody has a pass.
    if (m !== null) TP_MAP = m;
  }
  catch { /* keep last-known; a later load retries */ }
  finally { tpMapLoading = false; }
  // Exact match, not a prefix: 'coach' alone must not catch 'coach-roster' repainting into a
  // screen the operator already left.
  if (['#coach-home', '#coach', '#trainer'].includes(location.hash || '') && window.__render) window.__render();
}

function scopeLabel(scope) {
  // Slice F: a scoped staff member's 'team' view is already server-narrowed to their
  // responsibility (0078) — calling it "Entire team" would overstate what they see.
  if (!scope || scope.kind === 'team') return (CD.extras && CD.extras.scope) ? vocab().mine : vocab().everyone;
  if (scope.kind === 'position') return `${scope.value} room`;
  if (scope.kind === 'group') {
    const g = ((CD.extras && CD.extras.groups) || []).find(x => x.id === scope.value);
    return g ? g.name : 'Group';
  }
  if (scope.kind === 'athlete') {
    const r = CD.roster && CD.roster.rows.find(x => x.athleteId === scope.value);
    return r ? r.name : (CD.kind === 'practice' ? 'One client' : 'One athlete');
  }
  return vocab().everyone;
}

function scopeSheet() {
  const rows = CD.roster ? CD.roster.rows : [];
  const positions = [...new Set(rows.map(r => (r.position || '').toUpperCase()).filter(Boolean))].sort();
  const groups = (CD.extras && CD.extras.groups) || [];
  const chip = (kind, value, label, active) => `
    <button class="btn ${active ? 'green' : 'ghost'} sm" data-scope="${esc(kind)}:${esc(value == null ? '' : value)}"
      style="width:auto;padding:0 13px;height:32px;margin:0 6px 6px 0">${esc(label)}</button>`;
  const cur = getScope();
  const is = (k, v) => cur.kind === k && String(cur.value || '') === String(v || '');
  return `
  <section class="card" style="padding:13px 16px">
    <div class="eyebrow" style="margin:0 0 8px">Who you're looking at</div>
    <div>${chip('team', '', (CD.extras && CD.extras.scope) ? vocab().mine : vocab().everyone, is('team', ''))}
    ${positions.map(p => chip('position', p, `${p} room`, is('position', p))).join('')}
    ${groups.map(g => chip('group', g.id, g.name, is('group', g.id))).join('')}</div>
    <div style="font-size:11.5px;color:var(--text-3);font-weight:600;margin-top:4px">Custom groups are built on the ${CD.kind === 'practice' ? 'Clients' : 'Roster'} tab.</div>
  </section>`;
}

/* SIGNATURE — Team Pulse standing bar: the group score in the blue→teal signature,
   the roster's real live standing as one honest proportional bar. */
function pulseCard(rows, statuses) {
  const p = teamPulse(rows, statuses, roles.todayISO());
  if (p.avg == null && !rows.length) return '';
  const keys = Object.values(statuses).map(s => s.key);
  const count = (pred) => keys.filter(pred).length;
  const g = count(k => k === 'on_standard');
  const a = count(k => k === 'due_soon' || k === 'below_standard' || k === 'needs_review');
  const r = count(k => k === 'overdue');
  const d = count(k => k === 'no_activity' || k === 'excused');
  const seg = (cls, c) => c ? `<span class="seg ${cls}" style="flex:${c}"></span>` : '';
  const leg = (cls, c, label) => c ? `<span class="it"><span class="dot ${cls}"></span><b>${c}</b> ${label}</span>` : '';
  const delta = p.deltaVsYesterday;
  const dCls = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const dTxt = delta == null ? 'First day of data' : delta === 0 ? 'Even with yesterday'
    : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} vs yesterday`;
  const scored = rows.filter(x => x.score != null).length;
  return `
  <section class="co-pulse tappable" data-pulse>
    <div class="co-pulse-top">
      <div class="co-pulse-score">
        <div class="k">Group score</div>
        <div class="num">${p.avg != null ? p.avg : '—'}</div>
        <div class="delta ${dCls}">${esc(dTxt)}</div>
      </div>
      <div class="co-pulse-done"><div class="v">${p.completionPct != null ? p.completionPct + '%' : '—'}</div><div class="k">Done today</div></div>
    </div>
    <div class="co-standing">${seg('g', g)}${seg('a', a)}${seg('r', r)}${seg('d', d)}</div>
    <div class="co-legend">${leg('g', g, 'on standard')}${leg('a', a, 'need attention')}${leg('r', r, 'overdue')}${leg('d', d, 'no activity')}</div>
    ${SHOW_PULSE ? `<div style="border-top:1px solid var(--hairline-soft);margin-top:var(--s3);padding-top:var(--s3);font-size:12px;font-weight:600;color:var(--text-2);line-height:1.6">The group score averages today's real ${CD.noun} scores (${scored} of ${rows.length} scored so far). The bar is your roster's live standing — nothing is estimated; a ${CD.noun} with no log adds no score.</div>` : ''}
  </section>`;
}

/* ---------- The dietitian's board (0197 discipline lens) ----------
   Two sections the Nutrition Pro onboarding promised and the product never built: the meal
   review queue (every client meal from the last 7 days, unopened first, straight into the
   operator meal screen) and per-client fueling (daily protein totals, aggregated CLIENT-SIDE
   from the same meals rows — day rows carry no protein column, per the 0103 grant split).
   Painted async into #nut-board-slot so the fetch never delays the priority queue; the slot
   only exists on a practice whose discipline is 'nutrition'. Data: fetchTeamActivity WITH
   athleteIds (roles.js's capacity note: omitting ids defeats the meals index). 60s cache so
   tab-flipping costs one fetch a minute, same posture as the PAST cache on home. */
const NUT = { key: '', rows: null, flags: {}, targets: {}, photos: {}, err: false, at: 0 };
async function paintNutritionBoard(root) {
  const slot = root.querySelector('#nut-board-slot');
  if (!slot) return;
  const rows = (CD.roster && CD.roster.rows) || [];
  const ids = rows.map((r) => r.athleteId).filter(Boolean);
  if (!ids.length) {
    // A brand-new dietitian's board must EXIST before their first client does. The obd/obn
    // flows promise "the meal queue and fueling board are live the moment you open your
    // dashboard" — a silently absent section read as that promise breaking.
    slot.innerHTML = `
    <div class="eyebrow co-major">Meal review</div>
    ${emptyState({
      icon: 'bowl',
      title: 'Your review queue is ready for its first plate',
      body: `The moment a ${CD.kind === 'practice' ? 'client' : 'teammate'} logs a meal it lands here, flags first. Share your code from your HQ to bring the first one in.`,
    })}`;
    return;
  }
  const key = ids.slice().sort().join(',');
  let meals = NUT.rows;
  if (NUT.key !== key || Date.now() - NUT.at > 60000) {
    // The four-states law: while the FIRST load is in flight the slot shows a skeleton shaped
    // like the queue it stands in for, never a blank gap the sections below jump into.
    if (NUT.key !== key || !NUT.rows) {
      slot.innerHTML = `<div class="eyebrow co-major">Meal review</div>${skeletonRows(2, 'Loading meals')}`;
    }
    // Meals + flags fetched together on the same cadence: the flame state (0199) rides
    // coach_interventions, latest row wins per 'flag:meal:<id>' — flagStateByMeal is the same
    // reader the inbox categorizer uses, so the two surfaces can never disagree.
    // Book-aware since 0202: the board serves practice books AND nutrition team books, so the
    // flag read hangs off whichever owner the current book actually is.
    const [fetched, iv, tg] = await Promise.all([
      roles.fetchTeamActivity(roles.daysAgoISO(6), 400, ids).catch(() => null),
      roles.fetchRecentInterventions(bookId(), roles.daysAgoISO(13), CD.kind).catch(() => null),
      // Coach-set targets for the risk ranking (0205 batch RPC, one round trip for the roster).
      // null = FAILED or pre-0205 server: the board ranks by coverage alone and shows no
      // targets -- degraded, never fabricated -- so this read joins neither NUT.err branch.
      roles.fetchPlanMetaBatch(ids).catch(() => null),
    ]);
    meals = fetched;
    // Either read failing means the queue is not the whole truth: a lost interventions read
    // would otherwise clear every flame off meals that are still flagged on the server.
    NUT.err = meals === null || iv === null;
    // A failed targets read is DEGRADED ranking, not a missing feature — the foot says which.
    NUT.tFail = tg === null;
    if (meals === null && NUT.key === key) meals = NUT.rows; // keep last-known on a flaky fetch
    const flags = iv === null ? (NUT.key === key ? NUT.flags : {}) : flagStateByMeal(iv);
    const targets = tg === null ? (NUT.key === key ? NUT.targets : {}) : tg;
    NUT.key = key; NUT.rows = meals || []; NUT.flags = flags || {}; NUT.targets = targets || {}; NUT.photos = {}; NUT.at = Date.now();
  }
  if (!slot.isConnected) return;
  meals = NUT.rows || [];
  // "Client" on a practice, "Athlete" on a team book — the noun follows the roster.
  const fallbackNoun = CD.kind === 'practice' ? 'Client' : 'Athlete';
  const nameOf = {};
  for (const r of rows) nameOf[r.athleteId] = r.name || fallbackNoun;
  // First names alone collide on real rosters (two Mayas are indistinguishable in a queue).
  // A colliding first name carries its last initial; unique ones stay short. One map, used by
  // the queue and the fueling table alike so the two sections never name one athlete two ways.
  const firstCount = {};
  for (const r of rows) { const f = ((r.name || fallbackNoun).split(' ')[0]); firstCount[f] = (firstCount[f] || 0) + 1; }
  const shortName = (id) => {
    const parts = (nameOf[id] || fallbackNoun).split(' ');
    return firstCount[parts[0]] > 1 && parts[1] ? `${parts[0]} ${parts[1][0]}.` : parts[0];
  };
  const seen = new Set(RT.coachSeenMealIds || []);
  const isFlagged = (id) => !!(NUT.flags[id] && NUT.flags[id].kind === 'flag');

  // Queue: flags lead (the demo's "your Monday starts with the flags"), then unopened, then
  // the rest — newest first within each band.
  const byNew = meals.slice().sort((a, b) => String(b.logged_at || '').localeCompare(String(a.logged_at || '')));
  const queue = [
    ...byNew.filter((m) => isFlagged(m.id)),
    ...byNew.filter((m) => !isFlagged(m.id) && !seen.has(m.id)),
    ...byNew.filter((m) => !isFlagged(m.id) && seen.has(m.id)),
  ].slice(0, 6);
  const unopened = byNew.filter((m) => !seen.has(m.id)).length;
  const flaggedCount = byNew.filter((m) => isFlagged(m.id)).length;

  // The plate itself leads each row. A dietitian reviews FOOD; a queue of identical icons made
  // them read a list about meals instead of looking at meals. Signed thumbs, ≤6 per paint,
  // re-signed with each 60s refetch so a URL can never outlive its hour. Best-effort: a missing
  // photo falls back to the bowl tile and costs nothing.
  const need = queue.filter((m) => m.photo_path && NUT.photos[m.id] === undefined);
  if (need.length) {
    // One createSignedUrls round trip for the batch (scale pass 2026-08-18), not one per thumb.
    const map = await roles.signedMealPhotoUrls(need.map((m) => m.photo_path)).catch(() => ({}));
    need.forEach((m) => { NUT.photos[m.id] = (map && map[m.photo_path]) || null; });
    if (!slot.isConnected) return;
  }

  const qRows = queue.map((m) => {
    const flagged = isFlagged(m.id);
    const isNew = !seen.has(m.id);
    const ph = NUT.photos[m.id] ? safeImg(NUT.photos[m.id]) : '';
    // Protein, time, state — and nothing else. The meal score also lived here and pushed the
    // state word onto a ragged second line at phone width (seen in the render QC); the score is
    // one tap away on the meal itself, and the dietitian's scan number is protein.
    const bits = [
      m.protein != null ? `~${m.protein}g protein` : null,
      actTime(m.logged_at),
      flagged ? 'flagged' : isNew ? 'new' : null,
    ].filter(Boolean);
    return `
    <div class="lrow" data-go="coach-meal/${esc(m.id)}" role="button" tabindex="0" style="cursor:pointer">
      <div class="nbq-ph${ph ? '' : ' empty'}">${ph ? `<img src="${esc(ph)}" alt="" loading="lazy"/>` : icon('bowl', 16)}${isNew && !flagged ? '<span class="nbq-dot" aria-hidden="true"></span>' : ''}</div>
      <div class="lm"><div class="lt">${esc(shortName(m.athlete_id))} · ${esc(cap(m.type || 'Meal'))}${flagged ? ` <span class="nbq-flame">${icon('flame', 11)}</span>` : ''}</div>
      <div class="ls">${esc(bits.join(' · '))}</div></div>
      ${icon('chevron', 14, 'class="chev-dim"')}
    </div>`;
  }).join('');

  // Fueling: per client, protein summed per day over the last 7 days, ranked by RISK rather
  // than raw average. The old sort (lightest avg first) hid the riskiest pattern: an athlete
  // logging 2 of 7 days can post a healthy-looking average while five days go unseen -- the
  // render QC caught the table calling an athlete fine mid-table while the priority stack named
  // the same athlete critical one scroll later. Risk = coverage x adequacy-vs-target, lowest
  // first; targets are the coach_set_goals values via the 0205 batch RPC, and a failed or
  // pre-0205 read degrades to coverage-alone ranking. Honest denominators stand: the average is
  // over days that HAVE a log, said out loud per row. The strips wear nutrition's own hue
  // (green paired with green-deep, the gradient law) — this is domain data, not a score
  // surface, so the sweep stays off it.
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(roles.daysAgoISO(i));
  const tmap = NUT.targets || {};
  const perClient = ids.map((id) => {
    const mine = meals.filter((m) => m.athlete_id === id);
    const totals = days.map((d) => mine.filter((m) => m.day_date === d)
      .reduce((s, m) => s + (Number(m.protein) || 0), 0));
    const kcals = days.map((d) => mine.filter((m) => m.day_date === d)
      .reduce((s, m) => s + (Number(m.kcal) || 0), 0));
    const loggedDays = totals.filter((t) => t > 0).length;
    const avg = loggedDays ? Math.round(totals.reduce((s, t) => s + t, 0) / loggedDays) : 0;
    const kcalDays = kcals.filter((k) => k > 0).length;
    const kcalAvg = kcalDays ? Math.round(kcals.reduce((s, k) => s + k, 0) / kcalDays) : 0;
    const target = Number(((tmap[id] || {}).targets || {}).protein) || null;
    const pct = target ? avg / target : null;
    // Lower = riskier. No target -> adequacy counts as met, so coverage alone ranks the row.
    const risk = (loggedDays / 7) * Math.min(1, pct == null ? 1 : pct);
    return { id, totals, loggedDays, avg, kcalAvg, target, pct, risk };
  }).filter((c) => c.loggedDays > 0)
    .sort((a, b) => a.risk - b.risk || a.avg - b.avg).slice(0, 8);
  const hasTargets = perClient.some((c) => c.target);
  const fRows = perClient.map((c) => {
    const first = shortName(c.id);
    const low = c.loggedDays <= 3;                 // half the week or more unseen
    const under = c.pct != null && c.pct < 0.75;   // genuinely off pace: the warning hue is earned
    // With a target the bars share ITS scale, so a short bar means "under target", not "under
    // this athlete's own best day". Without one, the row's own max keeps the relative read.
    const max = Math.max(c.target || 60, ...c.totals);
    const line1 = c.target ? `~${c.avg}g of ${c.target}g`
      : c.kcalAvg ? `~${c.avg}g · ${c.kcalAvg.toLocaleString()} kcal` : `~${c.avg}g avg`;
    const label = `${first}: about ${c.avg}g protein a day`
      + (c.target ? ` against a ${c.target}g target` : '')
      + (c.kcalAvg ? `, about ${c.kcalAvg} calories` : '')
      + `, ${c.loggedDays} of 7 days logged`;
    return `
    <div class="nb-row" data-go="coach-athlete/${esc(c.id)}" role="button" tabindex="0">
      <span class="nb-name" title="${esc(nameOf[c.id] || first)}">${esc(first)}</span>
      <span class="nb-bars" role="img" aria-label="${esc(label)}">${c.totals.map((t) => `<i style="height:${t ? Math.max(14, Math.round((t / max) * 100)) : 6}%${t ? '' : ';opacity:0.3'}"></i>`).join('')}</span>
      <span class="nb-avg"><b${under ? ' class="warn"' : ''}>${esc(line1)}</b><i${low ? ' class="warn"' : ''}>${c.loggedDays} of 7 days</i></span>
    </div>`;
  }).join('');

  // A count is a signal, not a boast: past 99 the exact number stops informing and starts
  // reading as notification-badge inflation ("114 NEW" in the render QC).
  const capN = (n) => (n > 99 ? '99+' : n);
  slot.innerHTML = `
    <div class="eyebrow co-major" style="display:flex;justify-content:space-between;align-items:baseline"><span>Meal review</span>${flaggedCount ? `<span style="color:var(--amber-bright)">${capN(flaggedCount)} flagged</span>` : unopened ? `<span style="color:var(--blue-bright)">${capN(unopened)} to review</span>` : ''}</div>
    ${queue.length ? `<section class="card" style="padding:6px 16px">${qRows}</section>
    <div class="nb-foot"><span class="link" data-go="${CD.kind === 'practice' ? 'trainer-inbox' : 'coach-inbox'}" role="button">The full queue lives in your Inbox</span></div>`
    : NUT.err ? `<div class="nb-foot">Couldn't reach the server for the queue. <span class="link" id="nut-retry" role="button" tabindex="0">Try again</span></div>`
    : `<div class="nb-foot">No ${fallbackNoun.toLowerCase()} meals in the last 7 days. Every logged meal lands here for review.</div>`}
    ${perClient.length ? `
    <div class="eyebrow">${fallbackNoun} fueling · last 7 days</div>
    <section class="card" style="padding:10px 16px 12px">${fRows}</section>
    <div class="nb-foot">${hasTargets
      ? 'Riskiest first: fewest logged days, furthest under their protein target. Averages count logged days only.'
      : NUT.tFail
        ? 'Targets couldn’t load just now, so this ranks by logged days alone. Nothing here is made up.'
        : 'Riskiest first: fewest logged days, lightest plates. Averages count logged days only; set protein targets to rank against them.'}</div>`
    : `
    <div class="eyebrow">${fallbackNoun} fueling · last 7 days</div>
    <div class="nb-foot">No logged days yet this week. Each ${fallbackNoun.toLowerCase()}'s protein pattern builds here as meals come in.</div>`}`;
  // A dead-end error line violates the house errorState contract (honest failure PLUS retry):
  // force the cache stale and repaint, right here, instead of "reopen the screen".
  const nutRetry = slot.querySelector('#nut-retry');
  if (nutRetry) nutRetry.addEventListener('click', () => {
    nutRetry.textContent = 'Trying…';
    NUT.at = 0;
    paintNutritionBoard(root);
  });
}

/* Ranked priority — calm hierarchy, one primary action by tier, the rest subordinate. */
function priorityCard(c, i, nudgedToday) {
  const tier = c.tier === 'critical' ? 'critical' : c.tier === 'below' ? 'below' : 'due';
  // needs_review also tiers as 'below', but "Below standard" would contradict its own reason
  // line ("logged today — score pending"). Name it honestly when that's the actual status.
  const tierLbl = c.statusKey === 'needs_review' ? 'Needs review' : { critical: 'Critical', below: 'Below standard', due: 'Due soon' }[tier];
  // Empty string, not --text-3, when there's no score: .co-pri supplies its own colour there.
  const scoreCol = c.score == null ? '' : scoreColor(c.score);
  const openPrimary = tier === 'below';  // below-standard → review the log; critical/due → send the nudge
  const nudgeCls = !openPrimary ? (tier === 'critical' ? 'primary warn' : 'primary') : '';
  // Rank weight. #1 leads (raised, filled action); #2+ subordinate (tighter, tinted action).
  // See the "rank hierarchy" block in coach.css — every action survives, only weight changes.
  const rankCls = i === 0 ? 'lead' : 'sub';
  return `
  ${/* data-vt-row: changing the scope re-filters and re-ranks this queue, and the rank IS the
        message — a board that snaps into a new order makes the coach re-read all six cards to
        find out who moved. Keyed on the athlete, never the rank: a rank is the slot, and keying
        on it would tween card 1 into card 2 as if the person had changed rather than the
        ordering. See window.__restate() in js/router.js. */''}
  <div class="co-pri ${rankCls} t-${tier}" data-vt-row="pri-${esc(c.athleteId)}">
    <div class="co-pri-head" data-go="coach-athlete/${esc(c.athleteId)}">
      <div class="co-pri-rank">${i + 1}</div>
      <div class="co-pri-main">
        <div class="co-pri-name">${esc(c.name)}${c.unit ? `<span class="pos">${esc(c.unit)}</span>` : ''}<span class="co-tier t-${tier}">${tierLbl}</span></div>
        ${c.reasons.map(r => `<div class="co-pri-reason">${esc(r)}</div>`).join('')}
      </div>
      ${c.score != null ? `<div class="co-pri-score" style="color:${scoreCol}">${c.score}</div>` : ''}
    </div>
    <div class="co-pri-acts">
      <button class="co-abtn ${openPrimary ? 'primary' : ''}" data-go="coach-athlete/${esc(c.athleteId)}">${openPrimary ? 'Review' : 'Open'}</button>
      <button class="co-abtn ${nudgeCls}" data-pnudge="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}" ${nudgedToday ? 'disabled' : ''}>${nudgedToday ? `Nudged ${icon('check', 11)}` : 'Nudge'}</button>
      ${/* Book caps say what the BOOK supports; the staff role says what THIS operator may do.
            Gating on caps alone rendered Assign for an invited nutritionist, whose role has no
            'assign' -- the server refuses it, violating staff-access.js's own contract ("a role
            never stares at buttons the server would bounce"). allowedCreateKeys fails open to
            the head-coach set on a null role, so the owner and a still-loading role keep it. */''}
      ${CD.caps.assignments && allowedCreateKeys(CD.extras && CD.extras.myRole).includes('assign') ? `<button class="co-abtn" data-passign="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}">Assign</button>` : ''}
      ${CD.caps.interventions ? `<button class="co-abtn" data-phandle="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}">Handled</button>` : ''}
    </div>
    ${PNUDGE_ARM && PNUDGE_ARM.athleteId === c.athleteId ? `
    <div style="display:flex;gap:6px;align-items:center;margin-top:8px">
      <input id="pnudge-body" class="ob-input" maxlength="120" value="${esc(PNUDGE_ARM.body)}" aria-label="Nudge message" style="flex:1;height:36px;font-size:var(--t-sm)" />
      <button class="co-abtn" data-pnudge-cancel="1">Cancel</button>
      <button class="co-abtn primary" data-pnudge-send="${esc(c.athleteId)}" data-key="${esc(c.reasonKey)}" data-tier="${esc(c.tier)}">Send</button>
    </div>
    <div class="co-pri-reason" style="margin-top:4px">This exact message goes to them, from "${esc(S.operatorIdentity.handle)} is waiting".</div>` : ''}
    <div class="co-pstatus" id="pstatus-${esc(c.athleteId)}"></div>
  </div>`;
}

/* The nudge preview open on one priority card ({ athleteId, body }), or null. The coach reads
   and can edit the exact words before anything is sent in their name. */
let PNUDGE_ARM = null;

export const coachHome = {
  nav: 'operator', tab: 'home',
  render() {
    const me = S.operatorIdentity;
    const teamName = CD.roster && CD.roster.book[0] ? CD.roster.book[0].name : me.bookName;
    const scope = getScope();
    // One `head` variable feeds every early return below (loading/offline/empty/populated) —
    // appending here covers the whole screen in one place, unlike home.js which repeats the call
    // at each of its own four render branches.
    // The scope chip directly below owns the scope; repeating scopeLabel() here had the header
    // and the chip saying "Entire team" two lines apart (critique 2026-08-18).
    const head = avatarHead(`${S.greeting}, ${me.handle}`, `${teamName} · today`, me.initials) + emailVerifyBanner();
    if (CD.roster === null) return `${head}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
      <div><div class="tt">${esc(vocab().loading)}</div><div class="ts">Pulling today's real numbers.</div></div></div>`;
    if (CD.roster.offline) return `${head}${errorState({
      title: "Can't reach your team",
      body: 'Nothing is lost. Reconnect and today loads right here.',
      retryId: 'home-retry',
    })}`;
    if (!CD.roster.rows.length) {
      // operatorIdentity resolves the code for either book — RT.team is never populated for a
      // trainer, so reading it here hid a live practice code behind the coach create-team form.
      const code = S.operatorIdentity.code;
      const teamNm = (CD.roster.teams[0] && CD.roster.teams[0].name) || teamName;
      return `${head}${emptyTeamDashboard(code, teamNm)}`;
    }

    const entries = entriesFor(scope);
    const statuses = {}; if (entries) for (const e of entries) statuses[e.row.athleteId] = e.status;
    const rows = entries ? entries.map(e => e.row) : [];
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowMs = now.getTime();
    const cards = entries ? buildPriorities({ nowMin, nowMs, entries, interventions: (CD.extras && CD.extras.interventions) || [] }) : [];
    const pending = CD.roster.pending || [];
    const seen = new Set(RT.coachSeenMealIds || []);
    const feed = CD.act && CD.act.rows ? CD.act.rows.filter(m => rows.some(r => r.athleteId === m.athlete_id)) : null;
    const unseen = feed ? feed.filter(m => !seen.has(m.id)).length : 0;
    const unreadAlerts = S.unreadNotifs;
    /* Follow-ups carries what is NOT already on this screen, and nothing else.
       It used to carry four rows, three of which restated something the coach could see without
       scrolling: "N logs you haven't opened" (the Live activity eyebrow prints "N new" directly
       above it), "N join requests waiting" (a tappable card at the very top of the same screen),
       and "N priorities not handled yet" (the queue itself, immediately above). Roughly 230px at
       the end of the morning read that told the coach nothing they had not just read, and made
       the screen's last impression a summary of itself.

       Server alerts (0027 — flagged meals, roll-call escalations, digests) stay: their only other
       surface is a numeric badge on the bell in the header, which is chrome, not content. When
       there are none the section resolves to "All caught up." and the screen ends on the queue. */
    const followUps = [
      unreadAlerts ? { n: unreadAlerts, t: `Alert${unreadAlerts > 1 ? 's' : ''} in your bell`, go: 'notifications' } : null,
    ].filter(Boolean);

    // Trust Pass milestone (0196): at most ONE card, so a large roster crossing the bar in the
    // same week becomes a single moment, not a queue. Ranked by streak in passWorthy, so the
    // athlete closest to (or furthest past) the bar surfaces first.
    const worthy = CD.caps.trustPass && TP_MAP ? passWorthy(rows, TP_MAP) : [];
    const milestone = worthy.length ? `
    <div class="sidebox" style="border-color:var(--purple-border)">
      <div class="req-icon p" style="width:38px;height:38px">${icon('shield', 17)}</div>
      <div style="flex:1"><div class="tt">${esc(worthy[0].row.name)} hit ${worthy[0].streak} straight days</div>
      <div class="ts">Reward it with camera-free meals.</div></div>
      <button class="btn sm" data-go="pass-grant/${esc(worthy[0].row.athleteId)}" style="width:auto;padding:0 12px;height:30px;flex:none">Give a pass</button>
    </div>` : '';

    return `${head}
    <button class="btn ghost sm" data-scopes data-tour="roster" style="width:auto;padding:0 13px;height:30px;margin-bottom:10px">${icon('users', 13)} ${esc(scopeLabel(scope))} ${icon('chevron', 12, 'style="transform:rotate(90deg)"')}</button>
    ${SHOW_SCOPES ? scopeSheet() : ''}
    ${pending.length ? `<div class="card" data-go="coach-inbox" style="padding:10px 15px;cursor:pointer;display:flex;align-items:center;gap:10px"><div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('user', 15)}</div><div style="flex:1;font-size:12.5px;font-weight:700">${pending.length} join request${pending.length > 1 ? 's' : ''} waiting</div>${icon('chevron', 14, 'style="color:var(--text-3)"')}</div>` : ''}
    ${milestone}
    ${/* The dietitian's board (0197/0202 discipline lens): a meal review queue + per-athlete
          fueling trends, painted async into this slot so the fetch never delays the priority
          queue. Emitted on any nutrition book — practice, dietitian-owned team, or invited
          team nutritionist. It LEADS the screen there (critique 2026-08-18: the queue is the
          dietitian's whole day, and it sat third under a coach-shaped hero), with the group
          pulse reading second. Every other book renders byte-identical to before. */''}
    ${isNutritionBook() ? '<div id="nut-board-slot"></div>' : ''}
    ${entries === null ? '' : pulseCard(rows, statuses)}
    ${obPlanCard()}
    <div id="vc-board-slot"></div>
    <div id="cs-board-slot"></div>

    ${(() => {
      // Setup guidance persists (collapsed) after the first athlete joins — it no longer vanishes
      // mid-setup. Hidden only once every step is genuinely done.
      const st = coachSetupState();
      const left = setupIncompleteCount(st);
      return left ? collapseSection('coach-setup', vocab().setup, left, setupChecklistCard(st), false) : '';
    })()}

    <div class="eyebrow co-major" data-tour="priority">${esc(vocab().priorities)}</div>
    ${entries === null ? `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bell', 17)}</div><div><div class="tt">Ranking the day…</div><div class="ts">Standards and exceptions are loading.</div></div></div>`
    : cards.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px;line-height:1.4">Nothing needs you right now. Anything you nudge, assign, or mark handled stays out of this queue until the reason changes.</div>`
    : cards.slice(0, 6).map((c, i) => priorityCard(c, i, (RT.coachNudged || {})[c.athleteId] === roles.todayISO())).join('')}

    ${/* On a nutrition book the activity rail is the SAME plates the meal-review queue just
          listed (the feed is meals-only), so the whole section is a duplicate and the queue's
          Inbox link is the full-history door. Every other book keeps it. The unseen count caps
          at 99+: a three-digit badge stops informing and starts inflating. */''}
    ${isNutritionBook() ? '' : `
    <div class="eyebrow" data-tour="activity" style="display:flex;justify-content:space-between;align-items:baseline"><span>Live activity</span>${unseen ? `<span style="color:var(--blue-bright)">${unseen > 99 ? '99+' : unseen} new</span>` : ''}</div>
    ${feed === null ? skeletonRows(2, 'Loading the activity feed')
    : feed.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px;line-height:1.4">No logs yet ${scope.kind === 'team' ? 'today' : 'in this group today'}. Every meal lands here the moment it's logged.</div>`
    : `<div style="display:flex;gap:9px;overflow-x:auto;padding-bottom:4px;margin:0 -2px">${feed.slice(0, 12).map(m => {
        const who = rows.find(r => r.athleteId === m.athlete_id) || {};
        const photo = CD.act.photos[m.id];
        const bits = [cap(m.type || 'Meal'), actTime(m.logged_at)].filter(Boolean);
        return `<div class="act-card" data-go="coach-meal/${esc(m.id)}" style="position:relative;flex:0 0 47%">
          ${photo ? `<div class="act-media" style="height:64px;background-image:url('${esc(photo)}');background-size:cover;background-position:center"></div>` : `<div class="act-media" style="height:64px;background:linear-gradient(150deg,var(--surface-2),var(--surface-3))"></div>`}
          ${seen.has(m.id) ? '' : `<span style="position:absolute;top:7px;right:7px;width:9px;height:9px;border-radius:50%;background:var(--blue-bright);box-shadow:0 0 9px rgba(var(--blue-rgb),0.7);border:2px solid rgba(5,8,15,0.8)"></span>`}
          <div style="padding:8px 10px 9px"><div style="font-size:11px;font-weight:800">${esc((who.name || 'Athlete').split(' ')[0])}</div>
          <div style="font-size:9.5px;color:var(--text-3);font-weight:700;margin-top:2px">${esc(bits.join(' · '))}</div></div>
        </div>`;
      }).join('')}</div>`}`}

    <div class="eyebrow co-minor" data-tour="followups">Follow-ups</div>
    ${followUps.length === 0 ? `<div style="font-size:12px;font-weight:600;color:var(--text-3);margin:0 2px 4px">All caught up.</div>`
    : `<section class="card" style="padding:6px 16px">${followUps.map(f => `
      <div class="lrow" ${f.go ? `data-go="${f.go}" style="cursor:pointer"` : 'style="cursor:default"'}>
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)"><b>${f.n}</b></div>
        <div class="lm"><div class="lt">${esc(f.t)}</div></div>
        ${f.go ? icon('chevron', 14, 'style="color:var(--text-3)"') : ''}
      </div>`).join('')}</section>`}
    <div class="co-bottom"></div>`;
  },
  mount(root) {
    wireEmailVerifyBanner(root);
    loadMyBook().then(() => { loadActivity(); if (CD.caps.trustPass) loadPassMap(); });
    // Offline retry — same shape as the roster's, so the two screens stop disagreeing about
    // whether "reopen the app" is the coach's job.
    const homeRetry = root.querySelector('#home-retry');
    if (homeRetry) homeRetry.addEventListener('click', () => { homeRetry.disabled = true; loadMyBook(true).then(() => window.__render()); });
    // Server alerts feed the bell badge + the Follow-ups row. Same throttled loader the athlete
    // header uses (15s), so a coach flipping between tabs costs nothing extra; repaint only when
    // rows actually changed.
    act.loadNotifications().then((changed) => { if (changed && window.__render) window.__render(); }).catch(() => {});
    // The onboarding plan pick → the real checkout, preselected. Marked done on TAP (not on
    // completed payment): a coach who opened checkout and bailed knows where plans live now, and
    // a card that keeps reappearing after a deliberate bail is a nag, not a bridge.
    const planCta = root.querySelector('#ob-plan-cta');
    if (planCta) planCta.addEventListener('click', () => {
      act.markObPlanCtaDone();
      if (window.__go) window.__go('plan-upgrade'); else location.hash = '#plan-upgrade';
    });
    // Verified Commitments (0138): the live "9 of 11 in" card, injected async into its own slot so
    // a board fetch never delays the priority queue. An operator who has scheduled nothing gets an
    // empty slot and this screen is byte-identical to before.
    paintBoard(root);
    paintStandardsBoard(root);
    paintNutritionBoard(root);
    // Empty-state invite card: Copy + native Share of the invite code (present only before
    // anyone has joined). operatorIdentity resolves the right code for a team OR a practice.
    const code = S.operatorIdentity.code;
    const teamNm = (CD.roster && CD.roster.teams[0] && CD.roster.teams[0].name) || S.operatorIdentity.bookName
      || (isPractice() ? 'your practice' : 'your team');
    const copyBtn = root.querySelector('#coach-copy-code');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const ok = await copyText(code);
      if (code) act.markCoachSetup('sharedCode'); // real "shared" signal for the setup checklist
      copyBtn.innerHTML = ok ? `${icon('check', 16)} Copied` : 'Couldn’t copy. Use Share';
      setTimeout(() => { copyBtn.innerHTML = `${icon('clipboard', 16)} Copy code`; }, 1600);
    });
    // No-team recovery: actually create the team, then repaint into the real invite card.
    // The failure is reported in place — never a silent no-op on the one action that unblocks
    // the whole account.
    const createBtn = root.querySelector('#coach-team-create');
    if (createBtn) {
      const nameEl = root.querySelector('#coach-team-name');
      const errEl = root.querySelector('#coach-team-err');
      const submit = async () => {
        if (createBtn.disabled) return;
        const name = (nameEl && nameEl.value) || '';
        errEl.textContent = '';
        createBtn.disabled = true;
        createBtn.innerHTML = 'Creating…';
        const r = await act.createTeamNow(name);
        if (!r.ok) {
          createBtn.disabled = false;
          createBtn.innerHTML = `${icon('users', 16)} Create team`;
          errEl.textContent = r.error;
          return;
        }
        window.__render();   // RT.team is live now → the real code + QR replace this form
      };
      createBtn.addEventListener('click', submit);
      if (nameEl) nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }
    // Offline code-card retry (T-13): re-pull the team identity, then repaint honestly.
    const teamRetry = root.querySelector('#coach-team-retry');
    if (teamRetry) teamRetry.addEventListener('click', async () => {
      teamRetry.disabled = true; teamRetry.innerHTML = 'Retrying…';
      try {
        if (isPractice()) await act._loadPracticeIntoRt(RT.userId);
        else await act._loadTeamIntoRt(RT.userId);
      } catch { /* still offline — honest state re-renders */ }
      window.__render();
    });
    const shareBtn = root.querySelector('#coach-share-invite');
    if (shareBtn) shareBtn.addEventListener('click', async () => {
      const url = inviteLink(code), text = inviteShareText(code, teamNm);
      if (code) act.markCoachSetup('sharedCode');
      try {
        if (window.OnStandardNative && window.OnStandardNative.share) {
          window.OnStandardNative.share({ title: `Join ${teamNm}`, message: text, url });
        } else if (navigator.share) {
          await navigator.share({ title: `Join ${teamNm}`, text, url });
        } else if (await copyText(text)) {
          shareBtn.innerHTML = `${icon('check', 16)} Copied invite`;
          setTimeout(() => { shareBtn.innerHTML = `${icon('share', 16)} Share invite`; }, 1600);
        }
      } catch { /* share sheet dismissed */ }
    });
    root.querySelectorAll('[data-scopes]').forEach(b => b.addEventListener('click', () => { SHOW_SCOPES = !SHOW_SCOPES; window.__restate(); }));
    root.querySelectorAll('[data-pulse]').forEach(b => b.addEventListener('click', () => { SHOW_PULSE = !SHOW_PULSE; window.__restate(); }));
    root.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      const [kind, value] = b.getAttribute('data-scope').split(':');
      // The flagship on this screen: a new scope re-filters and re-ranks the whole queue.
      setScope({ kind: kind || 'team', value: value || null }); SHOW_SCOPES = false; window.__restate();
    }));
    // Failed writes never lie: log() only mirrors the intervention into the local cache when the
    // server took it, and returns the honest boolean so callers can keep the card + say so.
    // logBookIntervention resolves the book id and no-ops on a practice (see coach-data.js).
    const log = async (athleteId, kind, b) => {
      const reasonKey = b.getAttribute('data-key'), tier = b.getAttribute('data-tier');
      const ok = await logBookIntervention({ athleteId, kind, reasonKey, tier });
      if (ok && CD.caps.interventions && CD.extras && Array.isArray(CD.extras.interventions)) {
        CD.extras.interventions.push({ athlete_id: athleteId, kind, reason_key: reasonKey, tier });
      }
      return ok;
    };
    const sayFail = (athleteId, msg) => {
      const el = root.querySelector(`#pstatus-${athleteId}`);
      if (el) { el.style.color = 'var(--red)'; el.textContent = msg; }
    };
    root.querySelectorAll('[data-phandle]').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-phandle');
      b.disabled = true; b.textContent = '…';
      const ok = await log(id, 'handled', b);
      if (!ok) {
        b.disabled = false; b.textContent = 'Handled';
        sayFail(id, "Couldn't save that — check your connection.");
        return;
      }
      window.__render();
    }));
    // Nudge is two-step: the first tap opens the tier-matched message on the card, editable,
    // and Send pushes exactly what the coach sees. Nothing goes out unread.
    root.querySelectorAll('[data-pnudge]').forEach(b => b.addEventListener('click', () => {
      const id = b.getAttribute('data-pnudge');
      // The body must match the tier the card showed — "overdue" to an athlete who logged on
      // time but scored low reads as an accusation.
      const tier = b.getAttribute('data-tier');
      const body = nudgePreset(tier || 'critical');
      PNUDGE_ARM = PNUDGE_ARM && PNUDGE_ARM.athleteId === id ? null : { athleteId: id, body };
      // The composer opening on one card pushes every card below it down; gliding them is the
      // difference between the list making room and the list jumping.
      window.__restate();
    }));
    root.querySelectorAll('[data-pnudge-cancel]').forEach(b => b.addEventListener('click', () => { PNUDGE_ARM = null; window.__restate(); }));
    root.querySelectorAll('[data-pnudge-send]').forEach(b => b.addEventListener('click', async () => {
      if (b.disabled) return;
      const id = b.getAttribute('data-pnudge-send');
      const input = root.querySelector('#pnudge-body');
      const body = ((input && input.value) || '').trim() || (PNUDGE_ARM && PNUDGE_ARM.body) || 'Time to get your log in.';
      b.disabled = true; b.textContent = '…';
      const r = await roles.nudgePush(id, `${S.operatorIdentity.handle} is waiting`, body);
      const copy = nudgeResultCopy(r);
      if (!copy.ok) {
        b.disabled = false; b.textContent = 'Send';
        sayFail(id, copy.msg);
        return;
      }
      PNUDGE_ARM = null;
      act.markNudged(id);
      await log(id, 'nudge', b);
      window.__render();
      // Post-render: the delivery truth. "Nudged ✓" on the button says it was recorded; this
      // line says where it actually landed (phone push vs in-app inbox vs just-pinged).
      const stEl = document.querySelector(`#pstatus-${id}`);
      if (stEl) {
        stEl.style.color = copy.tone === 'ok' ? 'var(--green-bright)' : 'var(--amber-bright)';
        stEl.textContent = copy.msg;
      }
    }));
    root.querySelectorAll('[data-passign]').forEach(b => b.addEventListener('click', async () => {
      if (b.disabled) return; // double-tap guard — navigates away, so no re-enable needed
      b.disabled = true;
      const id = b.getAttribute('data-passign');
      // The intervention row is bookkeeping; the assign itself happens in the composer —
      // navigate regardless (log() already refuses to fake the cache on failure).
      await log(id, 'assign', b);
      window.__go(`coach-assign/${id}`);
    }));
    // The first-run tour — this module serves BOTH the coach and trainer routes, and planTour
    // reads the role, so one call covers both. Safe on every repaint (see tour.js).
    maybeStartTour();
  },
};
