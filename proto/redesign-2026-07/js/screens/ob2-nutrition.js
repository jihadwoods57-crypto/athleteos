/* ============================================================
   OB2 — NUTRITION PROFESSIONAL flow (route `obn`).
   Narrative: 30 clients × 3 meals × 7 days is a reading load no
   professional can carry by hand → AI does the first read on
   every entry → the pro spends expertise on corrections,
   feedback, trends, and flags. Signs up on the trainer rail
   (role 'trainer', persistTrainerOnboarding — practiceName
   carries over); destination `trainer`.
   ============================================================ */
import { RT, act } from '../state.js';
import { icon } from '../icons.js';
import { esc } from '../components.js';
import {
  defineFlow, choiceGrid, chipRow, simChip, mirrorCard, countStat, chatSim,
  phoneCard, testimonial, planCard, PLANS, capture, ob, gateCta,
} from '../ob2.js';
import { SAMPLE_MEAL } from '../ob2-meal.js';
import { accountBody, wireAccount } from './ob-account.js';
import { commitButton, wireCommit } from '../ob-commit.js';
import { showConfirmPending } from '../ob-helpers.js';

/* ---------- discovery bands / labels (single source for math + mirrors) ---------- */
const CLIENT_BANDS = [
  { v: '5-', t: 'Up to 5', mid: 4 },
  { v: '10', t: '5–10', mid: 8 },
  { v: '20', t: '11–20', mid: 15 },
  { v: '30+', t: 'More than 20', mid: 30 },
];
/* wireChoices numifies pure-digit values ('10' → 10), so match by String. */
const bandOf = (o) => CLIENT_BANDS.find((b) => String(b.v) === String((o || {}).clientCount)) || null;

const HOURS_LABEL = { '1-2': '1–2', '3-5': '3–5', '6-10': '6–10', '10+': 'more than 10' };
const SLIP_LABEL = { weekend: 'weekend meals', portions: 'portion drift', quiet: 'clients who go quiet', late: 'late logs' };
const WORKFLOW_LABEL = {
  dms: 'DMs and screenshots', diary: 'an app’s food diary', sheets: 'spreadsheets', paper: 'paper',
};

/* ---------- second bundled fixture (assets/meal-lunch.jpg) — hand-matched to the
   photo: crispy tofu, boiled eggs, edamame, corn, cherry tomatoes, red cabbage,
   cucumber, lettuce. Used for review-queue variety alongside SAMPLE_MEAL. ---------- */
const TOFU_BOWL = {
  photo: 'assets/meal-lunch.jpg',
  name: 'Tofu power bowl',
  quality: 86,
  protein: 28, carbs: 42, fat: 26, kcal: 520, fiber: 9,
  detectedRich: [
    { name: 'Crispy tofu', confidence: 'high', quantity: '~4 oz' },
    { name: 'Boiled eggs', confidence: 'high', quantity: '2' },
    { name: 'Edamame', confidence: 'high', quantity: '~1/2 cup' },
    { name: 'Corn', confidence: 'medium', quantity: '~1/3 cup' },
    { name: 'Cherry tomatoes', confidence: 'high', quantity: '~1/2 cup' },
    { name: 'Red cabbage', confidence: 'medium', quantity: 'shredded' },
    { name: 'Cucumber', confidence: 'high', quantity: 'sliced' },
    { name: 'Lettuce', confidence: 'high', quantity: 'base' },
  ],
};

/* ---------- shared render pieces (local — ob2-meal.js keeps its own private) ---------- */
function foodsList(foods, { removable = false, removed = [] } = {}) {
  const rows = (foods || []).filter((f) => !removed.includes(f.name));
  return `<div class="ob2-foods">${rows.map((f) => `
    <div class="fr" data-food="${esc(f.name)}">
      <div class="fn">${esc(f.name)}</div>
      <div class="fq">${esc(f.quantity || '')}</div>
      <div class="fc ${esc(f.confidence || 'medium')}">${esc(f.confidence || 'medium')}</div>
      ${removable ? `<div class="fx" role="button" aria-label="Remove ${esc(f.name)}" data-remove="${esc(f.name)}">${icon('x', 14)}</div>` : ''}
    </div>`).join('')}</div>`;
}
function macroGrid(r) {
  const cell = (v, k) => `<div class="mc"><div class="mv">${esc(String(v))}</div><div class="mk">${esc(k)}</div></div>`;
  return `<div class="ob2-macros">${cell(r.kcal, 'kcal')}${cell(r.protein + 'g', 'protein')}${cell(r.carbs + 'g', 'carbs')}${cell(r.fat + 'g', 'fat')}</div>`;
}

/* Demo scratch for the interactive correction — module-level like the meal demo's
   DEMO object; a refresh honestly restarts the exercise. */
const CORRECT = { removed: [] };

/* Manual CTA gate for free-input steps: a hidden marker satisfies the engine's
   data-gate-extra selector only while the inputs are valid. */
function gateMark(root, okId, ok) {
  let m = root.querySelector('#' + okId);
  if (ok && !m) { m = document.createElement('i'); m.id = okId; m.hidden = true; root.appendChild(m); }
  if (!ok && m) m.remove();
  gateCta(root);
}

const hero = (eyebrow, title, body, note) => `
  <div class="ob2-hero">
    <div class="h-eyebrow">${eyebrow}</div>
    <div class="h-title">${title}</div>
    <div class="h-body">${body}</div>
    ${note ? `<div class="h-note">${note}</div>` : ''}
  </div>`;

const listRow = (ic, text) => `
  <div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--hairline-soft)">
    <div style="width:32px;height:32px;border-radius:10px;flex:none;display:grid;place-items:center;background:var(--blue-surface);color:var(--blue-bright)">${icon(ic, 16)}</div>
    <div style="font-size:13.5px;font-weight:700;line-height:1.4">${text}</div>
  </div>`;

/* ---------- review-queue row (rides .ob2-board row styling) ---------- */
function queueRow({ name, meal, score, quiet, flagged, thumb }) {
  const av = thumb
    ? `<div style="width:34px;height:34px;border-radius:9px;flex:none;background-image:url('${esc(thumb)}');background-size:cover;background-position:center"></div>`
    : `<div style="width:34px;height:34px;border-radius:9px;flex:none;display:grid;place-items:center;background:var(--surface-3);font-size:12px;font-weight:800;color:var(--text-2)">${esc((name || '?')[0])}</div>`;
  const badge = quiet
    ? `<span class="status-pill muted">${esc(quiet)}</span>`
    : `<div style="flex:none;min-width:34px;text-align:center;font-size:12px;font-weight:800;padding:4px 9px;border-radius:9px;font-variant-numeric:tabular-nums;background:${score >= 80 ? 'var(--green-surface)' : score >= 60 ? 'var(--amber-surface)' : 'var(--red-surface)'};color:${score >= 80 ? 'var(--green-bright)' : score >= 60 ? 'var(--amber-bright)' : 'var(--red)'}">${esc(String(score))}</div>`;
  return `<div class="br">${av}
    <div class="bn">${esc(name)}<div style="font-size:11px;font-weight:600;color:var(--text-3);margin-top:1px">${esc(meal)}</div></div>
    ${badge}${flagged ? `<div style="flex:none;color:var(--amber-bright)">${icon('flame', 15)}</div>` : ''}</div>`;
}

/* ---------- per-client protein-consistency bars (plain divs, no chart lib) ---------- */
function trendRow(name, days, pct) {
  const bars = days.map((h) => `<i style="display:block;width:9px;height:${Math.max(6, Math.round(h * 0.44))}px;border-radius:2.5px;background:${h >= 70 ? 'var(--ring-b)' : h >= 40 ? 'var(--amber-bright)' : 'var(--surface-3)'}"></i>`).join('');
  return `
  <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--hairline-soft)">
    <div style="flex:1;min-width:0;font-size:13.5px;font-weight:700">${esc(name)}</div>
    <div style="display:flex;gap:3px;height:44px;align-items:flex-end" aria-hidden="true">${bars}</div>
    <div style="flex:none;width:42px;text-align:right;font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;color:${pct >= 70 ? 'var(--green-bright)' : 'var(--amber-bright)'}">${esc(String(pct))}%</div>
  </div>`;
}

const REVIEW_MODES = {
  triage: 'AI triage — the AI reviews everything, you work the flags.',
  skim: 'You skim everything — the AI drafts, you approve every line.',
  observe: 'Observe first — watch how the AI reads for a week, then decide.',
};

/* ============================================================ */
const steps = [
  /* ================= ch0 · Discover ================= */
  {
    id: 'why', ch: 0, cta: 'Continue',
    body: () => hero(
      'The math of a nutrition practice',
      `30 clients. <span class="accent">90 meal logs</span> a day.`,
      `Every entry is something a client expects you to have seen. The load grows with every client you take on — and your reading hours grow right along with it.`,
    ),
  },
  {
    id: 'gap', ch: 0, cta: 'Continue',
    body: () => hero(
      'The current way fails quietly',
      `Deep-reading doesn’t scale. Skimming isn’t service.`,
      `Read every entry properly and your evenings disappear into other people’s food diaries. Skim, and the portion drift and quiet weekends slide past you until the results stall. Neither is the practice you set out to build.`,
    ),
  },
  {
    id: 'answer', ch: 0, cta: 'Show me',
    body: () => hero(
      'The OnStandard answer',
      `AI does the first read. <span class="accent">You make the call.</span>`,
      `Every meal is analyzed the moment it’s logged — foods, portions, macros, a quality score. You spend your expertise where it moves outcomes: corrections, feedback, and the clients who actually need you this week.`,
    ),
  },
  {
    id: 'name', ch: 0, cta: 'Next',
    title: () => 'You, the professional.',
    sub: () => 'Clients see this name on every review you sign off.',
    body: (o) => `
      <input id="obn-first" class="ob-input" placeholder="First name" aria-label="First name" autocomplete="given-name" autocapitalize="words" value="${esc(o.firstName || '')}" />
      <div style="height:12px"></div>
      <input id="obn-last" class="ob-input" placeholder="Last name" aria-label="Last name" autocomplete="family-name" autocapitalize="words" value="${esc(o.lastName || '')}" />
      <div style="height:16px"></div>
      <input id="obn-practice" class="ob-input" placeholder="Practice name (e.g. Ferro Nutrition)" aria-label="Practice name" value="${esc(o.practiceName || ((o.trainer || {}).practiceName) || '')}" />
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:8px 2px 0;line-height:1.45">The practice name goes on your client code and everything your clients see from you. You can change it later.</div>`,
    mount(root) {
      const f = root.querySelector('#obn-first'), l = root.querySelector('#obn-last'), p = root.querySelector('#obn-practice');
      const btn = root.querySelector('#ob2-next');
      if (btn) btn.setAttribute('data-gate-extra', '#obn-name-ok');
      const sync = () => {
        const first = f.value.trim(), last = l.value.trim(), practice = p.value.trim();
        capture({
          firstName: first, lastName: last, name: `${first} ${last}`.trim(),
          practiceName: practice,
          trainer: { ...((ob().trainer) || {}), practiceName: practice },
        });
        gateMark(root, 'obn-name-ok', !!(first && last));
      };
      [f, l, p].forEach((el) => el.addEventListener('input', sync));
      sync();
    },
  },
  {
    id: 'clients', ch: 0, cta: 'Next',
    title: () => 'How many clients do you carry?',
    sub: () => 'Everyone whose food you’re expected to have eyes on.',
    body: () => chipRow('clientCount', CLIENT_BANDS.map((b) => ({ v: b.v, t: b.t }))),
  },
  {
    id: 'practice-type', ch: 0, cta: 'Next',
    title: () => 'What kind of practice?',
    sub: () => 'This shapes how your queue and client codes are set up.',
    body: () => choiceGrid('practiceType', [
      { v: 'private', t: 'Private practice', s: 'Your own clients, your own book', ic: 'user' },
      { v: 'team', t: 'Team or org staff', s: 'You cover a roster for a program', ic: 'users' },
      { v: 'gym', t: 'Gym-affiliated', s: 'Clients come through a facility', ic: 'home' },
    ]),
  },
  {
    id: 'workflow', ch: 0, cta: 'Next',
    title: () => 'Where do meal reviews live today?',
    sub: () => 'However it works now — honestly.',
    body: () => choiceGrid('currentWorkflow', [
      { v: 'dms', t: 'DMs + screenshots', s: 'Photos arrive wherever they arrive', ic: 'message' },
      { v: 'diary', t: 'An app’s food diary', s: 'You log in and scroll their entries', ic: 'grid' },
      { v: 'sheets', t: 'Spreadsheets', s: 'Clients fill rows, you read columns', ic: 'bars' },
      { v: 'paper', t: 'Paper', s: 'Journals and printouts at check-ins', ic: 'clipboard' },
    ]),
  },
  {
    id: 'review-hours', ch: 0, cta: 'Next',
    title: () => 'Hours a week spent reviewing food logs?',
    sub: () => 'Reading, judging, and writing back — the whole loop.',
    body: () => chipRow('reviewHours', [
      { v: '1-2', t: '1–2' }, { v: '3-5', t: '3–5' }, { v: '6-10', t: '6–10' }, { v: '10+', t: 'More than 10' },
    ]),
  },
  {
    id: 'slips', ch: 0, cta: 'Next',
    title: () => 'Where do clients slip between check-ins?',
    sub: () => 'Pick everything you keep catching too late.',
    body: () => chipRow('slips', [
      { v: 'weekend', t: 'Weekend meals' }, { v: 'portions', t: 'Portion drift' },
      { v: 'quiet', t: 'Clients who go quiet' }, { v: 'late', t: 'Late logs' },
    ], { multi: true }),
  },

  /* ================= ch1 · See it ================= */
  {
    id: 'aha', ch: 1, cta: 'Show me the queue',
    title: () => 'Your reading load, honestly.',
    body: (o) => {
      const b = bandOf(o);
      const mid = b ? b.mid : 15;
      const entries = mid * 3 * 7;
      const hours = Math.max(1, Math.round((entries * 90) / 3600));
      const who = b ? `~${mid} clients` : 'a typical 15-client practice';
      const hrs = HOURS_LABEL[String((o || {}).reviewHours)] || null;
      return `
      ${countStat(`${entries} entries`,
        `land in your review pile every single week`,
        `${who} × 3 meals × 7 days — at ~90 seconds each that’s ~${hours} hours of reading a week`)}
      <div class="ob2-gap-verdict">${hrs
        ? `You said reviews already take <b>${esc(hrs)} hours a week</b>. The first read is exactly the part that doesn’t need your license — it needs to be done before you sit down.`
        : `The first read is exactly the part that doesn’t need your license — it needs to be done before you sit down.`}</div>`;
    },
  },
  {
    id: 'queue', ch: 1, cta: 'Open one',
    title: () => 'Monday, 8:04 am.',
    sub: () => 'Every entry already read, scored, and sorted — lowest scores and quiet clients float to the top.',
    body: () => `
      ${simChip('Simulated queue — sample clients')}
      ${phoneCard('Review queue · 8 waiting', `<div class="ob2-board">
        ${queueRow({ name: 'Sam T.', meal: 'Dinner · 9:41 pm', score: 52, flagged: true })}
        ${queueRow({ name: 'Chris B.', meal: 'No entries', quiet: 'Quiet 2 days' })}
        ${queueRow({ name: 'Devon K.', meal: 'Dinner · 7:12 pm', score: SAMPLE_MEAL.quality, thumb: SAMPLE_MEAL.photo })}
        ${queueRow({ name: 'Marcus L.', meal: 'Lunch · 1:05 pm', score: 68 })}
        ${queueRow({ name: 'Nia W.', meal: 'Breakfast · 8:20 am', score: 73 })}
        ${queueRow({ name: 'Alicia M.', meal: 'Lunch · 12:33 pm', score: 78 })}
        ${queueRow({ name: 'Jordan P.', meal: 'Dinner · 6:48 pm', score: 81 })}
        ${queueRow({ name: 'Maya R.', meal: 'Lunch · 12:40 pm', score: TOFU_BOWL.quality, thumb: TOFU_BOWL.photo })}
      </div>`)}
      <div class="ob2-scan-note">No scrolling through DMs. The reading is done — the judgment is yours.</div>`,
  },
  {
    id: 'meal-open', ch: 1, cta: 'The read isn’t perfect — fix it',
    title: () => 'Devon’s dinner, pre-analyzed.',
    sub: () => 'Foods, portions, macros, and a quality read — done before you opened it.',
    body: () => `
      ${simChip('Sample analysis — bundled photo, no AI call')}
      <img class="ob2-meal-photo" src="${esc(SAMPLE_MEAL.photo)}" alt="Client meal photo — steak and fries" />
      <div style="height:14px"></div>
      ${phoneCard('Detected foods', foodsList(SAMPLE_MEAL.detectedRich))}
      <div style="height:10px"></div>
      ${phoneCard('Estimated macros', macroGrid(SAMPLE_MEAL) + `
        <div class="ob2-scan-note" style="text-align:left;margin-top:10px">AI quality read: ${esc(String(SAMPLE_MEAL.quality))}/100 — strong protein anchor, no vegetable on the plate. Scored low enough to surface near the top of your queue.</div>`)}`,
  },
  {
    id: 'correct', ch: 1, cta: 'Sign off',
    title: () => 'Correct the read.',
    sub: () => 'Your correction becomes part of the client’s record — the AI’s first read is a draft, your sign-off is the truth.',
    body: () => `
      ${simChip('Sample correction — nothing is saved')}
      ${phoneCard('Detected foods · tap × to remove a wrong line', foodsList(SAMPLE_MEAL.detectedRich, { removable: true, removed: CORRECT.removed }))}
      <div style="height:12px"></div>
      <div class="eyebrow" style="margin:0 2px 10px">Portion check — the fries</div>
      ${chipRow('portionCheck', [
        { v: 'right', t: 'Looks right' }, { v: 'bigger', t: 'Bigger than that' }, { v: 'smaller', t: 'Smaller than that' },
      ], { req: false })}
      <div id="obn-correct-note" class="ob2-scan-note" style="text-align:left">Remove a line the camera got wrong, or judge the portion — the estimate updates before it reaches Devon’s record.</div>`,
    mount(root) {
      const note = root.querySelector('#obn-correct-note');
      root.querySelectorAll('[data-remove]').forEach((x) => x.addEventListener('click', () => {
        const name = x.getAttribute('data-remove');
        if (!CORRECT.removed.includes(name)) CORRECT.removed.push(name);
        const row = x.closest('.fr');
        if (row) row.remove();
        if (note) note.textContent = `Removed ${name} — the macros recompute without it, and the correction is logged under your name.`;
      }));
      const MSG = {
        right: 'Portion confirmed — the macros stand, with your sign-off on the record.',
        bigger: 'Marked bigger — calories and carbs are re-estimated up before they reach Devon’s record.',
        smaller: 'Marked smaller — the estimate comes down before it reaches Devon’s record.',
      };
      root.querySelectorAll('[data-obkey="portionCheck"] [data-val]').forEach((el) => el.addEventListener('click', () => {
        if (note) note.textContent = MSG[el.getAttribute('data-val')] || '';
      }));
    },
  },
  {
    id: 'feedback', ch: 1, cta: 'Send it forward',
    title: () => 'Feedback, in your voice.',
    sub: () => 'The AI drafts from the analysis and your correction. You edit — it sends under your name, not the machine’s.',
    body: (o) => {
      const first = (o.firstName || '').trim();
      const draft = `Good protein anchor with the steak, Devon — keep that exactly as it is. The fries as your only carb are the issue: next dinner, swap half of them for rice or a green vegetable and this plate scores in the 80s.${first ? `\n— ${first}` : ''}`;
      return `
      ${simChip('AI draft — grounded in the analysis you just reviewed')}
      ${phoneCard('Your note to Devon · editable', `
        <textarea id="obn-fb" class="ob-input" rows="7" aria-label="Feedback draft" style="height:auto;min-height:168px;padding:14px;line-height:1.55;resize:none;font-size:14px">${esc(draft)}</textarea>
        <div class="ob2-scan-note" style="text-align:left;margin-top:8px">Edit anything — in the demo nothing sends. In your practice, one tap approves it into the client’s thread.</div>`)}`;
    },
  },
  {
    id: 'trends', ch: 1, cta: 'Next',
    title: () => 'The week, per client.',
    sub: () => 'Protein consistency across seven days — drift is visible before the client feels it.',
    body: () => `
      ${simChip('Simulated week — sample clients')}
      ${phoneCard('Protein consistency · this week', `
        ${trendRow('Maya R.', [88, 92, 95, 90, 86, 94, 91], 92)}
        ${trendRow('Jordan P.', [84, 78, 90, 82, 74, 80, 79], 81)}
        ${trendRow('Chris B.', [72, 66, 58, 61, 44, 0, 0], 58)}
        ${trendRow('Sam T.', [70, 62, 55, 48, 30, 26, 33], 46)}`)}
      <div class="ob2-scan-note">Sam’s slide took four seconds to spot. In a food diary it takes four scrolls per client — if you look at all.</div>`,
  },
  {
    id: 'flag', ch: 1, cta: 'Next',
    title: () => 'Flag it. Move on.',
    sub: () => 'Tap the flag on anything that needs a human follow-up — your Monday starts with the flags, not the firehose.',
    body: () => `
      ${simChip('Simulated — try the flags')}
      ${[
        { n: 'Sam T.', s: 'Protein under target 3 of the last 4 days' },
        { n: 'Chris B.', s: 'No entries since Friday' },
        { n: 'Devon K.', s: 'Dinner portions drifting up week over week' },
      ].map((r, i) => `
      <div class="obn-flag-row" style="display:flex;align-items:center;gap:12px;padding:12px 12px;border-radius:14px;border:1px solid var(--hairline);background:var(--surface-1);margin-bottom:9px">
        <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700">${esc(r.n)}</div>
        <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:2px">${esc(r.s)}</div></div>
        <div role="button" tabindex="0" aria-pressed="false" aria-label="Flag ${esc(r.n)} for follow-up" data-flag="${i}"
          style="width:38px;height:38px;border-radius:11px;flex:none;display:grid;place-items:center;background:var(--surface-2);color:var(--text-3);cursor:pointer">${icon('flame', 16)}</div>
      </div>`).join('')}
      <div id="obn-flag-note" class="ob2-scan-note">Nothing flagged yet — tap a flame.</div>`,
    mount(root) {
      const note = root.querySelector('#obn-flag-note');
      let count = 0;
      root.querySelectorAll('[data-flag]').forEach((btn) => {
        const row = btn.closest('.obn-flag-row');
        const toggle = () => {
          const on = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(on));
          btn.style.background = on ? 'var(--amber-surface)' : 'var(--surface-2)';
          btn.style.color = on ? 'var(--amber-bright)' : 'var(--text-3)';
          if (row) row.style.borderColor = on ? 'var(--amber-border)' : 'var(--hairline)';
          count += on ? 1 : -1;
          if (note) note.textContent = count > 0
            ? `${count} flagged — ${count === 1 ? 'it opens' : 'they open'} first on Monday.`
            : 'Nothing flagged yet — tap a flame.';
        };
        btn.addEventListener('click', toggle);
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      });
    },
  },
  {
    id: 'collab', ch: 1, cta: 'That’s the loop', green: true,
    title: () => 'The whole circle, one thread.',
    sub: () => 'Athletes with a coach already live in a shared thread — your read lands right inside it.',
    body: () => `
      ${simChip('Simulated thread — sample athlete and coach')}
      ${chatSim([
        { who: 'ai', name: 'Maya R. · Athlete', init: 'MR', sim: true, text: 'Lunch logged — tofu bowl before practice.' },
        { who: 'coach', name: 'Coach Daniels', init: 'CD', sim: true, text: 'Big week for her — make sure she’s fueled for Thursday.' },
        { who: 'me', name: 'You', text: 'Bowl is strong — 28g protein, quality 86. I’m adding 20g at breakfast Thursday so she hits the game-day target.' },
      ])}`,
  },

  /* ================= ch2 · Your plan ================= */
  {
    id: 'plan', ch: 2, cta: 'Set my standard',
    title: () => 'Your practice, systematized.',
    sub: () => 'Built from what you told us.',
    body: (o) => {
      const b = bandOf(o);
      const slips = (Array.isArray(o.slips) ? o.slips : []).map((s) => SLIP_LABEL[String(s)]).filter(Boolean);
      const wf = WORKFLOW_LABEL[String((o || {}).currentWorkflow)] || null;
      const hrs = HOURS_LABEL[String((o || {}).reviewHours)] || null;
      const mirrors = [
        b ? mirrorCard('users', `You said you carry <b>${esc(b.t)} clients</b> — so every meal they log is pre-read and scored before it reaches you.`) : '',
        slips.length ? mirrorCard('flame', `You said clients slip on <b>${esc(slips.join(', '))}</b> — so the queue flags exactly those patterns instead of waiting for you to catch them.`) : '',
        wf ? mirrorCard('message', `You said reviews live in <b>${esc(wf)}</b> — so everything lands in one queue with the history attached.`) : '',
        hrs ? mirrorCard('clock', `You said reviews take <b>${esc(hrs)} hours a week</b> — triage puts the flags first and gives the rest back.`) : '',
      ].filter(Boolean).join('');
      return `
      ${mirrors || mirrorCard('flash', `Every meal your clients log gets a first read the moment it lands — you review with judgment, not from scratch.`)}
      <div style="height:6px"></div>
      ${phoneCard('What gets built for you', `
        ${listRow('key', 'One client code — your whole roster joins with it')}
        ${listRow('flash', 'A daily review queue, pre-analyzed and sorted')}
        ${listRow('edit', 'Corrections that become part of each client’s record')}
        ${listRow('flame', 'Flags that build your Monday follow-up list')}`)}`;
    },
  },

  /* ================= ch3 · Commit ================= */
  {
    id: 'commit-q', ch: 3, cta: 'Next',
    title: () => 'How should your review day run?',
    sub: () => 'This sets your queue’s default sort and what the AI handles alone. Change it anytime.',
    body: () => choiceGrid('reviewMode', [
      { v: 'triage', t: 'AI triage', s: 'The AI reviews everything — I work the flags', ic: 'flash' },
      { v: 'skim', t: 'I skim everything', s: 'I see every entry — the AI drafts my replies', ic: 'eye' },
      { v: 'observe', t: 'Observe first', s: 'Watch how the AI reads for a week, then decide', ic: 'clock' },
    ]),
  },
  {
    id: 'commit', ch: 3, noFoot: true,
    title: () => 'Your standard of care.',
    body: (o) => {
      const mode = REVIEW_MODES[String((o || {}).reviewMode)] || 'Every entry gets a first read; nothing reaches a record without your sign-off.';
      const committed = !!o.committedAt;
      return `
      <div class="ob2-gap-verdict" style="margin-top:4px">Every client meal gets a first read within minutes. <b>${esc(mode)}</b> Nothing reaches a client’s record without your sign-off.</div>
      <div class="ob-foot" style="margin-top:auto">
        ${committed
          ? `<button class="btn green" id="obn-commit-next">${icon('check', 18)}&nbsp; Committed — continue</button>`
          : commitButton(false)}
      </div>`;
    },
    mount(root, ctx) {
      const done = root.querySelector('#obn-commit-next');
      if (done) { done.addEventListener('click', () => ctx.next()); return; }
      wireCommit(root, () => {
        capture({ committedAt: new Date().toISOString() });
        ctx.next();
      });
    },
  },

  /* ================= ch4 · Start ================= */
  {
    id: 'proof', ch: 4, cta: 'Continue',
    title: () => 'What it looks like in a practice.',
    body: () => `
      <div class="eyebrow" style="margin:0 2px 12px">Illustrative examples — not actual customers yet</div>
      <!-- LAUNCH PLACEHOLDERS: realistic sample testimonials — the founder swaps these
           for real customer quotes before go-live. Not real people. -->
      ${testimonial({
        quote: 'I went from two full evenings of log reading to about forty minutes on flags. Nobody lost attention — the quiet clients finally got more of it.',
        name: 'Renata', role: 'Sports dietitian · 24 clients', initials: 'R',
        stat: '6 hrs', statKey: 'back / week',
      })}
      ${testimonial({
        quote: 'The corrections are the difference. My clients’ records read like I reviewed every meal — because I did, just not from scratch.',
        name: 'Marcus', role: 'Nutrition coach', initials: 'M',
        stat: '31', statKey: 'clients',
      })}`,
  },
  {
    id: 'plans', ch: 4, cta: 'Start free — no card today',
    title: () => 'Pick your seat.',
    sub: () => 'Nothing charges today — billing turns on at launch, and you can change plans anytime.',
    body: (o) => {
      const sel = o.plan || 'pro_solo';
      return `
      <div class="ob2-plans" data-obkey="plan">
        ${PLANS.seat.map((p) => planCard({ ...p, on: p.id === sel })).join('')}
      </div>
      <div class="ob2-scan-note">Both seats include the review queue, corrections, trends, and flags from day one.</div>`;
    },
    mount() {
      if (!ob().plan) capture({ plan: 'pro_solo' });
    },
  },
  {
    id: 'account', ch: 4, noFoot: true,
    title: () => 'Create your account.',
    sub: () => 'Your practice, client code, and review queue live on it — ready for its first client.',
    body: () => `
      ${accountBody({ terms: 'tob' })}
      <div class="ob-foot" style="margin-top:18px"><button id="su-go" class="btn primary" disabled>Create account &amp; Start reviewing</button></div>`,
    mount(root) {
      wireAccount(root, {
        role: 'trainer',
        onSession: async (live) => {
          if (live) { await act.persistTrainerOnboarding(); window.__go('trainer'); return; }
          showConfirmPending(root, { email: RT.email });
        },
      });
    },
  },
];

export const obNutrition = defineFlow({ route: 'obn', steps });
