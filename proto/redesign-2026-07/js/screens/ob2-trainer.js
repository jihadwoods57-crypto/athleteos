/* ============================================================
   OB2 — TRAINER flow (route `obt`, ~20 steps).
   Narrative: your value shouldn't stop when the session ends →
   chasing by text is unpaid work → OnStandard keeps your
   standard in their pocket → discovery (practice, clients,
   follow-up hours, pains, price band) → aha (their unpaid
   hours/year) → product tour (requirement, meal review, AI
   weekly summary + the four REAL draft stances, client view,
   price setter, retention) → plan → commit → proof → account
   (role 'trainer', persistTrainerOnboarding — same mechanics
   as legacy trainer-ob) → client-code reveal → plans → trainer.

   Trainers REVIEW an analyzed meal (SAMPLE_MEAL) — they never
   run the live demo, so mealDemoSteps is not spliced here.
   The trainer-set client price has NO billing rail anywhere in
   the product yet: every price surface is framed as
   configuration/projection, never an active charge.
   ============================================================ */
import { RT, act } from '../state.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';
import {
  defineFlow, choiceGrid, chipRow, simChip, mirrorCard, countStat,
  phoneCard, testimonial, planCard, PLANS, chatSim,
} from '../ob2.js';
import { SAMPLE_MEAL } from '../ob2-meal.js';
import { accountBody, wireAccount } from './ob-account.js';
import { commitButton, wireCommit } from '../ob-commit.js';
import { showConfirmPending } from '../ob-helpers.js';

/* ---------- band midpoints (guarded: every read works with an empty RT.ob) ---------- */
const COUNT_MID = { 5: 5, 10: 10, 20: 20, 30: 30 };
const countMid = (o) => COUNT_MID[o.clientCount] || 10;
const FOLLOWUP_MID = { '1-2': 1.5, '3-5': 4, '6-10': 8, more: 12 };
const followupMid = (o) => FOLLOWUP_MID[o.followupHours] || 4; /* default band 3–5 → 4 */

const PAIN_LABEL = {
  ghost: 'clients ghosting between sessions',
  meals: 'not seeing what they actually eat',
  stall: 'results stalling',
  retention: 'clients not staying',
};

/* Sample requirement templates for the req-build tour step. */
const REQS = {
  meals: { ic: 'utensils', t: 'Meal photos', s: 'Every meal · photo proof · AI does the first read' },
  protein: { ic: 'bolt', t: 'Protein target', s: 'Daily gram target · checked automatically from their logs' },
  workout: { ic: 'bars', t: 'Workout log', s: 'Training days · one quick form after the session' },
  weighin: { ic: 'scale', t: 'Weekly weigh-in', s: 'Monday mornings · trend only, never a daily judgment' },
};

const AI_LABEL = {
  autopilot: 'on full autopilot — nudges and drafts daily, everything waits for your approval',
  drafts: 'in drafts-only mode — the AI writes, nothing sends without you',
  observe: 'in observe mode — you drive, the AI stays quiet until you invite it',
};

/* Small stacked row inside a phone card (icon + title + sub). */
const boundRow = (ic, t, s) => `
  <div class="ob2-bound">
    <div class="bi yes">${icon(ic, 16)}</div>
    <div style="flex:1;min-width:0"><div class="bt">${esc(t)}</div><div class="bs">${esc(s)}</div></div>
  </div>`;

/* Labeled draft-reply bubble — the four stances ARE the shipped product's stances. */
const stanceBubble = (label, text) => `
  <div style="margin-bottom:12px">
    <div style="font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-3);margin:0 2px 4px">${esc(label)}</div>
    <div style="padding:11px 14px;border-radius:16px;background:var(--surface-2);border:1px solid var(--hairline-soft);font-size:13.5px;font-weight:600;line-height:1.5">${esc(text)}</div>
  </div>`;

/* Practice invite share text — mirrors src/core/practiceIdentity.ts inline the same way
   roles.js does (that copy is module-local, not exported). Empty code → empty string. */
function inviteShareText(code, practiceName) {
  const c = (code || '').trim().toUpperCase();
  if (!c) return '';
  const name = (practiceName && practiceName.trim()) || 'my practice';
  return `Join ${name} on OnStandard. Use code ${c} or open https://onstandard.app/join?code=${c}`;
}

const money = (n) => `$${Math.round(n).toLocaleString()}`;

const steps = [
  /* ==================== ch0 · Discover ==================== */
  {
    id: 'why', ch: 0, cta: 'Continue',
    body: () => `
      <div class="ob2-hero">
        <div class="h-eyebrow">For trainers</div>
        <div class="h-title">Your value shouldn’t stop <span class="accent">when the session ends.</span></div>
        <div class="h-body">You coach for an hour. Their results are decided in the 167 hours you can’t see — and right now, that time belongs to nobody.</div>
      </div>`,
  },
  {
    id: 'gap', ch: 0, cta: 'Continue',
    body: () => `
      <div class="ob2-hero">
        <div class="h-eyebrow">The current way</div>
        <div class="h-title">Chasing clients by text <span class="accent">is unpaid work.</span></div>
        <div class="h-body">Check-in texts. “Did you log?” reminders. Silence you can’t read. The clients who quietly drift between sessions are the ones who leave — and you find out at renewal.</div>
      </div>`,
  },
  {
    id: 'answer', ch: 0, cta: 'Show me',
    body: () => `
      <div class="ob2-hero">
        <div class="h-eyebrow">OnStandard</div>
        <div class="h-title">Your standard, <span class="accent">in their pocket.</span></div>
        <div class="h-body">Every client carries your daily standard and one score you can read in five seconds. The AI handles the chasing; your name stays on the results.</div>
      </div>`,
  },
  {
    id: 'name', ch: 0, cta: 'Next', back: 'role',
    title: () => 'You, trainer.',
    sub: () => 'Clients see this name on every note you send.',
    body: (o) => `
      <input id="tr-first" class="ob-input" placeholder="First name" aria-label="First name" autocomplete="given-name" autocapitalize="words" spellcheck="false" autocorrect="off" value="${esc(o.firstName || '')}" />
      <div style="height:12px"></div>
      <input id="tr-last" class="ob-input" placeholder="Last name" aria-label="Last name" autocomplete="family-name" autocapitalize="words" spellcheck="false" autocorrect="off" value="${esc(o.lastName || '')}" />
      <div style="height:16px"></div>
      <input id="tr-practice" class="ob-input" placeholder="Practice name (e.g. Boone Performance)" aria-label="Practice name" spellcheck="false" autocorrect="off" value="${esc(o.practiceName || '')}" />
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0;line-height:1.45">Your practice name goes on the invite your clients get. You can name it later.</div>`,
    mount(root, ctx) {
      const f = root.querySelector('#tr-first');
      const l = root.querySelector('#tr-last');
      const p = root.querySelector('#tr-practice');
      const btn = root.querySelector('#ob2-next');
      if (!f || !l || !p) return;
      if (btn) btn.setAttribute('data-gate-extra', '#tr-first[data-ok]');
      const sync = () => {
        const fn = f.value.trim(), ln = l.value.trim(), pn = p.value.trim();
        // Same capture keys as legacy trainer-ob step 1: RT.ob.name for the account step +
        // profiles.full_name, RT.ob.trainer.practiceName for act.persistTrainerOnboarding.
        ctx.capture({
          firstName: fn, lastName: ln, name: `${fn} ${ln}`.trim(), practiceName: pn,
          trainer: { ...(((RT.ob || {}).trainer) || {}), practiceName: pn },
        });
        const ok = !!(fn && ln);
        if (ok) f.setAttribute('data-ok', ''); else f.removeAttribute('data-ok');
        if (btn) btn.disabled = !ok;
      };
      [f, l, p].forEach((el) => el.addEventListener('input', sync));
      sync();
    },
  },
  {
    id: 'clients', ch: 0, cta: 'Next',
    title: () => 'How many clients do you train?',
    sub: () => 'This sizes your daily queue — and the numbers you’ll see in a minute.',
    body: () => chipRow('clientCount', [
      { v: '5', t: '5 or fewer' }, { v: '10', t: 'About 10' },
      { v: '20', t: 'About 20' }, { v: '30', t: '30 or more' },
    ]),
  },
  {
    id: 'service', ch: 0, cta: 'Next',
    title: () => 'How do you train them?',
    body: () => choiceGrid('serviceType', [
      { v: 'in-person', t: 'In person', s: 'Gym floor, sessions on a schedule', ic: 'users', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
      { v: 'online', t: 'Online', s: 'Programs and check-ins, wherever they are', ic: 'message', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
      { v: 'hybrid', t: 'Hybrid', s: 'Some in the room, some remote', ic: 'grid', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
    ]),
  },
  {
    id: 'followup-hours', ch: 0, cta: 'Next',
    title: () => 'Hours a week spent chasing check-ins?',
    sub: () => 'Texts, reminders, “did you log?” — all the between-session follow-up.',
    body: () => chipRow('followupHours', [
      { v: '1-2', t: '1–2' }, { v: '3-5', t: '3–5' }, { v: '6-10', t: '6–10' }, { v: 'more', t: 'More than 10' },
    ]),
  },
  {
    id: 'pain', ch: 0, cta: 'Next',
    title: () => 'What costs you the most?',
    sub: () => 'Pick everything that’s true.',
    body: () => chipRow('pains', [
      { v: 'ghost', t: 'Clients ghost between sessions' },
      { v: 'meals', t: 'Can’t see what they eat' },
      { v: 'stall', t: 'Results stall' },
      { v: 'retention', t: 'Clients don’t stay' },
    ], { multi: true }),
  },
  {
    id: 'price', ch: 0, cta: 'Next',
    title: () => 'What do you charge per client?',
    sub: () => 'Roughly, per month. Stays private — it only sizes the projection coming up.',
    body: () => chipRow('pricePoint', [
      { v: 'under50', t: 'Under $50' }, { v: '50-100', t: '$50–$100' },
      { v: '100-200', t: '$100–$200' }, { v: '200plus', t: '$200+' },
    ]),
  },

  /* ==================== ch1 · See it ==================== */
  {
    id: 'aha', ch: 1, cta: 'Take it back',
    title: () => 'The math on chasing.',
    body: (o) => {
      const mid = followupMid(o);
      const hrs = Math.round(mid * 52);
      return `
        ${countStat(`${hrs} hrs`,
          'unpaid hours a year chasing basics — check-in texts, reminders, “did you log?”',
          `${mid} hrs a week × 52 weeks — your estimate`)}
        <div style="font-size:14px;font-weight:600;color:var(--text-2);line-height:1.55;text-align:center;margin-top:16px;padding:0 6px">That’s work your expertise is subsidizing for free. OnStandard automates the chasing — reminders, first reads, drafted replies — and leaves you the calls only you can make.</div>`;
    },
  },
  {
    id: 'req-build', ch: 1, cta: 'Next',
    title: () => 'Set a standard once.',
    sub: () => 'Pick one requirement — every client you invite starts with it, automatically.',
    body: (o) => {
      const r = REQS[o.sampleReq];
      return `
        ${choiceGrid('sampleReq', [
          { v: 'meals', t: 'Meal photos', s: 'Every meal, photo proof', ic: 'utensils', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
          { v: 'protein', t: 'Protein target', s: 'A daily gram floor', ic: 'bolt', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
          { v: 'workout', t: 'Workout log', s: 'Quick form on training days', ic: 'bars', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
          { v: 'weighin', t: 'Weekly weigh-in', s: 'Monday trend, no daily judgment', ic: 'scale', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
        ])}
        ${r ? `
        <div style="height:14px"></div>
        ${simChip('Preview — simulated client card')}
        ${phoneCard('Every new client starts with', boundRow(r.ic, r.t, r.s))}` : ''}`;
    },
    mount(root) {
      // Repaint on pick so the preview card reflects the choice (capture already ran —
      // wireChoices binds before step mounts, so this listener fires after it).
      root.querySelectorAll('[data-obkey="sampleReq"] [data-val]').forEach((el) =>
        el.addEventListener('click', () => window.__render()));
    },
  },
  {
    id: 'meal-review', ch: 1, cta: 'Next',
    title: () => 'Review a client meal in seconds.',
    sub: () => 'The AI does the first read — foods, portions, macros. You approve or adjust, and your call is what the client sees.',
    body: () => `
      ${simChip('Sample client meal — simulated')}
      <img class="ob2-meal-photo" src="${esc(SAMPLE_MEAL.photo)}" alt="Sample client meal photo" />
      <div style="height:14px"></div>
      ${phoneCard('AI first read — detected foods', `
        <div class="ob2-foods">${(SAMPLE_MEAL.detectedRich || []).map((f) => `
          <div class="fr">
            <div class="fn">${esc(f.name)}</div>
            <div class="fq">${esc(f.quantity || '')}</div>
            <div class="fc ${esc(f.confidence || 'medium')}">${esc(f.confidence || 'medium')}</div>
          </div>`).join('')}</div>`)}
      <div style="height:10px"></div>
      ${phoneCard('Estimated macros', `
        <div class="ob2-macros">
          <div class="mc"><div class="mv">${SAMPLE_MEAL.kcal}</div><div class="mk">kcal</div></div>
          <div class="mc"><div class="mv">${SAMPLE_MEAL.protein}g</div><div class="mk">protein</div></div>
          <div class="mc"><div class="mv">${SAMPLE_MEAL.carbs}g</div><div class="mk">carbs</div></div>
          <div class="mc"><div class="mv">${SAMPLE_MEAL.fat}g</div><div class="mk">fat</div></div>
        </div>
        <div class="ob2-scan-note" style="text-align:left;margin-top:10px">This meal grades ${SAMPLE_MEAL.quality}/100 — ${esc(SAMPLE_MEAL.note)} You can correct any line; your correction is what sticks.</div>`)}`,
  },
  {
    id: 'summary', ch: 1, cta: 'Next',
    title: () => 'Your Monday, drafted.',
    sub: () => 'Every week the AI writes the summary and drafts your reply in four stances. Nothing sends without you.',
    body: () => `
      ${simChip('Sample client week — simulated')}
      ${phoneCard('Weekly summary — Jordan', `
        ${boundRow('check', '5 of 7 days logged', 'Best week this month')}
        ${boundRow('bolt', 'Protein average 132g', 'Up from 120g since the breakfast change')}
        ${boundRow('clock', 'Both misses were weekend dinners', 'Same pattern two weeks running')}`)}
      <div style="height:10px"></div>
      ${phoneCard('Draft replies — pick your stance', `
        ${stanceBubble('Supportive', 'Big week, Jordan — 5 of 7 logged and your best protein average yet. Keep Thursday’s dinner formula going.')}
        ${stanceBubble('Direct', 'You logged 5 of 7. Both misses were weekends — that’s the pattern to break this week. Photos Saturday, no exceptions.')}
        ${stanceBubble('Context', 'Protein is up 12g on average since we bumped breakfast. The weekend dip is the last leak — fix that and the scale follows.')}
        ${stanceBubble('Follow-up', 'Haven’t seen a log since Thursday — everything good? One photo tonight gets the streak back.')}`)}`,
  },
  {
    id: 'client-view', ch: 1, cta: 'Next',
    title: () => 'What your client sees.',
    sub: () => 'Your standard, your name. The app just carries it.',
    body: (o) => {
      const trainerName = (o.name || '').trim() || 'Your name';
      const init = trainerName[0].toUpperCase();
      return `
        ${simChip('Simulated preview — a sample client’s screen')}
        ${phoneCard('Jordan’s plan — set by you', `
          ${boundRow('utensils', 'Three meals · photo proof', 'AI first read, your review')}
          ${boundRow('bolt', 'Protein target · 140g', 'Checked automatically from logs')}
          ${boundRow('scale', 'Weekly weigh-in · Monday', 'Trend only')}`)}
        <div style="height:12px"></div>
        ${chatSim([
          { who: 'trainer', name: trainerName, init, sim: true, text: 'Good week — keep the breakfast anchor and let’s hold 140g through the weekend.' },
        ])}`;
    },
  },
  {
    id: 'price-set', ch: 1, cta: 'Next',
    title: () => 'Set your client price.',
    sub: () => 'Configuration only — OnStandard doesn’t bill your clients today. You set the real price when you invite them.',
    body: (o) => {
      /* Seed the slider from the price band the trainer picked earlier (pricePoint) so their
         answer isn't discarded; once they drag, clientPrice takes over. */
      /* step-aligned to the slider grid (19 + 5·k) so the seed doesn't snap/flash */
      const PRICE_START = { under50: 39, '50-100': 74, '100-200': 149, '200plus': 199 };
      const p = Math.max(19, Math.min(199, Math.round(o.clientPrice || PRICE_START[o.pricePoint] || 49)));
      const count = countMid(o);
      const mo = p * count;
      return `
        <div class="ob2-price">
          <div class="pv" id="pr-val">$${p}<small>/client · mo</small></div>
          <input id="pr-range" type="range" min="19" max="199" step="5" value="${p}" aria-label="Client price per month" />
        </div>
        <div class="ob2-rev">
          <div class="rv"><div class="v" id="pr-mo">${money(mo)}</div><div class="k">Per month · ${count} clients</div></div>
          <div class="rv"><div class="v" id="pr-yr">${money(mo * 12)}</div><div class="k">Per year</div></div>
        </div>
        <div class="ob2-scan-note">Projection — you set the real price when you invite clients.${o.clientCount ? '' : ' Sized at 10 clients until you told us more.'} Nothing is charged through OnStandard today.</div>`;
    },
    mount(root, ctx) {
      const range = root.querySelector('#pr-range');
      if (!range) return;
      const count = countMid(ctx.ob);
      const pv = root.querySelector('#pr-val');
      const mo = root.querySelector('#pr-mo');
      const yr = root.querySelector('#pr-yr');
      const val = () => Math.max(19, Math.min(199, Math.round(Number(range.value) || 49)));
      const paint = () => {
        const v = val();
        if (pv) pv.innerHTML = `$${v}<small>/client · mo</small>`;
        const m = v * count;
        if (mo) mo.textContent = money(m);
        if (yr) yr.textContent = money(m * 12);
      };
      range.addEventListener('input', () => { paint(); ctx.capture({ clientPrice: val() }); });
      ctx.capture({ clientPrice: val() }); /* the default counts even if never dragged */
    },
  },
  {
    id: 'retention', ch: 1, cta: 'Next', green: true,
    /* Qualitative framing only — no invented retention statistic. */
    body: () => `
      <div class="ob2-hero">
        <div class="h-eyebrow">Why it matters</div>
        <div class="h-title">Clients who see progress <span class="accent">stay.</span></div>
        <div class="h-body">A client who logs daily, gets your feedback, and watches their score climb has a reason to renew that doesn’t depend on motivation. Visible progress — with your name attached — is the retention plan.</div>
      </div>`,
  },

  /* ==================== ch2 · Your plan ==================== */
  {
    id: 'plan', ch: 2, cta: 'Next',
    title: () => 'Your practice, systemized.',
    body: (o) => {
      const mirrors = [];
      if (o.clientCount) mirrors.push(mirrorCard('users', `You said you train <b>~${esc(o.clientCount)} clients</b> — one code connects every one of them to your standard.`));
      if (o.followupHours) mirrors.push(mirrorCard('clock', `You said <b>${esc(o.followupHours === 'more' ? 'more than 10' : o.followupHours)} hrs a week</b> goes to chasing — the daily queue and drafted replies take that back.`));
      const pains = Array.isArray(o.pains) ? o.pains : [];
      const p0 = pains.find((p) => PAIN_LABEL[p]);
      if (p0) mirrors.push(mirrorCard('target', `You said <b>${esc(PAIN_LABEL[p0])}</b> costs you — every client’s day now lands in front of you as one score.`));
      if (!mirrors.length) mirrors.push(mirrorCard('bars', 'OnStandard turns your between-session follow-up into a system that runs without you typing it.'));
      return `
        ${mirrors.join('')}
        <div style="height:12px"></div>
        ${phoneCard('The system we’re building for you', `
          ${boundRow('key', 'One client code', 'Clients connect themselves — no setup calls')}
          ${boundRow('bars', 'A daily queue', 'Sorted by who needs you, not who texted last')}
          ${boundRow('sparkle', 'AI drafts you approve', 'The chasing is written for you; your name signs it')}`)}`;
    },
  },

  /* ==================== ch3 · Commit ==================== */
  {
    id: 'commit-q', ch: 3, cta: 'Next',
    title: () => 'How involved should OnStandard be?',
    sub: () => 'This sets your automation defaults. Change it anytime.',
    body: () => choiceGrid('aiInvolvement', [
      { v: 'autopilot', t: 'Full autopilot', s: 'AI nudges and drafts daily — everything waits for your approval', ic: 'sparkle', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
      { v: 'drafts', t: 'Drafts only', s: 'AI writes, you decide what sends and when', ic: 'edit', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
      { v: 'observe', t: 'Observe first', s: 'You drive — the AI stays quiet until you invite it', ic: 'eye', tint: 'var(--purple-surface)', color: 'var(--purple-bright)' },
    ]),
  },
  {
    id: 'commit', ch: 3, noFoot: true,
    title: () => 'Put your name on it.',
    sub: () => 'Your standard travels with every client — this is you signing it.',
    body: (o) => `
      ${mirrorCard('users', `Every client you invite starts on <b>your standard</b>${o.practiceName ? ` at <b>${esc(o.practiceName)}</b>` : ''}.`)}
      ${mirrorCard('sparkle', `The AI runs <b>${esc(AI_LABEL[o.aiInvolvement] || AI_LABEL.drafts)}</b>.`)}
      <div class="ob-foot" style="margin-top:18px">
        ${commitButton(!!o.committedAt)}
        ${o.committedAt ? `<div style="height:10px"></div><button class="btn green" data-go="obt/proof">Continue</button>` : ''}
      </div>`,
    mount(root, ctx) {
      wireCommit(root, () => {
        ctx.capture({ committedAt: new Date().toISOString() });
        ctx.next();
      });
    },
  },

  /* ==================== ch4 · Start ==================== */
  {
    id: 'proof', ch: 4, cta: 'Next',
    title: () => 'What it looks like for a trainer.',
    body: () => `
      <div class="eyebrow" style="margin:0 2px 12px">Illustrative examples — not actual customers yet</div>
      ${/* Launch placeholders — the founder swaps these for real customers before go-live. */''}
      ${testimonial({
        quote: 'I used to spend Sunday night texting check-ins. Now I open the queue, approve the drafts, and it’s done before my coffee is.',
        name: 'Danielle', role: 'Online coach · 22 clients', initials: 'D',
        stat: '4 hrs', statKey: 'won back weekly',
      })}
      ${testimonial({
        quote: 'A client went quiet in week two — the queue flagged it, I sent one note, and she’s still with me. I would never have caught that over text.',
        name: 'Marcus', role: 'Strength trainer · in-person', initials: 'M',
      })}`,
  },
  {
    id: 'account', ch: 4, noFoot: true,
    title: () => 'Create your account.',
    sub: () => 'Your practice, client code, and queue live on it.',
    body: () => `
      ${accountBody({ terms: 'tob' })}
      <div class="ob-foot" style="margin-top:18px"><button id="su-go" class="btn primary" disabled>Create account &amp; Get my code</button></div>`,
    mount(root) {
      // Same post-account mechanics as legacy trainer-ob step 3 (route `obt` is auth-gated
      // the same way trainer-ob is): live session → persist practice → code reveal.
      wireAccount(root, {
        role: 'trainer',
        onSession: async (live) => {
          if (live) { await act.persistTrainerOnboarding(); window.__go('obt/code'); return; }
          showConfirmPending(root, { email: RT.email });
        },
      });
    },
  },
  {
    id: 'code', ch: 4, cta: 'Continue',
    back: 'obt/code', /* back is neutralized post-account — there’s no un-creating the account */
    title: () => 'Your client code.',
    sub: () => 'Send it to your clients. They enter it once and their work starts counting toward your view.',
    body: () => {
      const code = (RT.ob || {}).practiceCode || '';
      return code ? `
        <div style="height:8px"></div>
        <div class="code-boxes">${code.split('').map((c) => `<div class="cb filled" style="border-color:var(--purple-border);background:rgba(168,85,247,0.08)">${esc(c)}</div>`).join('')}</div>
        <div style="height:14px"></div>
        <div style="display:flex;justify-content:center;gap:8px">
          <button class="btn ghost sm" id="copy-code" style="width:auto;padding:0 22px">${icon('clipboard', 16)} Copy code</button>
          <button class="btn ghost sm" id="share-code" style="width:auto;padding:0 22px">${icon('share', 16)} Share invite</button>
        </div>
        <div style="font-size:12px;font-weight:600;color:var(--text-3);text-align:center;margin-top:14px;line-height:1.5">Invite your first client — the moment they enter it, their days start landing in your queue.</div>` : `
        <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
          <div><div class="tt">Code pending</div><div class="ts">We couldn’t mint your code yet (connection or pending email confirmation). It generates automatically on your next sign-in — check Profile → Client code.</div></div></div>`;
    },
    mount(root, ctx) {
      const code = (ctx.ob || {}).practiceCode || '';
      const copy = root.querySelector('#copy-code');
      if (copy) copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); } catch { /* label still confirms intent */ }
        copy.innerHTML = `${icon('check', 16)} Copied`;
      });
      const share = root.querySelector('#share-code');
      if (share) share.addEventListener('click', async () => {
        const text = inviteShareText(code, (ctx.ob || {}).practiceName);
        if (!text) return;
        try {
          if (navigator.share) { await navigator.share({ text }); return; }
          await navigator.clipboard.writeText(text);
          share.innerHTML = `${icon('check', 16)} Invite copied`;
        } catch { /* user cancelled the share sheet — no-op */ }
      });
    },
  },
  {
    id: 'plans', ch: 4, noFoot: true,
    title: () => 'Pick your plan.',
    sub: () => 'Start free today — billing turns on at launch, and nothing charges until then.',
    body: (o) => `
      <div class="ob2-plans" data-obkey="plan">
        ${PLANS.pro.map((p, i) => planCard({ ...p, on: o.plan ? o.plan === p.id : i === 0 })).join('')}
      </div>
      <div class="ob-foot" style="margin-top:18px">
        <button class="btn primary" data-go="trainer">Start free — no card today</button>
        <div style="font-size:12px;font-weight:600;color:var(--text-3);text-align:center;margin-top:12px">Invite your first client from your dashboard.</div>
      </div>`,
    mount(root, ctx) {
      // The visual default is a real selection: capture it so RT.ob.plan is set for go-live.
      if (!(ctx.ob || {}).plan) ctx.capture({ plan: (PLANS.pro[0] || {}).id });
    },
  },
];

export const obTrainer = defineFlow({ route: 'obt', steps });
