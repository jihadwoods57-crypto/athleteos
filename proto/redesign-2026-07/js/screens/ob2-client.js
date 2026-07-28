/* ============================================================
   OB2 — FITNESS CLIENT flow (route `obf`). ~20 steps across the
   5 chapters. Narrative spine: your trainer sees 3 hours a week;
   your results are shaped by the other 165. OnStandard covers
   those hours with one photo → one Daily Score → one witness.

   Clients sign up as server role 'athlete' (general scoring
   profile) — same RT.ob keys the legacy client-ob wrote (goal,
   firstName/lastName/name, join:{kind:'practice',code},
   committedAt, email), so act.persistOnboarding() needs no
   client-specific branch. New discovery keys (trainerStatus,
   sessionsPerWeek, betweenSessions, accountabilityRating,
   pressure, plan) ride alongside; persistence ignores extras.

   ch4 ordering note (router.js ~160-190 + AUTH_ROUTES ~265):
   `obf` is listed in AUTH_ROUTES, and BOTH auth gates — the
   signed-out gate (line 164) and the coach/trainer mirror guard
   (line 181) — exempt AUTH_ROUTES. A freshly signed-in client is
   therefore NOT forced off `obf/*`, so the spec order stands:
   proof → connect → account → covered/plans → destination.
   ============================================================ */
import { RT, act, computeScore } from '../state.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';
import {
  defineFlow, saveProgressStep, choiceGrid, chipRow, scale10, countStat, mirrorCard,
  phoneCard, testimonial, planCard, paywallVariant, PLANS,
  capture, ob, gateCta, structureStep,
} from '../ob2.js';
import { mealDemoSteps } from '../ob2-meal.js';
import { styleForStructureAnswer, styleLabel } from '../plan-style.js';
import { track, EVENTS } from '../analytics.js';
import { accountBody, wireAccount } from './ob-account.js';
import { commitButton, wireCommit } from '../ob-commit.js';
import { showConfirmPending } from '../ob-helpers.js';

const ROUTE = 'obf';
const CODE_RE = /^[A-Z0-9]{4,12}$/; // same shape ob-directory validates

/* Label maps — slugs live in RT.ob, labels are mirrored back later. */
const GOALS = { lose: 'fat loss', maintain: 'maintenance', build: 'muscle gain', health: 'better health' };
const BETWEEN = {
  'wing-it': 'you wing it between sessions',
  remember: 'you try to remember the plan',
  weekends: 'weekends undo your week',
  prove: 'you eat fine but can’t prove it',
};
const PRESSURE = {
  gentle: ['Gentle', 'light nudges, weekly recap'],
  steady: ['Steady', 'daily reminders, honest weekly recap'],
  strict: ['Strict', 'misses get called out the same day'],
};

/* comp-read row (same markup the meal demo's score screen uses). */
const row = (ic, k, v) => `
  <div class="cr"><div class="ci ok">${icon(ic, 13)}</div>
  <div class="ck">${esc(k)}</div><div class="cv">${esc(v)}</div></div>`;

/* Final hop into the app — copies the legacy client-ob step 6 biometrics check. */
async function finishToApp() {
  let bio = false;
  try {
    bio = window.OnStandardNative && window.OnStandardNative.biometrics
      ? await window.OnStandardNative.biometrics.available() : false;
  } catch { bio = false; }
  window.__go(bio ? 'bio-optin' : 'home');
}

const steps = [

  /* ==================== ch0 · Discover ==================== */

  { id: 'why', ch: 0, cta: 'Keep going',
    body: () => `
      <div class="ob2-hero">
        <div class="h-eyebrow">The problem</div>
        <div class="h-title">Your trainer sees <span class="accent">3 hours</span> a week.</div>
        <div class="h-body">Sessions get coached. Meals, sleep, weekends — the rest of your week runs unwatched. That&rsquo;s where results are actually decided.</div>
      </div>` },

  { id: 'gap', ch: 0, cta: 'So what closes it?',
    body: () => `
      <div class="ob2-hero" style="padding-bottom:8px">
        <div class="h-eyebrow">Why the current way fails</div>
        <div class="h-title">Your results are shaped by <span class="accent">the other 165.</span></div>
      </div>
      ${countStat('3', 'hours a week with your trainer', '168 hours in your week − 3 coached = 165 on your own')}
      <div class="ob2-hero" style="flex:none;padding:0">
        <div class="h-note">Retelling your week from memory isn&rsquo;t accountability. It&rsquo;s a story — and stories flatter.</div>
      </div>` },

  { id: 'answer', ch: 0, cta: 'Show me',
    body: () => `
      <div class="ob2-hero">
        <div class="h-eyebrow">OnStandard&rsquo;s answer</div>
        <div class="h-title">One number. <span class="accent">All 168 hours.</span></div>
        <div class="h-body">Every meal you photograph becomes part of one Daily Score — built from what you actually do, visible to the person who holds you to it.</div>
        <div class="h-note">No food diary. No retelling. One photo per meal is the whole job.</div>
      </div>` },

  { id: 'name', ch: 0, cta: 'Next',
    title: () => 'Start with the basics',
    sub: () => 'This is how your trainer will recognize you.',
    body: (o) => `
      <input id="cl-first" class="ob-input" placeholder="First name" autocapitalize="words" autocorrect="off" spellcheck="false" value="${esc(o.firstName || '')}" />
      <div style="height:12px"></div>
      <input id="cl-last" class="ob-input" placeholder="Last name" autocapitalize="words" autocorrect="off" spellcheck="false" value="${esc(o.lastName || '')}" />`,
    mount(root) {
      const first = root.querySelector('#cl-first'), last = root.querySelector('#cl-last');
      const btn = root.querySelector('#ob2-next');
      if (!first || !last) return;
      if (btn) btn.setAttribute('data-gate-extra', '#cl-first[data-ok]');
      const sync = () => {
        const f = first.value.trim(), l = last.value.trim();
        capture({ firstName: f, lastName: l, name: `${f} ${l}`.trim() });
        if (f && l) first.setAttribute('data-ok', ''); else first.removeAttribute('data-ok');
        gateCta(root);
      };
      [first, last].forEach((el) => el.addEventListener('input', sync));
      sync();
    } },

  { id: 'goal', ch: 0, cta: 'Next',
    title: () => 'What are we fixing?',
    sub: () => 'This picks how your nutrition gets scored. Honest either way.',
    /* Same goal values the legacy client-ob captured: lose / maintain / build / health. */
    body: () => choiceGrid('goal', [
      { v: 'lose', t: 'Lose fat', s: 'Calorie window · protein held high', ic: 'target', tint: 'var(--amber-surface)', color: 'var(--amber-bright)' },
      { v: 'maintain', t: 'Maintain', s: 'Consistency over everything', ic: 'shield' },
      { v: 'build', t: 'Build', s: 'Calorie floor · never under-fueled', ic: 'plus', tint: 'var(--green-surface)', color: 'var(--green-bright)' },
      { v: 'health', t: 'Health', s: 'Energy, sleep, habits that hold', ic: 'heart', tint: 'var(--red-surface)', color: 'var(--red)' },
    ]) },
  // 0142 — applies right away (a client isn't blocked waiting on their trainer); once a
  // trainer confirms/adjusts a style, THAT wins (act.setPlanStyle / resolvePlanStyle).
  structureStep({ mode: 'propose' }),

  { id: 'trainer-status', ch: 0, cta: 'Next',
    title: () => 'Do you work with a trainer?',
    sub: () => 'This shapes how OnStandard shows up for you.',
    body: () => choiceGrid('trainerStatus', [
      { v: 'have', t: 'I have a trainer', s: 'Your score gives them your whole week', ic: 'users' },
      { v: 'had', t: 'I’ve had one before', s: 'Keep the structure without the invoice', ic: 'clock' },
      { v: 'never', t: 'Never worked with one', s: 'The AI holds the line until you do', ic: 'user' },
    ]) },

  { id: 'sessions', ch: 0, cta: 'Next',
    title: () => 'How many training sessions a week?',
    sub: () => 'With a trainer or on your own — count them all.',
    body: () => chipRow('sessionsPerWeek', [
      { v: '1-2', t: '1–2' }, { v: '3-4', t: '3–4' }, { v: '5+', t: '5+' },
      { v: 'none', t: 'None right now' },
    ]) },

  { id: 'between', ch: 0, cta: 'Next',
    title: () => 'What actually happens between sessions?',
    sub: () => 'Pick everything that sounds familiar. No judgment — this is the part we fix.',
    body: () => chipRow('betweenSessions', [
      { v: 'wing-it', t: 'I wing it' },
      { v: 'remember', t: 'I try to remember the plan' },
      { v: 'weekends', t: 'Weekends undo the week' },
      { v: 'prove', t: 'I eat fine — I just can’t prove it' },
    ], { multi: true }) },

  { id: 'acct-rate', ch: 0, cta: 'Next',
    title: () => 'How strong is your accountability right now?',
    sub: () => 'The thing that catches you when motivation dips. Rate it honestly — nobody else is grading this.',
    body: () => scale10('accountabilityRating') },

  /* ==================== ch1 · See it ==================== */

  { id: 'aha', ch: 1, cta: 'See it work',
    title: () => 'Here’s your real math.',
    body: (o) => {
      const r = Number(o.accountabilityRating) || 0;
      const verdict = !r
        ? 'Most results are decided in the hours nobody sees. OnStandard is how those hours start counting.'
        : r >= 8
          ? `You rated your between-session accountability <b>${esc(String(r))}/10</b> — strong. OnStandard doesn’t replace that. It makes it visible, so the work you already do finally shows.`
          : `You rated your between-session accountability <b>${esc(String(r))}/10</b>. Those 165 hours are exactly where it slips — and exactly the hours OnStandard covers.`;
      return `
        ${countStat('165', 'hours a week your results are <b>on you</b>', 'Your trainer can coach ~3 of your 168 hours. The other 165 shape the outcome.')}
        <div class="ob2-gap-verdict">${verdict}</div>`;
    } },

  /* Interactive product moment — real (or sample) meal analysis, spliced in.
     Voice is 'trainer' for the whole client flow (spec). */
  ...mealDemoSteps({ route: ROUTE, voice: 'trainer', computeScore }),

  /* ==================== ch2 · Your plan ==================== */

  { id: 'plan', ch: 2, cta: 'One more thing',
    title: () => 'Your system, built from your answers',
    body: (o) => {
      const goal = GOALS[o.goal];
      const slips = Array.isArray(o.betweenSessions) ? o.betweenSessions.filter((s) => BETWEEN[s]) : [];
      const slip = slips.length ? BETWEEN[slips[0]] : null;
      const style = styleLabel(styleForStructureAnswer(o.structurePref));
      const mirrors = [
        mirrorCard('target', goal
          ? `You said your goal is <b>${esc(goal)}</b> — so every meal is scored against it, not against a generic diet.`
          : 'Your goal sets the scoring — every meal is graded against it, not a generic diet.'),
        mirrorCard('clipboard', `Your plan style: <b>${esc(style.name)}</b>. ${esc(style.short)}. Your trainer can confirm or adjust it once you connect.`),
        mirrorCard('clock', slip
          ? `You said <b>${esc(slip)}</b> — so your score runs all seven days. Weekends count the same as Tuesdays.`
          : 'Your score runs all seven days. Weekends count the same as Tuesdays.'),
        mirrorCard(o.trainerStatus === 'have' ? 'users' : 'sparkle', o.trainerStatus === 'have'
          ? 'You have a trainer — your score hands them your whole week, not just your sessions.'
          : 'No trainer connected yet — the AI nutritionist reads every meal and holds the line daily until you add one.'),
      ].join('');
      return `${mirrors}
        <div style="height:12px"></div>
        ${phoneCard('The system', `<div class="comp-read">
          ${row('camera', 'One photo per meal', 'AI reads foods, portions, and macros in seconds')}
          ${row('bars', 'One Daily Score', 'Nutrition 50 · recovery 25 · commitment 15 · check-in 10')}
          ${row('eye', 'A witness', 'Your trainer — or the AI — sees the score, not a story')}
        </div>`)}`;
    } },

  { id: 'habit', ch: 2, cta: 'I can do that',
    body: () => `
      <div class="ob2-habit" style="padding-top:56px">
        <div class="hb">Before your first bite, <span class="accent">take one photo.</span></div>
        <div class="hs">That&rsquo;s the entire ask. One habit starts the whole system — the analysis, the score, and the accountability all follow from it.</div>
      </div>` },

  /* ==================== ch3 · Commit ==================== */

  { id: 'commit-q', ch: 3, cta: 'Next',
    title: () => 'How accountable do you want to be held?',
    sub: () => 'This sets your reminder intensity and how misses are handled. You can change it any time.',
    body: () => choiceGrid('pressure', [
      { v: 'gentle', t: 'Gentle', s: 'Light nudges, no pressure · weekly recap', ic: 'moon' },
      { v: 'steady', t: 'Steady', s: 'Daily reminders · honest weekly recap', ic: 'clipboard' },
      { v: 'strict', t: 'Strict', s: 'Misses get called out the same day', ic: 'flame', tint: 'var(--amber-surface)', color: 'var(--amber-bright)' },
    ]) },

  { id: 'commit', ch: 3, noFoot: true,
    title: () => 'Put it in writing.',
    sub: () => 'This is between you and you. Your trainer just gets to see it.',
    body: (o) => {
      const committed = !!o.committedAt;
      const p = PRESSURE[o.pressure] || null;
      const goal = GOALS[o.goal];
      return `
        ${phoneCard('Your standard', `<div class="comp-read">
          ${row('camera', 'The habit', 'One photo before the first bite, every meal')}
          ${row('target', 'The goal', goal ? `Every meal scored against ${goal}` : 'Every meal scored against your goal')}
          ${row('bell', 'The pressure', p ? `${p[0]} — ${p[1]}` : 'Set on the last screen — change it any time')}
        </div>`)}
        <div class="ob-foot" style="margin-top:auto">
          ${commitButton(committed)}
          ${committed ? '<div class="ob-textlink" id="ob2-commit-done" role="button">Continue</div>' : ''}
        </div>`;
    },
    mount(root, ctx) {
      wireCommit(root, () => { capture({ committedAt: new Date().toISOString() }); ctx.next(); });
      const done = root.querySelector('#ob2-commit-done');
      if (done) done.addEventListener('click', () => ctx.next());
    } },

  /* Peak-intent email capture — see saveProgressStep() in ob2.js. */
  saveProgressStep(3),

  /* ==================== ch4 · Start ==================== */

  { id: 'proof', ch: 4, cta: 'Continue',
    title: () => 'What holding it looks like.',
    sub: () => 'Illustrative — not actual customers yet.',
    /* LAUNCH PLACEHOLDERS — realistic composites, not real customers. The founder
       swaps these for real client quotes (with permission) before go-live. */
    body: () => `
      ${testimonial({ quote: 'I stopped narrating my week to my trainer. She opens my score and we spend the session training instead of confessing.', name: 'Dana', role: 'Fitness client', initials: 'D', stat: '9 wk', statKey: 'logging streak' })}
      ${testimonial({ quote: 'The weekends were my black box. One photo per meal fixed what two years of food diaries never did.', name: 'Marcus', role: 'Fitness client', initials: 'M', stat: '−14 lb', statKey: 'in 5 months' })}
      <div class="ob2-scan-note">Results vary with consistency — the score only reflects what you actually log.</div>` },

  { id: 'connect', ch: 4, cta: 'Continue', skip: true,
    /* If the account already exists (user returned here via "I have a code" on the paywall),
       don't loop them back through signup — resolve straight to the paywall they came from. */
    next: () => (RT.userId ? (paywallVariant('client') === 'trainer_covered' ? 'covered' : 'plans') : 'account'),
    title: (o) => (o.trainerStatus === 'have' ? 'Connect your trainer.' : 'Have a trainer code?'),
    sub: (o) => (o.trainerStatus === 'have'
      ? 'Ask your trainer for your client code — it links your daily score to their board from day one.'
      : 'If a trainer gave you a code, enter it here. No trainer? Skip — the AI holds the line, and you can connect one any time from Profile.'),
    body: (o) => `
      <input id="cl-code" class="ob-input" placeholder="Client code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12" value="${esc((o.join && o.join.kind === 'practice' && o.join.code) || '')}" />
      <div id="cl-code-note" class="ob2-scan-note" style="text-align:left;min-height:18px"></div>`,
    mount(root, ctx) {
      const inp = root.querySelector('#cl-code');
      const note = root.querySelector('#cl-code-note');
      const btn = root.querySelector('#ob2-next');
      if (!inp) return;
      if (btn) btn.setAttribute('data-gate-extra', '#cl-code[data-ok]');
      let seq = 0, timer = null;
      const preview = (code) => {
        /* Best-effort directory lookup (debounced) so the covered screen can name the
           trainer honestly. Offline / no directory → keep the code; persistOnboarding
           redeems it for real at account creation. */
        if (timer) clearTimeout(timer);
        const my = ++seq;
        timer = setTimeout(async () => {
          try {
            const { dir } = await import('../ob-directory.js');
            const { match } = await dir.previewCode(code);
            if (my !== seq || inp.value.trim().toUpperCase() !== code) return; // stale
            if (match && match.kind === 'practice') {
              capture({ join: { kind: 'practice', code, practiceId: match.id, practiceName: match.name, trainerName: match.trainer_name } });
              note.innerHTML = `Connected: <b>${esc(match.name || 'your trainer’s practice')}</b>${match.trainer_name ? ' · ' + esc(match.trainer_name) : ''}`;
            } else {
              capture({ join: null });
              inp.removeAttribute('data-ok');
              note.textContent = 'That code didn’t match a trainer — check it with them, or skip and connect later.';
              gateCta(root);
            }
          } catch { /* directory unreachable — code stays captured, note already honest */ }
        }, 350);
      };
      const sync = () => {
        const code = inp.value.trim().toUpperCase();
        inp.value = code;
        if (!code) {
          inp.setAttribute('data-ok', '');
          if ((ob().join || {}).kind === 'practice') capture({ join: null });
          note.textContent = '';
          gateCta(root);
          return;
        }
        if (!CODE_RE.test(code)) {
          inp.removeAttribute('data-ok');
          note.textContent = 'Codes are 4–12 letters and numbers.';
          gateCta(root);
          return;
        }
        inp.setAttribute('data-ok', '');
        capture({ join: { kind: 'practice', code } });
        note.textContent = 'Code saved — it links you to your trainer when your account is created.';
        gateCta(root);
        preview(code);
      };
      inp.addEventListener('input', sync);
      sync();
    } },

  { id: 'account', ch: 4, noFoot: true,
    title: () => 'Save your standard.',
    sub: () => 'Your score, meals, and trainer connection sync across devices.',
    body: () => `
      ${accountBody({ terms: 'clob' })}
      <div class="ob-foot" style="margin-top:auto">
        <button id="su-go" class="btn green" disabled>Create account &amp; Start</button>
      </div>`,
    mount(root, ctx) {
      /* Same sequence as legacy client-ob step 6: role 'athlete', persistOnboarding
         (writes profile + redeems join_practice + stamps), startDay0, then onward.
         Next visible step resolves to `covered` (practice join) or `plans` — reachable
         while signed in because `obf` is in router.js AUTH_ROUTES (see header note). */
      wireAccount(root, {
        role: 'athlete',
        onSession: async (live) => {
          await act.persistOnboarding();
          if (live) {
            act.startDay0();
            // 0142 — applies as their own effective style unless/until their trainer
            // assigns one; resolvePlanStyle's precedence handles the handoff automatically.
            const o = RT.ob || {};
            if (o.structurePref) { try { await act.setPlanStyle(styleForStructureAnswer(o.structurePref)); } catch { /* best-effort */ } }
            ctx.next(); return;
          }
          showConfirmPending(root, { email: RT.email });
        },
      });
    } },

  /* Paywall matrix — exactly one of these two renders (when-guards on the variant). */

  { id: 'covered', ch: 4, noFoot: true,
    when: () => paywallVariant('client') === 'trainer_covered',
    body: (o) => {
      const j = o.join || {};
      const who = j.trainerName || 'your trainer';
      const where = j.practiceName || 'your trainer’s practice';
      return `
        <div class="ob2-covered">
          <div class="halo"><div class="core">${icon('check', 38)}</div></div>
          <div class="ob-title" style="margin-top:18px">Covered by ${esc(who)}</div>
          <div class="ob-sub" style="padding:0 10px">Your access rides on ${esc(where)}. Your trainer sets your price — no consumer paywall here.</div>
        </div>
        <div class="ob2-scan-note">Questions about cost go to your trainer, not to us.</div>
        <div class="ob-foot" style="margin-top:auto">
          <button class="btn green" id="ob2-finish">Start today’s plan</button>
        </div>`;
    },
    mount(root) {
      track(EVENTS.PAYWALL_VIEWED, { variant: 'trainer_covered' });
      const b = root.querySelector('#ob2-finish');
      if (b) b.addEventListener('click', finishToApp);
    } },

  { id: 'plans', ch: 4, noFoot: true,
    when: () => paywallVariant('client') !== 'trainer_covered',
    title: () => 'Pick your plan.',
    sub: () => 'Today’s plan is ready — your trainer connection is one code away.',
    body: (o) => `
      <div class="ob2-plans" data-obkey="plan">
        ${PLANS.individual.map((p) => planCard({ ...p, on: (o.plan || 'individual') === p.id })).join('')}
      </div>
      <div class="ob2-scan-note">Nothing is charged today — you’re starting on the free preview either way.</div>
      <div class="ob-foot" style="margin-top:auto">
        <button class="btn green" id="ob2-finish">Start free — no card today</button>
        <div class="ob-textlink" role="button" data-go="obf/connect">I have a code</div>
      </div>`,
    mount(root) {
      /* Card selection is wired by the engine (data-obkey="plan") — intent capture only,
         the checkout rail is go-live gated. Default intent: Individual. */
      if (!ob().plan) capture({ plan: 'individual' });
      track(EVENTS.PAYWALL_VIEWED, { variant: paywallVariant('client') });
      root.querySelectorAll('.ob2-plan[data-val]').forEach((el) => el.addEventListener('click',
        () => track(EVENTS.PLAN_SELECTED, { plan: el.getAttribute('data-val') })));
      const b = root.querySelector('#ob2-finish');
      if (b) b.addEventListener('click', () => {
        track(EVENTS.TRIAL_STARTED, { plan: ob().plan || 'individual' });
        finishToApp();
      });
    } },
];

export const obClient = defineFlow({ route: ROUTE, steps });
