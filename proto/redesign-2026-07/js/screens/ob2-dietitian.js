/* ============================================================
   OB2 : TEAM DIETITIAN flow (route `obd`).
   Narrative: a college sports RD covers a whole roster. Nobody can
   watch 85 athletes eat, so fueling runs on trust and spot checks
   until results slip. OnStandard photographs every plate, the AI
   does the first read, and the dietitian works flags, corrections,
   and the athletes who are quietly underfueling.
   Rides the COACH rail (role 'coach', persistCoachOnboarding) but
   the team it mints carries discipline 'nutrition' (0202), which
   turns on the nutrition lens: meal-review queue, fueling strips,
   dietitian vocabulary. Destination: the code reveal, then
   `coach-home`.
   Ratchet note: this file is class-only. No inline style
   attributes, no raw font-size; spacing rides .ob2-vgap and
   friends in css/ob2.css.
   ============================================================ */
import { RT, act } from '../state.js';
import { icon } from '../icons.js';
import { esc, copyText } from '../components.js';
import { setMyTeamCode } from '../roles.js';
import {
  defineFlow, saveProgressStep, choiceGrid, chipRow, simChip, mirrorCard, countStat,
  phoneCard, testimonial, planCard, PLANS, capture, ob, gateCta, structureStep,
} from '../ob2.js';
import { SAMPLE_MEAL } from '../ob2-meal.js';
import { roleLabel, normalizeRole } from '../staff-access.js';
import { accountBody, wireAccount } from './ob-account.js';
import { commitButton, wireCommit } from '../ob-commit.js';
import { showConfirmPending } from '../ob-helpers.js';
import { track, EVENTS } from '../analytics.js';

/* ---------- discovery bands (single source for math + mirrors) ---------- */
const ROSTER_BANDS = [
  { v: '25-', t: 'Up to 25', mid: 20 },
  { v: '50', t: '25 to 50', mid: 38 },
  { v: '85', t: '50 to 100', mid: 75 },
  { v: '100+', t: 'More than 100', mid: 120 },
];
/* wireChoices numifies pure-digit values ('50' becomes 50), so match by String. */
const bandOf = (o) => ROSTER_BANDS.find((b) => String(b.v) === String((o || {}).rosterCount)) || null;

const SLIP_LABEL = {
  road: 'road trips and travel meals',
  dining: 'the dining hall',
  weekends: 'weekends and breaks',
  under: 'quiet underfueling',
};
const STANDARD_LABEL = { fuel4: 'the 4-meal standard', fuel3: 'three meals a day', custom: 'a standard you shape per room' };
/* Credential chip -> the letters that ride the professional handle ("Dana Reyes, RD").
   Student/intern carries no letters yet, so no badge -- never a fabricated credential. */
const CRED_SUFFIX = { rd: 'RD', cssd: 'CSSD', ms: 'MS' };

/* Nested coach scratch: persistCoachOnboarding reads RT.ob.coach.* for create_team, and
   discipline 'nutrition' (0202) is what makes the minted team wear the nutrition lens. */
const cap = (patch) => capture({ coach: { ...((ob().coach) || {}), ...patch } });

/* The two doors (2026-08-18). This flow used to mint a team UNCONDITIONALLY -- an RD holding a
   head coach's staff code tapped the card named after their own profession, found no place to
   enter it, and ended up owning an empty duplicate team while the invite silently never
   redeemed. The fork mirrors obk's staff-or-create mechanics: RT.ob.coach.staffCode routes
   persistCoachOnboarding to join_staff instead of create_team (state.js, 0061). */
const isStaffJoin = (o) => !!o.joinedStaff || o.coachMode === 'join';

/* Manual CTA gate for free-input steps (the shared idiom): a hidden marker satisfies the
   engine's data-gate-extra selector only while the inputs are valid. */
function gateMark(root, okId, okNow) {
  let m = root.querySelector('#' + okId);
  if (okNow && !m) { m = document.createElement('i'); m.id = okId; m.hidden = true; root.appendChild(m); }
  if (!okNow && m) m.remove();
  gateCta(root);
}

const hero = (eyebrow, title, body, note) => `
  <div class="ob2-hero">
    <div class="h-eyebrow">${eyebrow}</div>
    <div class="h-title">${title}</div>
    <div class="h-body">${body}</div>
    ${note ? `<div class="h-note">${note}</div>` : ''}
  </div>`;

/* ---------- demo queue rows (fabricated, chipped as simulated on the step) ----------
   Thumb backgrounds are stamped from mount via .style so the markup stays class-only.
   The rows mirror the SHIPPED board's anatomy exactly (critique item 5): photo, name, a
   protein-led sub-line with the state word, flags first then unopened. The old demo scanned
   by amber score pills the real board deliberately removed, and claimed "every row is a real
   plate photo" over three blank tiles -- teaching a different board than ships. */
const DEMO_QUEUE = [
  { name: 'Reyes · Dinner', protein: 24, state: 'flagged', flag: true, thumb: SAMPLE_MEAL.photo },
  { name: 'Okafor · Lunch', protein: 19, state: 'flagged', flag: true, thumb: 'assets/meal-lunch.jpg' },
  { name: 'Tran · Breakfast', protein: 38, state: 'new', flag: false, thumb: 'assets/meal-breakfast.jpg' },
  { name: 'Bishop · Lunch', protein: 41, state: 'new', flag: false, thumb: 'assets/meal-lunch.jpg' },
  { name: 'Silva · Dinner', protein: 46, state: null, flag: false, thumb: 'assets/meal-dinner.jpg' },
];
function demoBoard() {
  return `<div class="ob2-board">${DEMO_QUEUE.map((r) => `
    <div class="br">
      <div class="bt" data-thumb="${esc(r.thumb)}"></div>
      <div class="bn">${esc(r.name)}${r.flag ? ` <span class="bf">${icon('flame', 12)}</span>` : ''}
        <div class="bsub">~${r.protein}g protein${r.state ? ` · ${r.state}` : ''}</div></div>
    </div>`).join('')}</div>`;
}

/* ---------- interactive portion correction (module scratch; refresh restarts it) ---------- */
const FIX = { pick: null };
const FIX_FACTOR = { bigger: 1.25, right: 1, smaller: 0.75 };
function fixMacros() {
  const f = FIX_FACTOR[FIX.pick] || 1;
  const n = (v) => Math.round(v * f);
  const cell = (v, k) => `<div class="mc"><div class="mv">${esc(String(v))}</div><div class="mk">${esc(k)}</div></div>`;
  return `<div class="ob2-macros">${cell(n(SAMPLE_MEAL.kcal), 'kcal')}${cell(n(SAMPLE_MEAL.protein) + 'g', 'protein')}${cell(n(SAMPLE_MEAL.carbs) + 'g', 'carbs')}${cell(n(SAMPLE_MEAL.fat) + 'g', 'fat')}</div>`;
}

/* ============================================================ */
const steps = [
  /* ================= ch0 · Discover ================= */
  {
    id: 'why', ch: 0, cta: 'Continue',
    body: () => hero(
      'The math of team fueling',
      `One dietitian. <span class="accent">A whole roster’s plates.</span>`,
      `85 athletes eat around 300 meals a day: dining hall, apartments, road trips. Every one of them shapes recovery, weight, and availability. You are responsible for all of it, and you can see almost none of it.`,
    ),
  },
  {
    id: 'gap', ch: 0, cta: 'Continue',
    body: () => hero(
      'The current way fails quietly',
      `You can’t watch them eat.`,
      `Fueling runs on trust, spot checks, and self-report. The athletes who need you most are the quiet ones: the underfueler skipping breakfast, the plate that shrinks on travel weekends. By the time it shows up in performance, the window to fix it cheaply is gone.`,
    ),
  },
  {
    id: 'answer', ch: 0, cta: 'Show me',
    body: () => hero(
      'The OnStandard answer',
      `Every plate photographed. <span class="accent">Every plate read.</span>`,
      `Athletes shoot their meals in seconds. The AI reads each plate the moment it lands: foods, portions, macros, a quality score. You work a ranked queue of flags and corrections instead of chasing 300 meals you never saw.`,
    ),
  },
  {
    id: 'name', ch: 0, cta: 'Next',
    title: () => 'You, the professional.',
    sub: () => 'Athletes and staff see this name on every review you sign.',
    body: (o) => `
      <input id="obd-first" class="ob-input" maxlength="40" placeholder="First name" aria-label="First name" autocomplete="given-name" autocapitalize="words" value="${esc(o.firstName || '')}" />
      <div class="ob2-vgap"></div>
      <input id="obd-last" class="ob-input" maxlength="40" placeholder="Last name" aria-label="Last name" autocomplete="family-name" autocapitalize="words" value="${esc(o.lastName || '')}" />
      <div class="ob2-vgap"></div>
      ${chipRow('credential', [
        { v: 'rd', t: 'RD / RDN' }, { v: 'cssd', t: 'CSSD' }, { v: 'ms', t: 'MS Nutrition' }, { v: 'student', t: 'Student / intern' },
      ], { req: false })}
      <div class="ob2-fine left">Credential is optional. It rides your name on every review and nudge your athletes see.</div>`,
    mount(root) {
      const f = root.querySelector('#obd-first'), l = root.querySelector('#obd-last');
      const btn = root.querySelector('#ob2-next');
      if (btn) btn.setAttribute('data-gate-extra', '#obd-name-ok');
      const sync = () => {
        const first = f.value.trim(), last = l.value.trim();
        capture({ firstName: first, lastName: last, name: `${first} ${last}`.trim() });
        gateMark(root, 'obd-name-ok', !!(first && last));
      };
      [f, l].forEach((el) => el.addEventListener('input', sync));
      sync();
    },
  },
  {
    id: 'door', ch: 0, cta: 'Next',
    title: () => 'Your seat.',
    sub: () => 'Run your own team board, or take the seat a head coach invited you to.',
    body: (o) => {
      const mode = o.coachMode === 'join' ? 'join' : 'create';
      const c = (ob().coach) || {};
      return `
      <div class="seg" id="obd-doormode">
        <button class="${mode === 'create' ? 'on' : ''}" data-mode="create">Start my team</button>
        <button class="${mode === 'join' ? 'on' : ''}" data-mode="join">Join a staff</button>
      </div>
      <div class="ob2-vgap"></div>
      ${mode === 'join' ? `
      <input id="obd-staff-code" class="ob-input ob2-code-input" maxlength="12" placeholder="Staff code" aria-label="Staff code from the head coach"
        autocapitalize="characters" autocorrect="off" spellcheck="false" value="${esc(c.staffCode || '')}" />
      <div class="ob2-fine left">The head coach hands out staff codes. It seats you on their team as the dietitian they invited, roster already in your queue. You won't create a new team.</div>` : `
      <div class="ob2-fine left">Your own board: you mint the join code, athletes enter it, and every plate lands in your queue.</div>`}`;
    },
    mount(root) {
      const btn = root.querySelector('#ob2-next');
      if (btn) btn.setAttribute('data-gate-extra', '#obd-door-ok');
      const codeEl = root.querySelector('#obd-staff-code');
      const sync = () => {
        const v = codeEl ? codeEl.value.trim().toUpperCase() : '';
        if (codeEl) { cap({ staffCode: v }); capture({ staffCode: v }); }
        gateMark(root, 'obd-door-ok', ob().coachMode === 'join' ? v.length >= 4 : true);
      };
      root.querySelector('#obd-doormode').querySelectorAll('button[data-mode]').forEach((b) => b.addEventListener('click', () => {
        const m = b.getAttribute('data-mode');
        capture({ coachMode: m });
        // Switching sides clears the other side's scratch so persistCoachOnboarding never routes
        // on stale data -- a leftover staff code would wrongly skip team creation (obk idiom).
        cap(m === 'create' ? { joinMode: 'create', staffCode: '' } : { joinMode: 'join' });
        if (m === 'create') capture({ staffCode: '' });
        window.__render();
      }));
      if (codeEl) codeEl.addEventListener('input', sync);
      sync();
    },
  },
  {
    id: 'program', ch: 0, cta: 'Next',
    when: (o) => !isStaffJoin(o),
    title: () => 'Your team.',
    sub: () => 'The roster you cover. It goes on the join code your athletes use.',
    body: (o) => `
      <input id="obd-team" class="ob-input" maxlength="60" placeholder="Team or program name (e.g. State Volleyball)" aria-label="Team or program name" value="${esc(o.teamName || ((o.coach || {}).teamName) || '')}" />
      <div class="ob2-vgap"></div>
      <input id="obd-sport" class="ob-input" maxlength="40" placeholder="Sport (optional)" aria-label="Sport" value="${esc(((o.coach || {}).sport) || o.sport || '')}" />
      <div class="ob2-fine left">Any sport, or several. The discipline is yours: the roster just eats.</div>`,
    mount(root) {
      const t = root.querySelector('#obd-team'), s = root.querySelector('#obd-sport');
      const btn = root.querySelector('#ob2-next');
      if (btn) btn.setAttribute('data-gate-extra', '#obd-team-ok');
      const sync = () => {
        const teamName = t.value.trim(), sport = s.value.trim();
        capture({ teamName });
        cap({ teamName, sport, discipline: 'nutrition' });
        gateMark(root, 'obd-team-ok', teamName.length >= 2);
      };
      [t, s].forEach((el) => el.addEventListener('input', sync));
      sync();
    },
  },
  {
    id: 'roster', ch: 0, cta: 'Next',
    title: () => 'How many athletes do you cover?',
    sub: () => 'Everyone whose fueling you answer for.',
    body: () => chipRow('rosterCount', ROSTER_BANDS.map((b) => ({ v: b.v, t: b.t }))),
  },
  {
    id: 'slip', ch: 0, cta: 'Next',
    title: () => 'Where does fueling slip first?',
    sub: () => 'Your queue learns to watch it hardest.',
    body: () => choiceGrid('dietSlip', [
      { v: 'road', t: 'Road trips', s: 'Travel meals nobody sees', ic: 'bolt' },
      { v: 'dining', t: 'Dining hall', s: 'Plates you never stand next to', ic: 'bowl' },
      { v: 'weekends', t: 'Weekends', s: 'Structure ends on Friday', ic: 'moon' },
      { v: 'under', t: 'Quiet underfueling', s: 'The athlete who never complains', ic: 'eye' },
    ]),
  },
  structureStep({ mode: 'assign', who: 'your athletes' }),

  /* ================= ch1 · See it ================= */
  {
    id: 'aha', ch: 1, cta: 'See the queue',
    title: () => 'Your reading load, in plates.',
    body: (o) => {
      const mid = (bandOf(o) || { mid: 75 }).mid;
      const plates = mid * 25;
      return countStat(
        plates.toLocaleString(),
        'plates a week your roster puts on tables you are answerable for.',
        `${mid} athletes × about 25 photographed meals a week`,
      ) + `<div class="ob2-gap-verdict">No professional reads ${plates.toLocaleString()} plates. The AI reads <b>every one</b> within a minute, and your expertise goes where it changes an outcome.</div>`;
    },
  },
  {
    id: 'queue', ch: 1, cta: 'Next',
    title: () => 'Your Monday starts with the flags.',
    sub: () => 'Flags first, unopened next. The rest is already read.',
    body: () => `
      ${simChip('Simulated roster')}
      ${phoneCard('Meal review', demoBoard())}
      <div class="ob2-fine">Every row is a real plate photo with the AI’s read attached. Tap one and you are looking at what the athlete actually ate.</div>`,
    mount(root) {
      root.querySelectorAll('[data-thumb]').forEach((el) => {
        const src = el.getAttribute('data-thumb');
        if (src) el.style.backgroundImage = `url('${src}')`;
      });
    },
  },
  {
    id: 'correct', ch: 1, cta: 'Next',
    title: () => 'Your correction is the record.',
    sub: () => 'The AI reads the plate. You make the call. Try it.',
    body: () => `
      ${simChip('Simulated plate')}
      ${/* phoneCard escapes its own label; pre-escaping double-encoded the ampersand. */''}
      ${phoneCard(SAMPLE_MEAL.name, `
        <div id="obd-fix-macros">${fixMacros()}</div>
        <div class="chip-row" id="obd-fix-chips">
          <div class="chp${FIX.pick === 'bigger' ? ' on' : ''}" data-fix="bigger" role="button">Portion looks bigger</div>
          <div class="chp${FIX.pick === 'right' ? ' on' : ''}" data-fix="right" role="button">Looks right</div>
          <div class="chp${FIX.pick === 'smaller' ? ' on' : ''}" data-fix="smaller" role="button">Smaller than it reads</div>
        </div>
        <div class="ob2-fine" id="obd-fix-note">${FIX.pick ? 'Correction logged under your name. The athlete’s numbers update instantly.' : 'The AI estimated this plate. Correct the portion and watch the numbers move.'}</div>`)}`,
    mount(root) {
      const wrap = root.querySelector('#obd-fix-chips');
      if (!wrap) return;
      wrap.addEventListener('click', (e) => {
        const chp = e.target.closest('[data-fix]');
        if (!chp) return;
        FIX.pick = chp.getAttribute('data-fix');
        wrap.querySelectorAll('.chp').forEach((c) => c.classList.toggle('on', c === chp));
        const m = root.querySelector('#obd-fix-macros');
        if (m) m.innerHTML = fixMacros();
        const note = root.querySelector('#obd-fix-note');
        if (note) note.textContent = FIX.pick === 'right'
          ? 'Signed off. The athlete sees your name on the read, not a robot’s.'
          : 'Correction logged under your name. The athlete’s numbers update instantly.';
      });
    },
  },

  /* ================= ch2 · Your plan ================= */
  {
    id: 'plan', ch: 2, cta: 'Next',
    title: () => 'Built from your answers.',
    body: (o) => {
      const band = bandOf(o);
      const slip = SLIP_LABEL[String((o || {}).dietSlip)] || 'the plates nobody sees';
      return `
      ${mirrorCard('users', `<b>${esc(band ? band.t : 'Your roster')}</b> athletes: the queue triages every plate so your read time stays flat as the roster grows.`)}
      ${mirrorCard('flame', `You said fueling slips at <b>${esc(slip)}</b>: those plates get flagged first, not found later.`)}
      ${mirrorCard('clipboard', `Your team standard sets what a fueled day means. Athletes prove it with photos, and the score never lies.`)}`;
    },
  },
  {
    id: 'standard', ch: 2, cta: 'Next',
    /* A staff joiner doesn't set the team's standard -- the head coach's book owns it. */
    when: (o) => !isStaffJoin(o),
    title: () => 'Your team’s fueling standard.',
    sub: () => 'The default every athlete starts on. You refine it per room later.',
    body: () => choiceGrid('teamStandard', [
      { v: 'fuel4', t: 'The 4-meal standard', s: 'Breakfast, lunch, dinner, snack. Photo-proven', ic: 'bowl' },
      { v: 'fuel3', t: 'Three meals', s: 'Breakfast, lunch, dinner', ic: 'check' },
      { v: 'custom', t: 'Shape it later', s: 'Start with the default, tune per room in the app', ic: 'gear' },
    ]),
  },

  /* ================= ch3 · Commit ================= */
  {
    id: 'commit', ch: 3, noFoot: true,
    title: () => 'Your standard of care.',
    body: (o) => {
      const std = STANDARD_LABEL[String((o || {}).teamStandard)] || 'the 4-meal standard';
      const committed = !!o.committedAt;
      const verdict = isStaffJoin(o)
        ? `Every plate on the roster gets a first read within a minute, your flags surface before morning lift, and nothing reaches an athlete’s record without a professional behind it.`
        : `Every athlete on your roster gets <b>${esc(std)}</b>, every plate gets a first read within a minute, and nothing reaches an athlete’s record without a professional behind it.`;
      return `
      <div class="ob2-gap-verdict">${verdict}</div>
      <div class="ob-foot">
        ${committed
          ? `<button class="btn green" id="obd-commit-next">${icon('check', 18)}&nbsp; Committed. Continue</button>`
          : commitButton(false)}
      </div>`;
    },
    mount(root, ctx) {
      const done = root.querySelector('#obd-commit-next');
      if (done) { done.addEventListener('click', () => ctx.next()); return; }
      wireCommit(root, () => {
        capture({ committedAt: new Date().toISOString() });
        ctx.next();
      });
    },
  },

  /* Peak-intent email capture (the shared step every flow carries). */
  saveProgressStep(3),

  /* ================= ch4 · Start ================= */
  {
    id: 'proof', ch: 4, cta: 'Continue',
    title: () => 'What it looks like in a program.',
    body: () => `
      <div class="ob2-fine left">Illustrative examples. Not actual customers yet.</div>
      <!-- LAUNCH PLACEHOLDERS: realistic sample testimonials. The founder swaps these
           for real customer quotes before go-live. Not real people. -->
      ${testimonial({
        quote: 'I stopped guessing which athletes were underfueling. The queue hands me the ten plates that matter before morning lift.',
        name: 'Dana', role: 'Sports RD · 78 athletes', initials: 'D',
        stat: '10 min', statKey: 'to clear the flags',
      })}
      ${testimonial({
        quote: 'Travel weekends used to be a black hole. Now the plates come back from the road with reads already on them.',
        name: 'Priya', role: 'Performance dietitian', initials: 'P',
        stat: '2 teams', statKey: 'one queue',
      })}`,
  },
  {
    id: 'account', ch: 4, noFoot: true,
    title: () => 'Create your account.',
    sub: (o) => (isStaffJoin(o)
      ? 'Your staff seat and your review queue live on it.'
      : 'Your team, its join code, and your review queue live on it.'),
    body: (o) => `
      ${accountBody({ terms: 'cob' })}
      <div class="ob-foot"><button id="su-go" class="btn primary" disabled>${isStaffJoin(o) ? 'Create account &amp; Join the staff' : 'Create account &amp; Get my code'}</button></div>`,
    mount(root, ctx) {
      /* The coach rail, discipline 'nutrition': signUp(role 'coach') so routing and the whole
         team-book machinery hold, then persistCoachOnboarding mints the TEAM with the
         discipline the program step captured (0202). No session (email confirm) swaps the CTA. */
      cap({ discipline: 'nutrition' });
      /* The professional handle (0056 rail): "Dana Reyes, RD". Captured here, where name and
         credential are final; _loadCoachHandleIntoRt pushes it to profiles.coach_display_name
         on first authenticated hydrate, and the greeting, the nudge sender, and review
         signatures all read that one rail. Without this the rail fell back to
         "Coach <lastName>" -- the product un-naming the profession it just sold. */
      const o = ob();
      const base = `${(o.firstName || '').trim()} ${(o.lastName || '').trim()}`.trim();
      const suffix = CRED_SUFFIX[String(o.credential)] || '';
      if (base) cap({ coachName: suffix ? `${base}, ${suffix}` : base });
      wireAccount(root, {
        role: 'coach',
        onSession: async (live) => {
          if (live) { await act.persistCoachOnboarding(); ctx.go('obd/code'); return; }
          showConfirmPending(root, { email: RT.email });
        },
      });
    },
  },
  {
    id: 'code', ch: 4, cta: 'Continue', green: true,
    /* Post-account: back can never return to the sign-up form. */
    back: 'coach-home',
    body: (o) => {
      const joined = o.joinedStaff;
      if (joined) {
        return `
        <div class="ob2-covered">
          <div class="halo"><div class="core">${icon('users', 34)}</div></div>
          <div class="ob-title">You’re on staff.</div>
          <div class="ob-sub">${esc(joined.teamName || 'The team')} · ${esc(roleLabel(normalizeRole(joined.role)))}. The meal queue, fueling board, and roster are live the moment you open your dashboard.</div>
        </div>`;
      }
      /* Join mode with no seat: the staff code didn't land (used, revoked, or a typo). The old
         create-path copy pointed at a "Create team" button -- following it would mint exactly
         the duplicate team this fork exists to prevent. Fix the code and retry HERE. */
      if (isStaffJoin(o)) {
        return `
        <div class="ob2-covered">
          <div class="halo"><div class="core">${icon('users', 34)}</div></div>
          <div class="ob-title">That staff code didn’t land.</div>
          <div class="ob-sub">Your account is set up; the staff seat isn’t. Staff codes are one use only, so check it or ask your head coach for a fresh one, then try again.</div>
        </div>
        <input id="obd-retry-code" class="ob-input ob2-code-input" maxlength="12" placeholder="Staff code"
          autocapitalize="characters" autocorrect="off" spellcheck="false" value="${esc(((ob().coach) || {}).staffCode || '')}" />
        <div class="ob2-vgap"></div>
        <div class="ob2-btn-pair"><button class="btn green sm" id="obd-join-retry">Join the staff</button></div>
        <div class="ob2-code-status" id="obd-join-status"></div>`;
      }
      const code = o.teamCode || '';
      return `
      <div class="ob2-covered">
        <div class="halo"><div class="core">${icon('bowl', 34)}</div></div>
        <div class="ob-title">Your athlete code.</div>
        <div class="ob-sub">Send it to the team group chat. Athletes join in a minute and their next meal lands in your queue.</div>
      </div>
      ${code ? `
      <div class="code-boxes fit">${code.split('').map((ch) => `<div class="cb filled">${esc(ch)}</div>`).join('')}</div>
      <div class="ob2-vgap"></div>
      <div class="ob2-btn-pair">
        <button class="btn ghost sm" id="obd-copy">${icon('clipboard', 16)} Copy code</button>
        <button class="btn ghost sm" id="obd-edit">Customize</button>
      </div>
      <div id="obd-editor" hidden>
        <div class="ob2-vgap"></div>
        <input id="obd-code-input" class="ob-input ob2-code-input" maxlength="12" placeholder="YOUR CODE · 6-12 letters/numbers"
          autocapitalize="characters" autocorrect="off" spellcheck="false" />
        <div class="ob2-vgap"></div>
        <div class="ob2-btn-pair"><button class="btn green sm" id="obd-save">Save code</button></div>
        <div class="ob2-code-status" id="obd-status">Make it yours, e.g. GATORSFUEL. The random code stops working once you save.</div>
      </div>` : `
      <div class="sidebox">
        <div class="req-icon b">${icon('clipboard', 17)}</div>
        <div><div class="tt">We couldn’t create your team</div>
        <div class="ts">Your account is set up. The team isn’t. Tap Continue and you’ll land on your dashboard with a <b>Create team</b> button waiting. One tap.</div></div>
      </div>`}`;
    },
    mount(root) {
      const $ = (s) => root.querySelector(s);
      // Join-failure recovery: correct the code in place and re-run the same persistence rail.
      const retry = $('#obd-join-retry');
      if (retry) {
        const input = $('#obd-retry-code'), status = $('#obd-join-status');
        retry.addEventListener('click', async () => {
          const raw = ((input && input.value) || '').trim().toUpperCase();
          if (raw.length < 4) { status.textContent = 'Enter the code from your head coach.'; return; }
          cap({ staffCode: raw });
          retry.disabled = true;
          status.textContent = 'Checking the code…';
          const ok = await act.persistCoachOnboarding();
          retry.disabled = false;
          if (ok && (ob().joinedStaff)) { window.__render(); return; }
          status.textContent = 'That code did not work. Staff codes are one use only; ask your head coach to mint a fresh one.';
        });
        return;
      }
      const copy = $('#obd-copy');
      if (copy) copy.addEventListener('click', async () => {
        const ok = await copyText((RT.ob || {}).teamCode || '');
        copy.innerHTML = ok ? `${icon('check', 16)} Copied` : 'Couldn’t copy';
      });
      const edit = $('#obd-edit');
      if (edit) {
        const editor = $('#obd-editor'), input = $('#obd-code-input'), status = $('#obd-status');
        edit.addEventListener('click', () => {
          editor.hidden = !editor.hidden;
          if (!editor.hidden && input) input.focus();
        });
        $('#obd-save').addEventListener('click', async (e) => {
          const raw = ((input && input.value) || '').trim().toUpperCase();
          if (!/^[A-Z0-9]{6,12}$/.test(raw)) { status.textContent = '6 to 12 letters or numbers only (A to Z, 0 to 9).'; return; }
          e.target.disabled = true;
          status.textContent = 'Saving…';
          const r = await setMyTeamCode(raw);
          e.target.disabled = false;
          if (!r.ok) { status.textContent = r.error || 'Could not save that code.'; return; }
          act.captureOb({ teamCode: r.code });
          if (RT.team) RT.team = { ...RT.team, code: r.code };
          window.__render();
        });
      }
    },
  },
  {
    id: 'covered', ch: 4, noFoot: true, back: 'obd/code',
    when: (o) => isStaffJoin(o),
    body: () => `
      <div class="ob2-covered">
        <div class="halo"><div class="core">${icon('check', 34)}</div></div>
        <div class="ob-title">Your seat is covered.</div>
        <div class="ob-sub">Staff seats ride on the program’s plan. Nothing to set up, nothing to pay.</div>
      </div>
      <div class="ob-foot"><button class="btn primary" data-go="coach-home">Open your board</button></div>`,
    mount() { track(EVENTS.PAYWALL_VIEWED, { variant: 'staff_covered' }); },
  },
  {
    id: 'plans', ch: 4, noFoot: true, back: 'obd/code',
    when: (o) => !isStaffJoin(o),
    title: () => 'Pick your program plan.',
    sub: () => 'Start free. Decide when the roster’s on the board.',
    body: (o) => `
      <div class="ob2-plans" data-obkey="plan">
        ${PLANS.org.map((p) => planCard({ ...p, on: o.plan ? o.plan === p.id : p.id === 'org_starter' })).join('')}
      </div>
      <div class="ob2-fine">No card today. You’ll confirm before anything ever charges.</div>
      <div class="ob-foot">
        <button class="btn primary" id="obd-start" data-go="coach-home">Start free. No card today</button>
      </div>`,
    mount(root) {
      track(EVENTS.PAYWALL_VIEWED, { variant: 'org' });
      root.querySelectorAll('.ob2-plan').forEach((el) => el.addEventListener('click',
        () => track(EVENTS.PLAN_SELECTED, { plan: el.getAttribute('data-val') })));
      const b = root.querySelector('#obd-start');
      if (b) b.addEventListener('click', () => track(EVENTS.TRIAL_STARTED, { plan: ob().plan || 'org_starter' }));
    },
  },
];

export const obDietitian = defineFlow({ route: 'obd', steps });
