/* ============================================================
   OB2 — PARENT flow (route `obp`, ~15 steps). The emotional
   heart of the onboarding: support and peace of mind, never
   surveillance. The parent sees the EFFORT (score, streak,
   weekly grade via the guardian_* safe-column RPCs) and never
   the details (photos, weight, meals, messages — closed
   server-side, migration 0081).
   Chapters: 0 Discover · 1 See it · 2 Your plan · 3 Commit ·
   4 Start (connect → free confirmation → account LAST; after
   the session a captured invite code is redeemed best-effort).
   ============================================================ */
import { act } from '../state.js';
import { icon } from '../icons.js';
import { esc, sparkline } from '../components.js';
import {
  defineFlow, saveProgressStep, ob, capture, gateCta, choiceGrid, chipRow,
  simChip, mirrorCard, notifCard, phoneCard,
} from '../ob2.js';
import { commitButton, wireCommit } from '../ob-commit.js';
import { track, EVENTS } from '../analytics.js';
import { accountBody, wireAccount } from './ob-account.js';

/* Athlete first name, guarded. Raw for helpers that esc() internally
   (notifCard/phoneCard); esc'd variant for direct HTML interpolation. */
const nm = (o) => ((o && o.athleteName) || '').trim() || 'your athlete';
const nmEsc = (o) => esc(nm(o));

const hero = (eyebrow, title, body, note = '') => `
  <div class="ob2-hero">
    <div class="h-eyebrow">${eyebrow}</div>
    <div class="h-title">${title}</div>
    <div class="h-body">${body}</div>
    ${note ? `<div class="h-note">${note}</div>` : ''}
  </div>`;

/* Simulated week for the summary preview — mirrors the guardian_children
   RPC shape (latest_score / latest_grade) without claiming to be real. */
const DEMO_HIST = [{ score: 74 }, { score: 78 }, { score: 76 }, { score: 83 }, { score: 85 }, { score: 88 }, { score: 90 }];

const WORRY_TEXT = {
  enough: 'eating enough',
  right: 'eating right',
  burnout: 'burnout',
  away: 'the distance',
};
function worryLine(o) {
  const w = (Array.isArray(o.worries) ? o.worries : []).map((k) => WORRY_TEXT[k]).filter(Boolean);
  if (!w.length) return '';
  if (w.length === 1) return w[0];
  if (w.length === 2) return `${w[0]} and ${w[1]}`;
  return `${w.slice(0, -1).join(', ')}, and ${w[w.length - 1]}`;
}

const STYLE_LABEL = {
  quiet: 'Quiet supporter',
  celebrate: 'Celebrate the wins',
  steady: 'Steady check-ins',
};
const STYLE_LINE = {
  quiet: 'You watch the trendline and speak when it matters.',
  celebrate: 'Milestones reach you — you make them count.',
  steady: 'A weekly rhythm, on their terms.',
};

const boundRow = (ok, t, s) => `
  <div class="ob2-bound">
    <div class="bi ${ok ? 'yes' : 'no'}">${icon(ok ? 'check' : 'lock', 16)}</div>
    <div><div class="bt">${t}</div><div class="bs">${s}</div></div>
  </div>`;

const steps = [

  /* ================= ch0 · Discover ================= */
  {
    id: 'why', ch: 0, cta: 'Continue',
    body: () => hero(
      'For parents',
      'You want to support them — <span class="accent">not hover.</span>',
      'They are putting in work you never get to see. The question is how to stand behind it without standing over it.',
    ),
  },
  {
    id: 'gap', ch: 0, cta: 'Continue',
    body: () => hero(
      'The problem',
      'Asking makes you the nag. <span class="accent">Silence makes you worry.</span>',
      'Three words — "did you eat?" — and suddenly you are checking up on them. Say nothing, and you are left guessing. Both of you lose.',
    ),
  },
  {
    id: 'answer', ch: 0, cta: 'Continue',
    body: () => hero(
      'The OnStandard answer',
      'See the effort. <span class="accent">Never the details.</span>',
      'A daily score, a streak, a weekly grade — proof of effort, straight from the work they log. What they log stays theirs.',
      'Their privacy is a hard boundary here, not a setting.',
    ),
  },
  {
    id: 'name', ch: 0, cta: 'Continue',
    title: () => 'First, your name',
    sub: () => 'This is the name on your account.',
    body: (o) => `
      <input id="obp-first" class="ob-input" placeholder="First name" aria-label="First name" autocomplete="given-name" autocapitalize="words" autocorrect="off" spellcheck="false" value="${esc(o.firstName || '')}" />
      <div style="height:12px"></div>
      <input id="obp-last" class="ob-input" placeholder="Last name" aria-label="Last name" autocomplete="family-name" autocapitalize="words" autocorrect="off" spellcheck="false" value="${esc(o.lastName || '')}" />`,
    mount(root) {
      const first = root.querySelector('#obp-first');
      const last = root.querySelector('#obp-last');
      const btn = root.querySelector('#ob2-next');
      if (!first || !last || !btn) return;
      btn.setAttribute('data-gate-extra', '#obp-first[data-ok]');
      const sync = () => {
        const f = first.value.trim(), l = last.value.trim();
        capture({ firstName: f, lastName: l, name: `${f} ${l}`.trim() });
        if (f && l) first.setAttribute('data-ok', ''); else first.removeAttribute('data-ok');
        gateCta(root);
      };
      [first, last].forEach((el) => el.addEventListener('input', sync));
      if (first.value.trim() && last.value.trim()) first.setAttribute('data-ok', '');
    },
  },
  {
    id: 'athlete', ch: 0, cta: 'Continue',
    title: () => 'Who are you supporting?',
    sub: () => 'A first name is all we need.',
    body: (o) => `
      <input id="obp-aname" class="ob-input" placeholder="Their first name" aria-label="Athlete first name" autocapitalize="words" autocorrect="off" spellcheck="false" value="${esc(o.athleteName || '')}" />
      <div class="eyebrow" style="margin:16px 2px 10px">How old are they?</div>
      ${chipRow('athleteAge', [
        { v: '13-15', t: '13–15' },
        { v: '16-18', t: '16–18' },
        { v: '19-22', t: '19–22' },
        { v: '23-plus', t: '23+' },
      ])}`,
    mount(root) {
      const input = root.querySelector('#obp-aname');
      const btn = root.querySelector('#ob2-next');
      if (!input || !btn) return;
      btn.setAttribute('data-gate-extra', '#obp-aname[data-ok]');
      const sync = () => {
        const v = input.value.trim();
        capture({ athleteName: v });
        if (v) input.setAttribute('data-ok', ''); else input.removeAttribute('data-ok');
        gateCta(root);
      };
      input.addEventListener('input', sync);
      if (input.value.trim()) input.setAttribute('data-ok', '');
    },
  },
  {
    id: 'visibility-today', ch: 0, cta: 'Continue',
    title: (o) => `How much of ${nmEsc(o)}'s day do you see now?`,
    body: () => choiceGrid('seesToday', [
      { v: 'nothing', t: 'Almost nothing', s: 'They keep it to themselves', ic: 'eye' },
      { v: 'mentions', t: 'Whatever they mention', s: 'Bits and pieces, on their schedule', ic: 'message' },
      { v: 'awkward', t: 'I ask — it gets awkward', s: 'The questions land like check-ups', ic: 'x' },
    ]),
  },
  {
    id: 'worry', ch: 0, cta: 'Continue',
    title: () => 'What sits in the back of your mind?',
    sub: () => 'Pick what is true. It shapes your weekly summary.',
    body: () => chipRow('worries', [
      { v: 'enough', t: 'Are they eating enough?' },
      { v: 'right', t: 'Are they eating right?' },
      { v: 'burnout', t: 'Are they burning out?' },
      { v: 'away', t: 'They are away at school' },
    ], { multi: true }),
  },

  /* ================= ch1 · See it ================= */
  {
    id: 'aha', ch: 1, cta: 'Continue',
    title: () => 'Support works better when progress is visible — without surveillance.',
    body: (o) => `
      ${mirrorCard('eye', `<b>What you'll see:</b> a daily score, a streak, a weekly grade — the shape of ${nmEsc(o)}'s effort.`)}
      ${mirrorCard('lock', `<b>What stays theirs:</b> photos, meals, weight, messages. Every detail, every time.`)}
      <div class="ob2-gap-verdict">That's enough to answer <b>"are they okay?"</b> — without a single "did you eat?"</div>`,
  },
  {
    id: 'summary', ch: 1, cta: 'Continue',
    title: () => 'One glance, once a week.',
    sub: () => 'The weekly summary — everything you get, nothing you don\'t.',
    body: (o) => `
      ${simChip('Simulated preview')}
      ${phoneCard(`${nm(o)}'s week`, `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div><div class="ls" style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-3)">Daily Score</div>
          <div style="font-size:34px;font-weight:800;letter-spacing:-0.03em;color:var(--blue-bright)">88</div></div>
          <div style="text-align:right;flex:none">${sparkline(DEMO_HIST)}
          <div style="font-size:11px;font-weight:700;color:var(--green-bright);margin-top:2px">Trending up</div></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--hairline-soft);margin-top:12px">
          <div style="width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--green-surface);color:var(--green-bright);flex:none">${icon('flame', 15)}</div>
          <div style="font-size:14px;font-weight:700;flex:1">12-day streak</div>
          <div style="font-size:12px;font-weight:600;color:var(--text-3)">their longest yet</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding-top:11px;border-top:1px solid var(--hairline-soft)">
          <div style="width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--blue-surface);color:var(--blue-bright);flex:none">${icon('check', 15)}</div>
          <div style="font-size:14px;font-weight:700;flex:1">Weekly grade</div>
          <div style="font-size:16px;font-weight:800;color:var(--blue-bright)">A−</div>
        </div>`)}
      <div style="font-size:12.5px;font-weight:600;color:var(--text-3);text-align:center;line-height:1.5;margin-top:12px">No photos. No meals. Just the answer to "are they on track?"</div>`,
  },
  {
    id: 'milestone', ch: 1, cta: 'Continue',
    title: () => 'The good news finds you.',
    sub: () => 'Milestones you\'d hate to miss — worth celebrating, not monitoring.',
    body: (o) => `
      ${simChip('Simulated preview')}
      ${notifCard({ ic: 'flame', tint: 'var(--green-surface)', color: 'var(--green-bright)', title: `${nm(o)} hit a 14-day streak`, body: 'Fourteen straight days of showing up. Worth a text.', time: '6:12 PM' })}
      ${notifCard({ ic: 'check', tint: 'var(--green-surface)', color: 'var(--green-bright)', title: 'Best week yet', body: `${nm(o)} just posted their highest weekly grade so far.`, time: 'Sun' })}
      <div style="font-size:12.5px;font-weight:600;color:var(--text-3);text-align:center;line-height:1.5;margin-top:8px">Nothing here needs a reply. It just gives you a reason to be proud out loud.</div>`,
  },
  {
    id: 'missed', ch: 1, cta: 'Continue',
    title: () => 'Missed-day alerts are a choice you make together.',
    body: (o) => `
      ${simChip('Simulated preview')}
      ${notifCard({ ic: 'bell', tint: 'var(--amber-surface)', color: 'var(--amber-bright)', title: `${nm(o)} missed today's log`, body: 'First miss in 12 days. A good moment for encouragement — not a lecture.', time: '9:04 PM' })}
      <div class="ob2-gap-verdict">These are off until <b>both of you</b> turn them on. ${nmEsc(o)} chooses to share them; you choose to receive them. Support, not surveillance — by design.</div>`,
  },
  {
    id: 'privacy', ch: 1, cta: 'That works for me',
    title: () => 'The boundary, in writing.',
    sub: () => 'Enforced on our servers — not just hidden in the app.',
    body: () => `
      <div class="ob2-phone">
        ${boundRow(true, 'Daily Score', 'Their effort, as one number')}
        ${boundRow(true, 'Streaks', 'Consistency over time')}
        ${boundRow(true, 'Weekly grade', 'The week, summed up')}
        ${boundRow(false, 'Meal photos', 'Stay between them and their coach')}
        ${boundRow(false, 'Meal details', 'What they ate is their business')}
        ${boundRow(false, 'Weight', 'Theirs alone')}
        ${boundRow(false, 'Messages', 'Private to the people in them')}
      </div>
      <div class="ob2-gap-verdict" style="margin-top:12px">Their coach sees the detail. <b>You see the effort.</b></div>`,
  },
  {
    id: 'boundaries', ch: 1, cta: 'Continue',
    title: () => 'How much do you want to hear?',
    sub: () => 'You can change this any time.',
    body: (o) => `
      ${choiceGrid('parentDigest', [
        { v: 'weekly', t: 'Weekly digest', s: 'One summary, Sunday evening', ic: 'mail' },
        { v: 'milestones', t: 'Milestones only', s: 'Streaks and bests, as they happen', ic: 'flame' },
        { v: 'milestones-missed', t: 'Milestones + missed days', s: `Missed-day alerts also need ${nm(o)}'s ok`, ic: 'bell' },
      ])}
      <div style="font-size:12.5px;font-weight:600;color:var(--text-3);text-align:center;line-height:1.5;margin-top:12px">Nothing is silent to them — ${nmEsc(o)} can always see what reaches you.</div>`,
  },

  /* ================= ch2 · Your plan ================= */
  {
    id: 'plan', ch: 2, cta: 'Continue',
    title: () => 'Your side of the standard.',
    sub: () => 'Built from what you told us.',
    body: (o) => {
      const worry = worryLine(o);
      const sees = {
        nothing: `You see <b>almost nothing</b> today — the score gives you a signal without you asking for one.`,
        mentions: `You hear <b>whatever they mention</b> — the trendline fills the gaps in between.`,
        awkward: `You said asking <b>gets awkward</b> — now you never have to ask.`,
      }[o.seesToday];
      const digest = {
        weekly: `<b>Weekly digest</b>: one summary on Sunday evening. That's the whole ask.`,
        milestones: `<b>Milestones only</b>: the wins reach you the moment they happen.`,
        'milestones-missed': `<b>Milestones + missed days</b> — missed-day alerts start only when ${nmEsc(o)} turns them on too.`,
      }[o.parentDigest];
      return `
        ${worry ? mirrorCard('heart', `You said you think about <b>${esc(worry)}</b> — the weekly summary answers that with a trend, not an interrogation.`) : ''}
        ${sees ? mirrorCard('eye', sees) : ''}
        ${digest ? mirrorCard('bell', digest) : ''}
        <div class="ob2-gap-verdict">The deal: <b>${nmEsc(o)} owns the work. You get the trendline.</b></div>`;
    },
  },

  /* ================= ch3 · Commit ================= */
  {
    id: 'commit-q', ch: 3, cta: 'Continue',
    title: () => 'How do you want to show up?',
    sub: () => 'This sets your defaults. Change it whenever life changes.',
    body: () => choiceGrid('parentStyle', [
      { v: 'quiet', t: 'Quiet supporter', s: 'Watch the trend. Speak when it matters.', ic: 'eye' },
      { v: 'celebrate', t: 'Celebrate the wins', s: 'Milestones reach you — you make them count.', ic: 'flame' },
      { v: 'steady', t: 'Steady check-ins', s: 'A weekly rhythm, on their terms.', ic: 'heart' },
    ]),
  },
  {
    id: 'commit', ch: 3, noFoot: true,
    title: () => 'Support the standard.',
    sub: (o) => `${nmEsc(o)} holds the standard. You hold the support.`,
    body: (o) => `
      ${mirrorCard('heart', `<b>${esc(STYLE_LABEL[o.parentStyle] || 'Your way')}.</b> ${esc(STYLE_LINE[o.parentStyle] || 'You see the effort — they keep the details.')}`)}
      ${mirrorCard('lock', `You'll see scores, streaks, and grades. <b>Never</b> photos, weight, meals, or messages.`)}
      <div class="ob-foot" style="margin-top:18px">
        ${commitButton(!!o.committedAt)}
        ${o.committedAt ? `<button class="btn ghost" id="obp-commit-next" style="margin-top:10px">Continue</button>` : ''}
      </div>`,
    mount(root, ctx) {
      wireCommit(root, () => { capture({ committedAt: new Date().toISOString() }); ctx.next(); });
      const again = root.querySelector('#obp-commit-next');
      if (again) again.addEventListener('click', () => ctx.next());
    },
  },

  /* Peak-intent email capture — see saveProgressStep() in ob2.js. */
  saveProgressStep(3),

  /* ================= ch4 · Start (connect → free → account LAST) ================= */
  {
    id: 'connect', ch: 4, cta: 'Continue', skip: true,
    title: () => 'Got an invite code?',
    sub: () => 'It comes from your athlete, not from us.',
    body: (o) => `
      <input id="obp-code" class="ob-input" type="text" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="Invite code" aria-label="Invite code" style="text-transform:uppercase;letter-spacing:0.12em" value="${esc(o.guardianToken || '')}" />
      <div style="height:14px"></div>
      ${mirrorCard('key', `Ask them to open their <b>Profile</b> and tap <b>"Invite a parent"</b> — they get a single-use code to send you. It expires in 14 days.`)}
      <div style="font-size:12.5px;font-weight:600;color:var(--text-3);text-align:center;line-height:1.5;margin-top:10px">No code yet? Skip this — you can connect any time.</div>`,
    mount(root) {
      const input = root.querySelector('#obp-code');
      const btn = root.querySelector('#ob2-next');
      if (!input || !btn) return;
      btn.setAttribute('data-gate-extra', '#obp-code[data-ok]');
      const sync = () => {
        const v = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
        if (input.value !== v) input.value = v;
        capture({ guardianToken: v.length >= 4 ? v : '' });
        if (v.length >= 4) input.setAttribute('data-ok', ''); else input.removeAttribute('data-ok');
        gateCta(root);
      };
      input.addEventListener('input', sync);
      if ((input.value || '').length >= 4) input.setAttribute('data-ok', '');
    },
  },
  {
    id: 'free', ch: 4, cta: 'Continue',
    body: (o) => `
      <div class="ob2-covered">
        <div class="halo"><div class="core">${icon('heart', 36)}</div></div>
        <div class="ob-title" style="margin-top:18px">Your account is free.</div>
        <div class="ob-sub" style="padding:0 8px">Supporting ${nmEsc(o)} costs you nothing — no card, no trial clock, nothing to cancel.</div>
      </div>
      <div style="height:8px"></div>
      ${mirrorCard('shield', `Watching the effort is free for parents, full stop. If that ever changes, you'll hear it from us — never from a charge.`)}`,
    /* The parent's coverage screen IS their paywall variant — track the exposure so the
       six flows share one funnel shape instead of parent silently having none. */
    mount() { track(EVENTS.PAYWALL_VIEWED, { variant: 'free' }); },
  },
  {
    id: 'account', ch: 4, noFoot: true,
    title: () => 'Last step — make it yours.',
    sub: (o) => (o.guardianToken
      ? `The moment your account exists, we'll link you to ${nmEsc(o)}.`
      : `${nmEsc(o)}'s summary lands here as soon as you connect.`),
    body: () => `
      ${accountBody({ terms: 'ob' })}
      <div class="ob-foot" style="margin-top:16px">
        <button id="su-go" class="btn green" disabled>Create my account</button>
      </div>`,
    mount(root) {
      wireAccount(root, {
        role: 'parent',
        onSession: async () => {
          const o = ob();
          if (o.guardianToken) {
            // Best-effort: redeem the invite the athlete minted. Never block or
            // surface a failure here — the parent screen renders its honest
            // "no athletes linked yet" state and offers "Link an athlete".
            try { await act.acceptGuardianInvite(o.guardianToken, 'parent'); } catch { /* honest pending state */ }
          }
          window.__go('parent');
        },
      });
    },
  },
];

export const obParent = defineFlow({ route: 'obp', steps });
