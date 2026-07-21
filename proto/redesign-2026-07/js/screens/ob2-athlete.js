/* ============================================================
   OB2 · ATHLETE flow — route `oba` (2026-07 adaptive onboarding).
   Narrative spine: problem → why the current way fails → the
   answer → discovery → aha (their own numbers) → live meal demo
   → personalized plan → commitment → proof → connect/dob/account
   → coverage or plans → home.

   Ordering note (verified against js/router.js:164/181–185 before
   building): `oba` is listed in AUTH_ROUTES, and the router only
   bounces SIGNED-OUT users off non-auth routes — a signed-in user
   is never forced off an auth route. So ch4 keeps the spec order:
   connect → dob → account → covered/plans → destination, with the
   paywall/coverage step living AFTER account creation.

   Voice note: mealDemoSteps is called exactly once at module load,
   before any answers exist, so the demo runs in the default coach
   voice. Athletes whose only supporter is a trainer hear the
   trainer voice in the CLIENT flow (`obf`), which is built for
   that relationship.
   ============================================================ */
import { RT, act, computeScore } from '../state.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';
import { dobFromParts, ageOn, showConfirmPending } from '../ob-helpers.js';
import { commitButton, wireCommit } from '../ob-commit.js';
import { accountBody, wireAccount } from './ob-account.js';
import { track, EVENTS } from '../analytics.js';
import {
  defineFlow, choiceGrid, chipRow, scale10, meter, mirrorCard, simChip,
  phoneCard, testimonial, planCard, paywallVariant, PLANS, capture,
} from '../ob2.js';
import { mealDemoSteps } from '../ob2-meal.js';

const R = 'oba';

const GOAL_LABEL = { gain: 'gain weight', lose: 'lose fat', maintain: 'maintain', performance: 'perform' };
const clamp10 = (v) => Math.max(0, Math.min(10, Number(v) || 0));

/* Final hand-off — copied from legacy onboarding step 7: biometric opt-in
   only when the native seam reports availability, else straight home. */
async function goDestination() {
  let bio = false;
  try {
    bio = window.OnStandardNative && window.OnStandardNative.biometrics
      ? await window.OnStandardNative.biometrics.available() : false;
  } catch { /* unavailable */ }
  window.__go(bio ? 'bio-optin' : 'home');
}

/* Hero screen shell (ch0 narrative beats). Accent spans live only here. */
const hero = (eyebrow, title, body, note = '') => `
  <div class="ob2-hero">
    <div class="h-eyebrow">${eyebrow}</div>
    <div class="h-title">${title}</div>
    <div class="h-body">${body}</div>
    ${note ? `<div class="h-note">${note}</div>` : ''}
  </div>`;

const steps = [

  /* ============================== ch0 · Discover ============================== */
  {
    id: 'why', ch: 0, cta: 'Continue',
    body: () => hero('The problem',
      'You train like it <span class="accent">matters.</span>',
      'Practice is two hours. The other twenty — what you eat, how you sleep, what you skip — are the hours that decide the depth chart.',
      'Most athletes lose those hours quietly.'),
  },
  {
    id: 'gap', ch: 0, cta: 'Continue',
    body: () => hero('Why it slips',
      'What gets seen <span class="accent">gets done.</span>',
      'Your coach sees effort at practice. Nobody sees the other twenty hours — so those hours drift, one skipped meal at a time.',
      'Willpower is not the problem. Visibility is.'),
  },
  {
    id: 'answer', ch: 0, cta: 'Show me',
    body: () => hero('The answer',
      'One number, <span class="accent">seen daily.</span>',
      'OnStandard builds one Daily Score from what you actually do — meals, sleep, check-ins — and puts it in front of the people who hold you to it.'),
  },
  {
    id: 'name', ch: 0, cta: 'Next',
    title: () => 'Start with the basics',
    sub: () => 'This is how your coach and team will recognize you.',
    body: (o) => `
      <input id="ob-first" class="ob-input" placeholder="First name" aria-label="First name" autocomplete="given-name" autocapitalize="words" autocorrect="off" spellcheck="false" value="${esc(o.firstName || '')}" />
      <div style="height:12px"></div>
      <input id="ob-last" class="ob-input" placeholder="Last name" aria-label="Last name" autocomplete="family-name" autocapitalize="words" autocorrect="off" spellcheck="false" value="${esc(o.lastName || '')}" />`,
    mount(root) {
      const first = root.querySelector('#ob-first'), last = root.querySelector('#ob-last');
      const btn = root.querySelector('#ob2-next');
      /* gateCta runs after this mount — data-gate-extra keeps it honest about the inputs. */
      if (btn) btn.setAttribute('data-gate-extra', '#ob-first.ok');
      const sync = () => {
        const f = first.value.trim(), l = last.value.trim();
        capture({ firstName: f, lastName: l, name: `${f} ${l}`.trim() });
        first.classList.toggle('ok', !!(f && l));
        if (btn) btn.disabled = !(f && l);
      };
      [first, last].forEach((el) => el.addEventListener('input', sync));
      sync();
    },
  },
  {
    id: 'sport', ch: 0, cta: 'Next',
    title: () => 'Your sport',
    sub: () => 'Position and level shape your plan.',
    body: (o) => `
      <div class="eyebrow" style="margin:8px 2px 10px">Sport</div>
      ${chipRow('sport', ['Football', 'Basketball', 'Baseball', 'Soccer', 'Track', 'Other'])}
      <div id="pos-wrap" style="display:${o.sport === 'Football' ? 'block' : 'none'}">
        <div style="height:16px"></div>
        <div class="eyebrow" style="margin:8px 2px 10px">Position</div>
        ${chipRow('position', ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB'], { req: false })}
      </div>
      <div style="height:16px"></div>
      <div class="eyebrow" style="margin:8px 2px 10px">Level</div>
      ${chipRow('level', ['Youth', 'High School', 'College', 'Pro'])}`,
    mount(root) {
      /* Positions exist for football only (legacy option set); switching away clears it. */
      const wrap = root.querySelector('#pos-wrap');
      const sportRow = root.querySelector('[data-obkey="sport"]');
      if (!wrap || !sportRow) return;
      sportRow.querySelectorAll('[data-val]').forEach((chp) => chp.addEventListener('click', () => {
        const football = chp.getAttribute('data-val') === 'Football';
        wrap.style.display = football ? 'block' : 'none';
        if (!football) {
          wrap.querySelectorAll('[data-val]').forEach((x) => x.classList.remove('on'));
          capture({ position: null });
        }
      }));
    },
  },
  {
    id: 'goal', ch: 0, cta: 'Next',
    title: () => 'What are we building?',
    sub: () => 'This decides how your nutrition gets scored. Your coach can adjust it.',
    body: () => choiceGrid('goal', [
      { v: 'gain', t: 'Gain weight', s: 'Calorie floor · protein heavy', ic: 'plus', tint: 'rgba(52,211,153,0.18)', color: 'var(--green-bright)' },
      { v: 'lose', t: 'Lose fat', s: 'Calorie window · keep protein', ic: 'target', tint: 'rgba(245,165,36,0.18)', color: 'var(--amber-bright)' },
      { v: 'maintain', t: 'Maintain', s: 'Consistency over everything', ic: 'shield' },
      { v: 'performance', t: 'Perform', s: 'Fuel training · recover hard', ic: 'bolt', tint: 'rgba(168,85,247,0.18)', color: 'var(--purple-bright)' },
    ]),
  },
  {
    id: 'goal-rate', ch: 0, cta: 'Next',
    title: () => 'How much does this goal matter?',
    sub: () => 'Be honest. This number comes back in a minute.',
    body: () => scale10('goalImportance'),
  },
  {
    id: 'acct-rate', ch: 0, cta: 'Next',
    title: () => 'How strong is your current accountability system?',
    sub: () => 'The thing that catches you when motivation dips — not how motivated you feel today.',
    body: () => scale10('accountabilityRating'),
  },
  {
    id: 'obstacle', ch: 0, cta: 'Next',
    title: () => 'Where do your hours leak?',
    sub: () => 'Pick everything that actually happens. Your plan targets these.',
    body: () => chipRow('obstacles', [
      'Late-night eating', 'Skipping meals', 'No plan', 'Nobody checks', 'Travel days', 'Cafeteria food',
    ], { multi: true }),
  },
  {
    id: 'support', ch: 0, cta: 'Next',
    title: () => 'Who holds you to it?',
    sub: () => 'These are the people your score can reach.',
    body: () => chipRow('supporters', [
      { v: 'coach', t: 'My coach' }, { v: 'trainer', t: 'A trainer' }, { v: 'parents', t: 'My parents' },
      { v: 'teammates', t: 'Teammates' }, { v: 'nobody', t: 'Nobody yet' },
    ], { multi: true }),
    /* "Nobody yet" is mutually exclusive with the real supporters — picking one clears the other. */
    mount(root) {
      const grid = root.querySelector('[data-obkey-multi="supporters"]');
      const nobody = grid && grid.querySelector('[data-val="nobody"]');
      if (!grid || !nobody) return;
      grid.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-val]');
        if (!chip) return;
        const others = [...grid.querySelectorAll('[data-val]')].filter((c) => c !== nobody);
        if (chip === nobody && nobody.classList.contains('on')) others.forEach((c) => c.classList.remove('on'));
        else if (chip !== nobody && chip.classList.contains('on')) nobody.classList.remove('on');
        capture({ supporters: [...grid.querySelectorAll('[data-val].on')].map((c) => c.getAttribute('data-val')) });
      });
    },
  },

  /* ============================== ch1 · See it ============================== */
  {
    id: 'aha', ch: 1, cta: 'Close the gap',
    title: () => 'Your own numbers',
    body: (o) => {
      const n = clamp10(o.goalImportance);
      const m = clamp10(o.accountabilityRating);
      const verdict = (!n && !m)
        ? 'Rate your goal and your current system on the previous two screens — the gap between them is exactly what OnStandard closes.'
        : m >= n
          ? `Your accountability system (<b>${m}/10</b>) already keeps pace with how much this goal matters (<b>${n}/10</b>). That is rare — OnStandard makes it visible, every day, to the people who back you.`
          : `You rated your goal <b>${n}/10</b> but your accountability system <b>${m}/10</b>. That gap is exactly what OnStandard closes.`;
      return `
        <div class="ob2-gap">
          ${meter(n * 10, { value: String(n), label: 'Your goal', uid: 'gap-g' })}
          ${meter(m * 10, { value: String(m), label: 'Your system', uid: 'gap-s', muted: m < n })}
        </div>
        <div class="ob2-gap-verdict">${verdict}</div>`;
    },
  },

  /* Interactive meal demo — 5 steps (demo, demo-scan, demo-result, demo-score,
     demo-chat). Called once; coach voice by default (see header voice note). */
  ...mealDemoSteps({ route: R, voice: 'coach', computeScore }),

  /* ============================== ch2 · Your plan ============================== */
  {
    id: 'plan', ch: 2, cta: 'Build the habit',
    title: () => 'The system we’re building for you',
    sub: () => 'Assembled from your answers — nothing generic in it.',
    body: (o) => {
      const goal = GOAL_LABEL[o.goal] || 'your goal';
      const obs = Array.isArray(o.obstacles) && o.obstacles.length
        ? o.obstacles.map((x) => String(x).toLowerCase()).join(', ') : null;
      const supLabel = { coach: 'your coach', trainer: 'your trainer', parents: 'your parents', teammates: 'your teammates' };
      const sup = Array.isArray(o.supporters) ? o.supporters.filter((s) => s !== 'nobody') : [];
      const supNames = sup.length ? sup.map((s) => supLabel[s] || s).join(', ') : null;
      return `
        ${mirrorCard('target', `You said <b>${esc(goal)}</b> — so every meal is scored against that goal, not a generic diet.`)}
        ${obs ? mirrorCard('flame', `Your risk zone: <b>${esc(obs)}</b>. Reminders and check-ins aim exactly there.`) : ''}
        ${supNames
          ? mirrorCard('users', `Your circle: <b>${esc(supNames)}</b>. They see the score you earn — the invisible hours finally count.`)
          : mirrorCard('users', 'No circle yet — your score still runs daily, and connecting a coach later takes one code.')}
        <div style="height:8px"></div>
        ${simChip('Example score — yours starts fresh and is earned')}
        <div style="display:flex;justify-content:center;padding:2px 0 12px">${meter(84, { value: '84', label: 'A day done right', uid: 'plan' })}</div>
        ${phoneCard('What runs daily', `
          <div class="comp-read">
            <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Daily standard</div><div class="cv">Your meals and check-ins, scored into one number</div></div>
            <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">AI analysis</div><div class="cv">Every photo read in seconds — foods, portions, macros</div></div>
            <div class="cr"><div class="ci ok">${icon('check', 13)}</div><div class="ck">Your circle</div><div class="cv">The people you picked see the score, so effort gets seen</div></div>
          </div>`)}`;
    },
  },
  {
    id: 'habit', ch: 2, cta: 'I can do that',
    body: () => `
      <div class="ob2-habit" style="display:flex;flex-direction:column;justify-content:center;flex:1">
        <div class="hb">Before your first bite,<br /><span class="accent">take one photo.</span></div>
        <div class="hs">That is the whole habit. One photo starts the analysis, the score, and the streak — everything else follows from it.</div>
      </div>`,
  },

  /* ============================== ch3 · Commit ============================== */
  {
    id: 'commit-q', ch: 3, cta: 'Next',
    title: () => 'What standard are you ready to hold yourself to?',
    sub: () => 'This sets how hard OnStandard pushes — reminder timing and intensity. You can change it any time.',
    body: () => choiceGrid('pressure', [
      { v: 'all-in', t: 'All in', s: 'Every meal, every day — full reminders', ic: 'flame', tint: 'rgba(245,165,36,0.18)', color: 'var(--amber-bright)' },
      { v: 'steady', t: 'Steady', s: 'Main meals, honest weeks — balanced reminders', ic: 'shield' },
      { v: 'building', t: 'Building', s: 'Start with one meal a day — light touch', ic: 'plus', tint: 'rgba(52,211,153,0.18)', color: 'var(--green-bright)' },
    ]),
  },
  {
    id: 'commit', ch: 3, noFoot: true,
    title: () => 'Sign it',
    body: (o) => {
      const committed = !!o.committedAt;
      const P = {
        'all-in': 'Every meal, every day.',
        steady: 'Main meals, honest weeks.',
        building: 'One meal a day, to start.',
      };
      return `
        <div class="ob2-habit">
          <div class="hb">${esc(P[o.pressure] || 'Your standard, daily.')}</div>
          <div class="hs">${esc(o.firstName ? `${o.firstName}, this` : 'This')} is the deal you are making with yourself. The score simply reports whether you kept it.</div>
        </div>
        <div style="height:24px"></div>
        ${commitButton(committed)}
        ${committed ? `<div style="height:12px"></div><button class="btn green" data-go="${R}/proof">Continue</button>` : ''}`;
    },
    mount(root, ctx) {
      wireCommit(root, () => {
        const o = RT.ob || {};
        /* standard{} keeps persistence parity with the legacy contract step. */
        capture({
          committedAt: new Date().toISOString(),
          standard: { mealsPerDay: (o.standard && o.standard.mealsPerDay) || 3, pressure: o.pressure || 'steady' },
        });
        ctx.next();
      });
    },
  },

  /* ============================== ch4 · Start ============================== */
  {
    id: 'proof', ch: 4, cta: 'Next',
    title: () => 'It works when it’s seen',
    sub: () => 'Illustrative — not actual customers yet.',
    /* Launch placeholders — the founder swaps these for real customer quotes before release. */
    body: () => `
      ${testimonial({ quote: 'My coach stopped asking if I ate. He just checks the board. I put on 9 lb over the season without one nagging text.', name: 'Marcus', role: 'RB · high school senior', initials: 'M', stat: '+9 lb', statKey: 'in a season' })}
      ${testimonial({ quote: 'The photo takes five seconds. Knowing my trainer sees the score is what actually changed my weekends.', name: 'Dani', role: 'Soccer · college sophomore', initials: 'D', stat: '41 days', statKey: 'logging streak' })}`,
  },
  {
    id: 'connect', ch: 4, cta: 'Connect', skip: true,
    title: () => 'Got a team code?',
    sub: () => 'Your coach hands it out. It puts your score on their board from day one — and your team covers your access.',
    body: (o) => `
      <input id="tc-code" class="ob-input" placeholder="Team code" aria-label="Team code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12" value="${esc(o.join && o.join.kind === 'team' ? o.join.code || '' : '')}" />
      <div class="ob2-scan-note" style="text-align:left">4–12 letters and numbers. No code? Skip — you can connect any time from Profile.</div>`,
    mount(root) {
      const el = root.querySelector('#tc-code');
      const btn = root.querySelector('#ob2-next');
      const CODE_RE = /^[A-Z0-9]{4,12}$/;
      if (btn) btn.setAttribute('data-gate-extra', '#tc-code.ok');
      const sync = () => {
        const v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
        if (el.value !== v) el.value = v;
        const ok = CODE_RE.test(v);
        /* An edited-away code must not leave a stale team join behind (it would
           flip the paywall to "covered" dishonestly). */
        capture({ join: ok ? { kind: 'team', code: v } : null });
        el.classList.toggle('ok', ok);
        if (btn) btn.disabled = !ok;
      };
      el.addEventListener('input', sync);
      sync();
    },
  },
  {
    id: 'dob', ch: 4, cta: 'Next',
    next: (o) => (o.dobBlocked ? 'blocked' : 'account'),
    title: () => 'Your birth date',
    sub: () => 'Asked once — it verifies you are old enough to use OnStandard.',
    body: (o) => {
      const [y, m, d] = o.dob ? String(o.dob).split('-') : ['', '', ''];
      return `
        <div class="dob-row">
          <input id="ob-dob-m" class="ob-input" type="number" inputmode="numeric" placeholder="MM" aria-label="Birth month" value="${esc(m ? String(+m) : '')}" />
          <input id="ob-dob-d" class="ob-input" type="number" inputmode="numeric" placeholder="DD" aria-label="Birth day" value="${esc(d ? String(+d) : '')}" />
          <input id="ob-dob-y" class="ob-input" type="number" inputmode="numeric" placeholder="YYYY" aria-label="Birth year" value="${esc(y || '')}" />
        </div>
        <div id="ob-age-err" style="color:var(--amber-bright);font-size:13px;font-weight:700;min-height:18px;margin-top:10px"></div>
        <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:6px;line-height:1.5">You must be 13 or older to use OnStandard.</div>`;
    },
    mount(root) {
      const dm = root.querySelector('#ob-dob-m'), dd = root.querySelector('#ob-dob-d'), dy = root.querySelector('#ob-dob-y');
      const errEl = root.querySelector('#ob-age-err');
      const btn = root.querySelector('#ob2-next');
      if (btn) btn.setAttribute('data-gate-extra', '#ob-dob-y.ok');
      const todayISO = () => {
        const t = new Date();
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      };
      const sync = () => {
        const dob = dobFromParts(dm.value, dd.value, dy.value);
        const under13 = dob != null && ageOn(dob, todayISO()) < 13;
        /* COPPA (legacy parity): never persist a blocked minor's identity to
           localStorage — the captured name is nulled with the dob. A corrected
           DOB clears the block; the athlete re-enters their name via Back if
           it was wiped. */
        if (under13) capture({ firstName: '', lastName: '', name: '', dob: null, dobBlocked: true });
        else capture({ dob, dobBlocked: false });
        if (!btn) return;
        if (under13) {
          errEl.textContent = 'OnStandard is for ages 13 and up.';
          btn.setAttribute('data-go', `${R}/blocked`);
          dy.classList.add('ok');
          btn.disabled = false;
        } else {
          errEl.textContent = '';
          btn.setAttribute('data-go', `${R}/account`);
          dy.classList.toggle('ok', !!dob);
          btn.disabled = !dob;
        }
      };
      [dm, dd, dy].forEach((el) => el.addEventListener('input', sync));
      dm.addEventListener('input', () => { if (dm.value.length >= 2) dd.focus(); });
      dd.addEventListener('input', () => { if (dd.value.length >= 2) dy.focus(); });
      sync();
    },
  },
  {
    id: 'blocked', ch: 4, noFoot: true, back: `${R}/dob`,
    when: (o) => !!o.dobBlocked,
    body: () => `
      <div class="standard-set" style="padding-bottom:6px">
        <div class="halo" style="background:radial-gradient(closest-side,rgba(148,163,184,0.20),transparent 75%)"><div class="core" style="background:var(--surface-2);color:var(--text-2)">${icon('lock', 32)}</div></div>
        <div class="ob-title" style="margin-top:18px">Not yet — but soon.</div>
        <div class="ob-sub" style="padding:0 8px">OnStandard is for athletes 13 and older — that's the law for apps like this, and we take it seriously. Come back on your 13th birthday. The Standard will be waiting.</div>
      </div>
      <div class="ob-foot" style="margin-top:auto">
        <button class="btn ghost" data-go="welcome">Back to start</button>
      </div>`,
    mount() { track(EVENTS.AGE_BLOCKED); },
  },
  {
    id: 'account', ch: 4, noFoot: true,
    title: () => 'Your Standard is set.',
    sub: () => 'Create your account to save it — your score, meals, and coach connection sync across devices.',
    body: () => `
      ${accountBody({ terms: 'ob' })}
      <div style="height:18px"></div>
      <div class="ob-foot" style="margin-top:auto">
        <button id="su-go" class="btn green" disabled>Create account &amp; Start</button>
      </div>`,
    mount(root, ctx) {
      wireAccount(root, {
        role: 'athlete',
        onSession: async (live) => {
          await act.persistOnboarding();
          if (live) {
            act.startDay0();
            /* Signed-in users may remain on `oba/*` (AUTH_ROUTES) — continue
               in-flow to the coverage/paywall step per the spec's ch4 order. */
            ctx.go(`${R}/${paywallVariant('athlete') === 'team_covered' ? 'covered' : 'plans'}`);
            return;
          }
          showConfirmPending(root, { email: RT.email });
        },
      });
    },
  },
  {
    id: 'covered', ch: 4, noFoot: true, next: () => null,
    when: () => paywallVariant('athlete') === 'team_covered',
    body: (o) => {
      const code = (o.join && o.join.code) || '';
      return `
        <div class="ob2-covered">
          <div class="halo"><div class="core">${icon('check', 34)}</div></div>
          <div class="ob-title" style="margin-top:18px">Covered by your team</div>
          <div class="ob-sub" style="padding:0 8px">Your team code${code ? ` <b>${esc(code)}</b>` : ''} covers your access — no plans, no card, nothing to pay. Your coach's board is waiting for your first score.</div>
        </div>
        <div class="ob-foot" style="margin-top:auto">
          <button id="ob-enter" class="btn green">Enter OnStandard</button>
          <div class="ob2-scan-note">Today's standard is live. One photo starts it.</div>
        </div>`;
    },
    mount(root) {
      root.querySelector('#ob-enter').addEventListener('click', goDestination);
    },
  },
  {
    id: 'plans', ch: 4, noFoot: true, next: () => null,
    when: () => paywallVariant('athlete') !== 'team_covered',
    title: () => 'Pick your plan',
    sub: () => 'The trial opens everything. Nothing charges today.',
    /* Annual-first, mirroring src/core/pricing.ts (revenue build 2026-07-04): annual is the
       framed default (saves ~2 months), one trust cue sits right above the price, and the
       auto-renew terms are disclosed on-screen. Selection is captured to RT.ob.{plan,cadence}
       as intent — billing is still go-live gated, nothing charges today. */
    body: (o) => {
      const cad = o.cadence || 'annual';
      const plan = o.plan || PLANS.individual[0].id;
      return `
      ${testimonial({ quote: 'My coach stopped asking if I ate. He just checks the board. I put on 9 lb over the season without one nagging text.', name: 'Marcus', role: 'RB · high school senior', initials: 'M', stat: '+9 lb', statKey: 'in a season' })}
      <div class="ob2-cadence" role="tablist" aria-label="Billing period">
        <button class="cad ${cad === 'annual' ? 'on' : ''}" data-cad="annual" role="tab" aria-selected="${cad === 'annual'}">Annual<small>2 months free</small></button>
        <button class="cad ${cad === 'monthly' ? 'on' : ''}" data-cad="monthly" role="tab" aria-selected="${cad === 'monthly'}">Monthly</button>
      </div>
      <div class="ob2-plans" id="ob-plans">
        ${PLANS.individual.map((p) => planCard({ ...p, cadence: cad, on: plan === p.id })).join('')}
      </div>
      <div style="height:16px"></div>
      <div class="ob-foot" style="margin-top:auto">
        <button id="ob-start" class="btn green">Start free — no card today</button>
        <div class="ob2-fine" id="ob-fine"></div>
        <div class="ob-textlink" style="padding-top:10px" data-go="${R}/connect">I have a code</div>
        <div class="ob2-scan-note">Today's standard is live. One photo starts it.</div>
      </div>`;
    },
    mount(root) {
      const o = () => (RT.ob || {});
      const cad = () => o().cadence || 'annual';
      const plan = () => o().plan || PLANS.individual[0].id;
      const fineFor = (c) => c === 'annual'
        ? 'Free for 7 days, then the yearly price. Cancel anytime in Settings before it ends.'
        : 'Free for 7 days, then the monthly price. Cancel anytime in Settings before it ends.';
      const render = () => {
        const list = root.querySelector('#ob-plans');
        list.innerHTML = PLANS.individual.map((p) => planCard({ ...p, cadence: cad(), on: plan() === p.id })).join('');
        list.querySelectorAll('.ob2-plan').forEach((el) => el.addEventListener('click', () => { capture({ plan: el.dataset.val }); render(); }));
        root.querySelectorAll('.ob2-cadence .cad').forEach((b) => {
          const on = b.dataset.cad === cad();
          b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
        });
        root.querySelector('#ob-fine').textContent = fineFor(cad());
      };
      root.querySelectorAll('.ob2-cadence .cad').forEach((b) => b.addEventListener('click', () => { capture({ cadence: b.dataset.cad }); render(); }));
      render();
      root.querySelector('#ob-start').addEventListener('click', () => {
        /* Lock in the framed defaults if the user never tapped. Intent only — billing is go-live gated. */
        if (!o().plan) capture({ plan: PLANS.individual[0].id });
        if (!o().cadence) capture({ cadence: 'annual' });
        goDestination();
      });
    },
  },
];

export const obAthlete = defineFlow({ route: R, steps });
