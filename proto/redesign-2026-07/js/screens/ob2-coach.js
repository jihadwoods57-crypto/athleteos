/* ============================================================
   OB2 — COACH flow (route `obk`). Narrative spine: the standard
   you can't see → the monitoring math → build a requirement,
   assign it, read the board → visibility commitment → account →
   team code (legacy coach-ob mechanics, replicated) → org plans.

   Persistence rides the LEGACY coach keys: RT.ob.name +
   RT.ob.coach.{name, coachName, joinMode, staffCode, teamName,
   sport} feed act.persistCoachOnboarding() unchanged, which sets
   RT.ob.teamCode (create) or RT.ob.joinedStaff (staff join).
   New discovery keys (teamSize, dailyExpectations, currentTracking,
   staffSize, blindspots, visibilityLevel, coachMode) ride alongside.

   Auth gate: `obk` is in router AUTH_ROUTES, and this module never
   declares nav:'coach' — the same two facts that let legacy
   coach-ob/8 render AFTER account creation (the router's role
   mirror-guard exempts AUTH_ROUTES). Nothing else is needed.
   ============================================================ */
import { RT, act } from '../state.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';
import {
  defineFlow, ob, capture, gateCta, meter, countStat, mirrorCard, simChip,
  chatSim, notifCard, phoneCard, testimonial, planCard, choiceGrid, chipRow, PLANS,
} from '../ob2.js';
import { accountBody, wireAccount } from './ob-account.js';
import { showConfirmPending } from '../ob-helpers.js';
import { commitButton, wireCommit } from '../ob-commit.js';
import { setMyTeamCode } from '../roles.js';
import { roleLabel, normalizeRole } from '../staff-access.js';

/* Coach-scoped scratch (same shape the legacy flow writes and
   act.persistCoachOnboarding reads). */
const cap = (patch) => act.captureOb({ coach: { ...((RT.ob || {}).coach || {}), ...patch } });

/* Guarded numbers for the aha / automation math. Defaults only ever show
   when a step is deep-linked with an empty RT.ob — the chips are required. */
const teamSizeOf = (o) => Number(o.teamSize) || 25;
const expectationsOf = (o) => Math.min(5, Math.max(2, Number(o.dailyExpectations) || 3));
const isStaffJoin = (o) => !!o.joinedStaff || o.coachMode === 'join';

const TRACK_PHRASE = {
  chat: 'in a group chat and by memory',
  sheets: 'in spreadsheets',
  app: 'in an app they ignore',
  none: 'by memory',
};
const REQ_LABEL = { meals: 'Meal photos', protein: 'Protein target', lift: 'Lift log', weigh: 'Weigh-in' };
const ROOM_LABEL = { team: 'the whole team', qb: 'the QB room', ol: 'the OL room', skill: 'the Skill room', bigs: 'the Bigs room' };
const VIS_LABEL = { scores: 'scores only', alerts: 'scores + alerts', detail: 'full detail' };

/* Simulated completion board — first names only, mixed done/miss,
   cell count follows the coach's own dailyExpectations answer. */
const BOARD_ROSTER = [
  ['Jaylen', 'QB'], ['Marcus', 'RB'], ['DeShawn', 'WR'], ['Tyler', 'OL'],
  ['Malik', 'LB'], ['Jordan', 'DB'], ['Trey', 'TE'], ['Chris', 'WR'],
];
function boardRows(cells) {
  return BOARD_ROSTER.map(([name, pos], i) => {
    const dots = Array.from({ length: cells }, (_, j) => {
      const miss = (i + j) % 5 === 3;
      return `<i class="${miss ? 'miss' : 'ok'}">${icon(miss ? 'x' : 'check', 10)}</i>`;
    }).join('');
    return `<div class="br"><div class="bn">${esc(name)}</div><div class="bp">${esc(pos)}</div><div class="bd">${dots}</div></div>`;
  }).join('');
}

const steps = [

  /* ================= ch0 — DISCOVER ================= */
  {
    id: 'why', ch: 0, cta: 'Keep going',
    body: () => `
      <div class="ob2-hero">
        <div class="h-eyebrow">For coaches</div>
        <div class="h-title">You set the standard. <span class="accent">Can you see who meets it?</span></div>
        <div class="h-body">Practice shows you effort. The depth chart shows you outcomes. What happens between the two — meals, sleep, recovery — you mostly take on faith.</div>
      </div>`,
  },
  {
    id: 'gap', ch: 0, cta: 'Keep going',
    body: () => `
      <div class="ob2-hero">
        <div class="h-eyebrow">The monitoring math</div>
        <div class="h-title">The standard you can’t see <span class="accent">slips first.</span></div>
        <div class="h-body">A roster of athletes, each with daily non-negotiables, seven days a week — that’s hundreds of individual actions no staff can check by hand. So nobody does, and you find out on the scale, in the film, in February.</div>
        <div class="h-note">In a minute we’ll run your program’s exact number.</div>
      </div>`,
  },
  {
    id: 'answer', ch: 0, cta: 'Show me',
    body: () => `
      <div class="ob2-hero">
        <div class="h-eyebrow">The OnStandard answer</div>
        <div class="h-title">One score per athlete. <span class="accent">Readable in five seconds.</span></div>
        <div class="h-body">Your standard becomes daily requirements with proof — photos, check-ins, the scale. Every athlete carries one Daily Score built from what they actually did, and your board shows all of them at once.</div>
      </div>`,
  },
  {
    id: 'name', ch: 0, cta: 'Next',
    title: () => 'You, coach.',
    sub: () => 'Your athletes see this name on every standard you set.',
    body: () => `
      <input id="co-first" class="ob-input" placeholder="First name" aria-label="First name" autocomplete="given-name" autocapitalize="words" spellcheck="false" autocorrect="off" />
      <div style="height:12px"></div>
      <input id="co-last" class="ob-input" placeholder="Last name" aria-label="Last name" autocomplete="family-name" autocapitalize="words" spellcheck="false" autocorrect="off" />
      <div class="eyebrow" style="margin:16px 2px 10px">What the room calls you</div>
      <div class="chip-row" id="co-handle"></div>
      <input id="co-handle-custom" class="ob-input" placeholder="Or type it — e.g. Coach B" style="margin-top:10px" />
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0;line-height:1.4">This is the name athletes see everywhere — greetings, meal threads, your standard.</div>`,
    mount(root) {
      const $ = (s) => root.querySelector(s);
      const f = $('#co-first'), l = $('#co-last');
      const btn = $('#ob2-next');
      if (btn) btn.setAttribute('data-gate-extra', '#co-first.ok');
      const c = (RT.ob || {}).coach || {};
      const saved0 = (RT.ob || {}).name || c.name || '';
      if (saved0) { const [cf, ...cl] = saved0.split(' '); f.value = cf; l.value = cl.join(' '); }
      // "What the room calls you" — suggestions derived live from the name (Coach Brown /
      // Coach John / Coach JB) + a free-text override. Defaults to "Coach <lastname>" and
      // auto-tracks the last name until the coach explicitly picks a chip or types a custom
      // handle (T-27) — identical mechanics to legacy coach-ob step 1.
      const handleRow = $('#co-handle'), handleCustom = $('#co-handle-custom');
      let autoHandle = !(((RT.ob || {}).coach || {}).coachName || '').trim();
      const paintHandles = () => {
        if (!handleRow) return;
        const first = f.value.trim(), last = l.value.trim();
        const opts = [...new Set([
          last && `Coach ${last}`, first && `Coach ${first}`,
          first && last && `Coach ${first[0].toUpperCase()}${last[0].toUpperCase()}`,
        ].filter(Boolean))];
        const customTyped = !!(handleCustom && handleCustom.value.trim());
        if (autoHandle && !customTyped && last && opts.length
            && opts[0] !== (((RT.ob || {}).coach || {}).coachName || '').trim()) {
          cap({ coachName: opts[0] });
        }
        const saved = (((RT.ob || {}).coach || {}).coachName || '').trim();
        handleRow.innerHTML = opts.map((h) => `<span class="chp ${saved === h ? 'on' : ''}">${esc(h)}</span>`).join('')
          || `<span style="font-size:12px;font-weight:600;color:var(--text-3)">Type your name above and options appear.</span>`;
        handleRow.querySelectorAll('.chp').forEach((el) => el.addEventListener('click', () => {
          autoHandle = false;
          handleRow.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
          el.classList.add('on');
          if (handleCustom) handleCustom.value = '';
          cap({ coachName: el.textContent.trim() });
        }));
      };
      const sync = () => {
        const name = `${f.value.trim()} ${l.value.trim()}`.trim();
        cap({ name });
        capture({ firstName: f.value.trim(), lastName: l.value.trim(), name }); // account step + profiles.full_name read RT.ob.name
        f.classList.toggle('ok', !!(f.value.trim() && l.value.trim()));
        gateCta(root);
        paintHandles();
      };
      [f, l].forEach((el) => el.addEventListener('input', sync));
      sync();
      if (handleCustom) {
        const saved = (((RT.ob || {}).coach || {}).coachName || '').trim();
        if (saved && !handleRow.querySelector('.on')) handleCustom.value = saved;
        handleCustom.addEventListener('input', () => {
          autoHandle = false;
          handleRow.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
          cap({ coachName: handleCustom.value.trim() });
        });
      }
    },
  },
  {
    id: 'sport', ch: 0, cta: 'Next',
    title: () => 'Your sport.',
    sub: () => 'Positions, rooms, and templates follow it.',
    body: () => chipRow('sport', ['Football', 'Basketball', 'Baseball', 'Track', 'Other']),
  },
  {
    id: 'team-size', ch: 0, cta: 'Next',
    title: () => 'How many athletes?',
    sub: () => 'Across everything you run. Rough is fine.',
    body: () => chipRow('teamSize', [
      { v: 10, t: '10 or fewer' }, { v: 25, t: 'About 25' }, { v: 40, t: 'About 40' }, { v: 60, t: '60+' },
    ]),
  },
  {
    id: 'expectations', ch: 0, cta: 'Next',
    title: () => 'Daily non-negotiables.',
    sub: () => 'The things every athlete owes you every day — meals, weigh-in, recovery, lift log.',
    body: (o) => `${chipRow('dailyExpectations', [
      { v: 2, t: '2' }, { v: 3, t: '3' }, { v: 4, t: '4' }, { v: 5, t: '5' },
    ])}
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:14px 2px 0;line-height:1.5">${o.teamSize ? `Across ${esc(teamSizeOf(o))} athletes, this number decides how much your staff is really tracking.` : 'This number decides how much your staff is really tracking.'}</div>`,
  },
  {
    id: 'tracking', ch: 0, cta: 'Next',
    title: () => 'How do you track it today?',
    sub: () => 'Honest answer — it shapes what we show you next.',
    body: () => choiceGrid('currentTracking', [
      { v: 'chat', ic: 'message', t: 'Group chat + memory', s: 'Photos scroll past, misses vanish' },
      { v: 'sheets', ic: 'grid', t: 'Spreadsheets', s: 'Somebody types it in — sometimes' },
      { v: 'app', ic: 'bell', t: 'An app they ignore', s: 'Logging died after week two' },
      { v: 'none', ic: 'eye', t: 'Nothing formal', s: 'You trust it, until you can’t' },
    ]),
  },
  {
    id: 'staff', ch: 0, cta: 'Next',
    title: () => 'Who’s on staff?',
    sub: () => 'Staff seats see their rooms. You see everything.',
    body: () => chipRow('staffSize', [
      { v: 'solo', t: 'Just me' }, { v: '2-3', t: '2–3 of us' }, { v: '4+', t: '4 or more' },
    ]),
  },
  {
    id: 'blindspot', ch: 0, cta: 'Next',
    title: () => 'Where does it slip?',
    sub: () => 'Pick every blind spot that costs you. We build around them.',
    body: () => chipRow('blindspots', [
      { v: 'home', t: 'Nutrition at home' }, { v: 'weekends', t: 'Weekends' },
      { v: 'injured', t: 'Injured guys' }, { v: 'travel', t: 'Travel' }, { v: 'freshmen', t: 'Freshmen' },
    ], { multi: true }),
  },

  /* ================= ch1 — SEE IT ================= */
  {
    id: 'aha', ch: 1, cta: 'There’s a better way',
    title: () => 'Your program, counted.',
    body: (o) => {
      const ts = teamSizeOf(o), de = expectationsOf(o);
      const track = TRACK_PHRASE[o.currentTracking] || 'by memory';
      return `${countStat(ts * de * 7,
        `individual actions a week your staff is trying to track <b>${esc(track)}</b>.`,
        `${ts} athletes × ${de} daily expectations × 7 days`)}
      <div style="font-size:13px;font-weight:600;color:var(--text-2);text-align:center;margin-top:16px;line-height:1.55">No staff checks that by hand. So the standard becomes a hope. Let’s make it a board instead — build one requirement right now.</div>`;
    },
  },
  {
    id: 'req-build', ch: 1, cta: 'Create it',
    title: () => 'Build your first requirement.',
    sub: () => 'Pick one to try. Windows, proof, and full templates are yours to tune later in Standards.',
    body: () => `${simChip('Sample requirement — yours are fully custom')}
      ${choiceGrid('sampleReq', [
        { v: 'meals', ic: 'utensils', t: 'Meal photos', s: '3 a day · photo proof' },
        { v: 'protein', ic: 'flame', t: 'Protein target', s: 'Daily · counted, not guessed' },
        { v: 'lift', ic: 'bolt', t: 'Lift log', s: 'Training days · check it off' },
        { v: 'weigh', ic: 'scale', t: 'Weigh-in', s: 'Mon / Wed / Fri · scale proof' },
      ])}`,
  },
  {
    id: 'req-assign', ch: 1, cta: 'Assign it',
    title: () => 'Now point it at a room.',
    sub: (o) => `${REQ_LABEL[o.sampleReq] || 'Your requirement'} can hit the whole team or one position room.`,
    body: () => `${chipRow('sampleAssign', [
      { v: 'team', t: 'Whole team' }, { v: 'qb', t: 'QB room' }, { v: 'ol', t: 'OL room' },
      { v: 'skill', t: 'Skill' }, { v: 'bigs', t: 'Bigs' },
    ])}
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:14px 2px 0;line-height:1.5">Rooms come from the positions your athletes pick — one tap and the requirement lands on everyone in it.</div>`,
  },
  {
    id: 'board', ch: 1, cta: 'How’s a score built?',
    title: () => 'Tuesday, 8:40 pm.',
    sub: (o) => `${REQ_LABEL[o.sampleReq] || 'Your standard'} on ${ROOM_LABEL[o.sampleAssign] || 'the team'} — every athlete, without sending a single text.`,
    body: (o) => `${simChip('Simulated roster — your real board fills as athletes join')}
      ${phoneCard('Completion board', `<div class="ob2-board">${boardRows(expectationsOf(o))}</div>`)}
      <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:12px 2px 0;line-height:1.5">${icon('check', 10)} done · ${icon('x', 10)} missed — one column per daily expectation.</div>`,
  },
  {
    id: 'breakdown', ch: 1, cta: 'Next',
    title: () => 'Tap a name. See the why.',
    sub: () => 'Every score opens the same honest breakdown — the real weights, not a vibe.',
    body: () => `${simChip('Simulated athlete — real breakdowns come from real logs')}
      <div class="lrow" id="obk-open" role="button" aria-label="Open Marcus’s breakdown" style="border:1px solid var(--hairline);border-radius:var(--r-card-sm);padding:12px 14px;background:var(--surface-1)">
        <div class="lm"><div class="lt">Marcus · RB</div><div class="ls">Today’s score — the honest weights</div></div>
        <div style="font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--green-bright)">91</div>
      </div>
      <div id="obk-detail" style="display:block;margin-top:12px">
        ${phoneCard('Score breakdown', `
          <div style="display:flex;justify-content:center;padding:4px 0 10px">${meter(91, { size: 120, value: '91', label: 'Today', uid: 'obk-brk' })}</div>
          <div class="comp-read">
            <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Nutrition</div><div class="cv">50% — meals logged and graded to your standard</div></div>
            <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Recovery</div><div class="cv">25% — sleep and recovery check-in</div></div>
            <div class="cr"><div class="ci warn">${icon('clock', 13)}</div><div class="ck">Commitment</div><div class="cv">15% — dinner logged late tonight</div></div>
            <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Check-in</div><div class="cv">10% — showed up today</div></div>
          </div>`)}
      </div>`,
    mount(root) {
      const open = root.querySelector('#obk-open'), detail = root.querySelector('#obk-detail');
      if (open && detail) open.addEventListener('click', () => {
        detail.style.display = detail.style.display === 'none' ? '' : 'none';
      });
    },
  },
  {
    id: 'alert', ch: 1, cta: 'Next',
    title: () => 'Know the moment it slips.',
    sub: () => 'You choose what’s worth a ping. Everything else waits for your morning brief.',
    body: () => `${simChip('Simulated alert previews')}
      ${notifCard({ ic: 'bell', tint: 'var(--red-surface)', color: 'var(--red)', title: 'Jaylen — missed dinner log', body: '2nd day in a row. Flagged to you, not the group chat.', time: '8:41 pm' })}
      ${notifCard({ ic: 'clock', tint: 'var(--amber-surface)', color: 'var(--amber-bright)', title: 'Weigh-ins due in 2 hours', body: '6 of 8 done — Tyler and Trey outstanding.', time: '7:00 am' })}
      <div style="font-size:12.5px;font-weight:600;color:var(--text-3);margin:6px 2px 0;line-height:1.5">Alert rules are yours — per requirement, per room, or off entirely.</div>`,
  },
  {
    id: 'thread', ch: 1, cta: 'Next',
    title: () => 'One thread per meal.',
    sub: () => 'The AI does the first read on every plate. You step in only where it counts.',
    body: () => `${simChip('Simulated thread')}
      ${chatSim([
        { who: 'trainer', init: 'A', name: 'Andre', sim: true, text: 'Post-practice dinner.' },
        { who: 'ai', name: 'OnStandard AI', sim: true, text: 'Grilled chicken, rice, broccoli — solid plate. Protein on target; carbs a little light for tomorrow’s lift.' },
        { who: 'me', name: 'You', init: 'C', sim: true, text: 'Good plate. Add a carb at breakfast before the lift.' },
      ])}`,
  },
  {
    id: 'automation', ch: 1, cta: 'Build my system',
    title: () => 'The texts nobody sends.',
    body: (o) => {
      const ts = teamSizeOf(o), de = expectationsOf(o);
      return `${countStat(Math.round(ts * de * 7 * 0.7),
        `follow-up checks a week handled for you — reminders, first reads, and miss flags your staff never makes by hand.`,
        `estimate — ${ts} athletes × ${de} expectations × 7 days, at a typical 70% handled automatically`)}
      <div style="font-size:13px;font-weight:600;color:var(--text-2);text-align:center;margin-top:16px;line-height:1.55">Your staff’s hours go to coaching. The system does the counting.</div>`;
    },
  },

  /* ================= ch2 — YOUR PLAN ================= */
  {
    id: 'plan', ch: 2, cta: 'Set the standard',
    title: () => 'Your program’s system.',
    sub: () => 'Built from what you just told us.',
    body: (o) => {
      const ts = teamSizeOf(o), de = expectationsOf(o);
      const BLIND = { home: 'nutrition at home', weekends: 'weekends', injured: 'injured guys', travel: 'travel', freshmen: 'freshmen' };
      const blinds = (Array.isArray(o.blindspots) ? o.blindspots : []).map((b) => BLIND[b]).filter(Boolean);
      return `
      ${o.teamSize ? mirrorCard('users', `You said <b>${esc(ts)} athletes</b> — the board tracks every one, daily.`) : ''}
      ${o.dailyExpectations ? mirrorCard('clipboard', `Your <b>${esc(de)} daily non-negotiables</b> become requirements with proof, not reminders in a chat.`) : ''}
      ${blinds.length ? mirrorCard('eye', `Your blind spots — <b>${esc(blinds.join(', '))}</b> — are exactly what alerts and the board make visible.`) : mirrorCard('eye', `The hours you can’t see — home, weekends, travel — are exactly what the board makes visible.`)}
      <div style="height:8px"></div>
      ${phoneCard('What you get', `
        <div class="ob2-bound"><div class="bi yes">${icon('check', 15)}</div><div><div class="bt">A daily standard with proof</div><div class="bs">Photos, check-ins, the scale — per room or team-wide</div></div></div>
        <div class="ob2-bound"><div class="bi yes">${icon('check', 15)}</div><div><div class="bt">AI first-read on every meal</div><div class="bs">You step into threads only where it matters</div></div></div>
        <div class="ob2-bound"><div class="bi yes">${icon('check', 15)}</div><div><div class="bt">Staff see their rooms</div><div class="bs">You see everything, alerts on your rules</div></div></div>`)}`;
    },
  },

  /* ================= ch3 — COMMIT ================= */
  {
    id: 'commit-q', ch: 3, cta: 'Next',
    title: () => 'How much do you want to see?',
    sub: () => 'This sets your alert defaults — tune any of it later in Notifications.',
    body: () => choiceGrid('visibilityLevel', [
      { v: 'scores', ic: 'bars', t: 'Scores only', s: 'The board and the numbers — alerts stay off by default' },
      { v: 'alerts', ic: 'bell', t: 'Scores + alerts', s: 'Misses worth a ping reach you as they happen' },
      { v: 'detail', ic: 'eye', t: 'Full detail', s: 'Scores, alerts, and every meal thread as it lands' },
    ]),
  },
  {
    id: 'commit', ch: 3, noFoot: true,
    title: () => 'Set the standard.',
    sub: () => 'Your athletes commit to theirs. This one’s yours.',
    body: (o) => {
      const committed = !!o.committedAt;
      return `
      ${mirrorCard('users', `A board for <b>${esc(teamSizeOf(o))} athletes</b>, filled without asking.`)}
      ${mirrorCard('bell', `Visibility: <b>${esc(VIS_LABEL[o.visibilityLevel] || 'scores + alerts')}</b> — your alert defaults follow it.`)}
      ${mirrorCard('shield', `The standard gets written down, proven daily, and seen — by you.`)}
      <div class="ob-foot" style="margin-top:auto">
        ${commitButton(committed)}
        ${committed ? `<div class="ob-textlink" style="padding-top:14px" data-go="obk/proof">Continue</div>` : ''}
      </div>`;
    },
    mount(root, ctx) {
      wireCommit(root, () => {
        capture({ committedAt: new Date().toISOString() });
        ctx.next();
      });
    },
  },

  /* ================= ch4 — START ================= */
  {
    id: 'proof', ch: 4, cta: 'Next',
    title: () => 'What it looks like in a program.',
    body: () => `
      <!-- Launch placeholders — the founder swaps these for real customer quotes before release. -->
      ${testimonial({ quote: 'Spring ball, logging held at 84%. I stopped asking “did you eat” and started coaching.', name: 'Coach D.', role: 'HS football, 47 athletes', initials: 'CD', stat: '84%', statKey: 'team log rate' })}
      ${testimonial({ quote: 'The board caught two guys drifting in week one — before the scale did. That used to take a month.', name: 'Coach R.', role: 'College track, 31 athletes', initials: 'CR', stat: 'wk 1', statKey: 'first catch' })}
      <div style="font-size:11.5px;font-weight:700;color:var(--text-3);text-align:center;margin-top:8px">Illustrative examples — not actual customers yet</div>`,
  },
  {
    id: 'staff-or-create', ch: 4, cta: 'Next',
    title: (o) => (o.coachMode === 'join' ? 'Join a staff.' : 'Build the team.'),
    sub: (o) => (o.coachMode === 'join'
      ? 'Enter the code from your head coach.'
      : 'Athletes join it with one code. You can run more than one group.'),
    body: (o) => {
      const mode = o.coachMode === 'join' ? 'join' : 'create';
      const c = ((RT.ob || {}).coach) || {};
      /* Legacy coach-ob step-3 fork mechanics: a segmented choice picks the path, only the
         chosen path's fields render, and switching clears the OTHER path's input so
         persistCoachOnboarding never routes on stale data. */
      return `
      <div class="seg" style="width:100%;margin-bottom:18px" id="ok-joinmode">
        <button class="${mode === 'create' ? 'on' : ''}" data-mode="create">Create a team</button>
        <button class="${mode === 'join' ? 'on' : ''}" data-mode="join">Join a staff</button>
      </div>
      ${mode === 'join' ? `
      <div class="eyebrow" style="margin:8px 2px 10px">Staff code</div>
      <input id="ok-staff-code" class="ob-input" maxlength="8" placeholder="Code from your head coach" autocapitalize="characters" autocorrect="off" spellcheck="false" style="text-align:center;letter-spacing:0.12em;text-transform:uppercase" value="${esc(c.staffCode || '')}" />
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0;line-height:1.45">Your head coach hands out staff codes. It lands you on their team’s staff with the role and permissions they set — you won’t create a new team.</div>` : `
      <input id="ok-team" class="ob-input" placeholder="Team name (e.g. Varsity Football)" value="${esc(c.teamName || o.teamName || '')}" />
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:10px 2px 0;line-height:1.45">Your join code mints with your account on the next steps — send it to the group chat and the board starts filling.</div>`}`;
    },
    mount(root, ctx) {
      const $ = (s) => root.querySelector(s);
      const btn = $('#ob2-next');
      const mode = ctx.ob.coachMode === 'join' ? 'join' : 'create';
      if (btn) btn.setAttribute('data-gate-extra', mode === 'join' ? '#ok-staff-code.ok' : '#ok-team.ok');
      $('#ok-joinmode').querySelectorAll('button[data-mode]').forEach((b) => b.addEventListener('click', () => {
        const m = b.getAttribute('data-mode');
        capture({ coachMode: m });
        // Switching path clears the other path's input so persistCoachOnboarding never
        // routes on stale data — a leftover staff code would wrongly skip team creation.
        cap(m === 'create' ? { joinMode: 'create', staffCode: '' } : { joinMode: 'join' });
        if (m === 'create') capture({ staffCode: '' });
        window.__render();
      }));
      const team = $('#ok-team');
      if (team) {
        const sync = () => {
          const v = team.value.trim();
          cap({ teamName: v });
          capture({ teamName: v });
          team.classList.toggle('ok', !!v);
          gateCta(root);
        };
        team.addEventListener('input', sync);
        sync();
      }
      const code = $('#ok-staff-code');
      if (code) {
        const sync = () => {
          const v = code.value.trim().toUpperCase();
          cap({ staffCode: v });
          capture({ staffCode: v });
          code.classList.toggle('ok', v.length >= 4);
          gateCta(root);
        };
        code.addEventListener('input', sync);
        sync();
      }
    },
  },
  {
    id: 'account', ch: 4, noFoot: true,
    title: () => 'Create your account.',
    sub: () => 'Your team, code, and roster live on it.',
    body: () => `
      <div style="height:8px"></div>
      ${accountBody({ terms: 'cob' })}
      <div class="ob-foot" style="margin-top:auto"><button id="su-go" class="btn primary" disabled>Create account &amp; Get my code</button></div>`,
    mount(root, ctx) {
      // Mirror the engine-captured sport into the legacy coach scratch so create_team
      // gets team_sport (name/coachName/teamName/staffCode are already mirrored live).
      if (ctx.ob.sport) cap({ sport: ctx.ob.sport });
      /* Legacy coach-ob step-7 sequence, exactly: signUp(role 'coach') → on live session
         persistCoachOnboarding (mints org/team/code OR joins the staff) → the code screen.
         No session yet (email confirmation) → showConfirmPending swaps the CTA. */
      wireAccount(root, {
        role: 'coach',
        onSession: async (live) => {
          if (live) { await act.persistCoachOnboarding(); window.__go('obk/code'); return; }
          showConfirmPending(root, { email: RT.email });
        },
      });
    },
  },
  {
    id: 'code', ch: 4, cta: 'Continue', green: true,
    /* Post-account: back can't return to the sign-up form — exit to the dashboard instead
       (legacy step 8 simply has no back; the OB2 shell always renders one). */
    back: 'coach-home',
    body: (o) => {
      const joined = o.joinedStaff;
      if (joined) {
        return `
        <div class="standard-set">
          <div class="halo"><div class="core" style="background:linear-gradient(155deg,#f59e0b,#d97706)">${icon('users', 34)}</div></div>
          <div class="ob-title" style="margin-top:22px">You’re on staff.</div>
          <div class="ob-sub" style="padding:0 8px">${esc(joined.teamName || 'The team')} · ${esc(roleLabel(normalizeRole(joined.role)))}. The roster, standards, and activity feed are yours to work.</div>
        </div>`;
      }
      const code = o.teamCode || '';
      return `
      <div class="standard-set">
        <div class="halo"><div class="core" style="background:linear-gradient(155deg,#f59e0b,#d97706)">${icon('users', 34)}</div></div>
        <div class="ob-title" style="margin-top:22px">Your team code.</div>
        <div class="ob-sub" style="padding:0 8px">Send it to the group chat. Athletes enter it once and their work starts counting toward your board.</div>
        <div style="height:22px"></div>
        ${code ? `<div class="code-boxes">${code.split('').map((ch) => `<div class="cb filled" style="border-color:var(--amber-border);background:rgba(245,165,36,0.08)">${esc(ch)}</div>`).join('')}</div>
        <div style="height:12px"></div>
        <div style="display:flex;justify-content:center;gap:8px">
          <button class="btn ghost sm" id="copy-code" style="width:auto;padding:0 22px">${icon('clipboard', 16)} Copy code</button>
          <button class="btn ghost sm" id="ob-code-edit" style="width:auto;padding:0 22px">Customize</button>
        </div>
        <div id="ob-code-editor" style="display:none;margin-top:14px">
          <input id="ob-code-input" class="ob-input" placeholder="YOUR CODE · 4–12 letters/numbers" maxlength="12"
            autocapitalize="characters" autocorrect="off" spellcheck="false" style="text-align:center;letter-spacing:0.12em;text-transform:uppercase" />
          <div style="display:flex;justify-content:center;gap:8px;margin-top:10px">
            <button class="btn green sm" id="ob-code-save" style="width:auto;padding:0 22px">Save code</button>
          </div>
          <div id="ob-code-status" style="font-size:12px;font-weight:600;color:var(--text-3);min-height:16px;margin-top:8px;text-align:center">Make it yours — e.g. GATORS. The random code stops working once you save.</div>
        </div>` :
        `<div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
          <div><div class="tt">Code pending</div><div class="ts">We couldn’t mint your code yet (connection or pending email confirmation). It generates automatically on your next sign-in — check Profile → Team code.</div></div></div>`}
      </div>`;
    },
    mount(root) {
      // Legacy coach-ob step-8 wiring, replicated: copy the REAL code + customize it
      // right here (set_my_team_code, 0026).
      const $ = (s) => root.querySelector(s);
      const copy = $('#copy-code');
      if (copy) copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText((RT.ob || {}).teamCode || ''); } catch { /* label still confirms intent */ }
        copy.innerHTML = `${icon('check', 16)} Copied`;
      });
      const edit = $('#ob-code-edit');
      if (edit) {
        const editor = $('#ob-code-editor'), input = $('#ob-code-input'), status = $('#ob-code-status');
        edit.addEventListener('click', () => {
          editor.style.display = editor.style.display === 'none' ? '' : 'none';
          if (editor.style.display === '' && input) input.focus();
        });
        $('#ob-code-save').addEventListener('click', async (e) => {
          const raw = ((input && input.value) || '').trim().toUpperCase();
          if (!/^[A-Z0-9]{4,12}$/.test(raw)) { status.style.color = 'var(--red)'; status.textContent = '4–12 letters or numbers only (A–Z, 0–9).'; return; }
          e.target.disabled = true;
          status.style.color = 'var(--text-3)'; status.textContent = 'Saving…';
          const r = await setMyTeamCode(raw);
          e.target.disabled = false;
          if (!r.ok) { status.style.color = 'var(--red)'; status.textContent = r.error || 'Could not save that code.'; return; }
          act.captureOb({ teamCode: r.code });
          if (RT.team) RT.team = { ...RT.team, code: r.code };
          window.__render();
        });
      }
    },
  },
  {
    id: 'covered', ch: 4, noFoot: true, back: 'obk/code',
    when: (o) => isStaffJoin(o),
    body: () => `
      <div class="ob2-covered">
        <div class="halo"><div class="core">${icon('check', 34)}</div></div>
        <div class="ob-title" style="margin-top:20px">Your seat is covered.</div>
        <div class="ob-sub" style="padding:0 8px">Staff seats ride on the program’s plan — nothing to set up, nothing to pay.</div>
      </div>
      <div class="ob-foot" style="margin-top:auto">
        <button class="btn primary" data-go="coach-home">Open Coach Dashboard</button>
        <div style="font-size:12px;font-weight:600;color:var(--text-3);text-align:center;margin-top:12px">Your rooms are next.</div>
      </div>`,
  },
  {
    id: 'plans', ch: 4, noFoot: true, back: 'obk/code',
    when: (o) => !isStaffJoin(o),
    title: () => 'Pick your program plan.',
    sub: () => 'Start free — decide when the team’s on the board.',
    body: (o) => `
      <div class="ob2-plans" data-obkey="plan">
        ${PLANS.org.map((p) => planCard({ ...p, on: o.plan ? o.plan === p.id : p.id === 'org_starter' })).join('')}
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--text-3);text-align:center;margin-top:12px;line-height:1.5">No card today. You’ll confirm before anything ever charges.</div>
      <div class="ob-foot" style="margin-top:auto">
        <button class="btn primary" data-go="coach-home">Start free — no card today</button>
        <div style="font-size:12px;font-weight:600;color:var(--text-3);text-align:center;margin-top:12px">Your rooms are next.</div>
      </div>`,
  },
];

export const obCoach = defineFlow({ route: 'obk', steps });
