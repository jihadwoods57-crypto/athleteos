import { S, RT, act, roleNav, roleProfileRoute, liveWeightPct } from '../state.js';
import { icon } from '../icons.js';
import { mapPressure } from '../exec.js';
import { normalizePrefs } from '../notify-plan.js';
import { normalizeCoachPrefs } from '../coach-notify-plan.js';
import { backHead, esc, errorState, planStyleCard } from '../components.js';
import { STYLE_KEYS, styleLabel } from '../plan-style.js';
import * as roles from '../roles.js';
import { planById } from '../pricing.js';
import { armReplay } from '../tour.js';

/* Reminder-pressure chips: restore the athlete's REAL saved pressure and persist taps into
   RT.ob.standard.pressure (the same field onboarding writes, which drives the exec engine's
   notification plan), then resync native reminders. Per-chip listeners — wireToggles'
   chip handler stopPropagation()s, so a row-level delegate would never fire. */
function wirePressure(root, sel) {
  const row = root.querySelector(sel);
  if (!row) return;
  const saved = (RT.ob && RT.ob.standard && RT.ob.standard.pressure) || 'Hold me accountable';
  const chips = [...row.querySelectorAll('.chp')];
  const match = chips.find((c) => mapPressure(c.textContent.trim()) === mapPressure(saved));
  if (match) { chips.forEach((c) => c.classList.remove('on')); match.classList.add('on'); }
  chips.forEach((c) => c.addEventListener('click', () => {
    act.captureOb({ standard: { ...((RT.ob || {}).standard || {}), pressure: c.textContent.trim() } });
    act.syncNotifications();
  }));
}

/* Context-aware AI replies: keyword-routed, plan-grounded. Any specifics come from REAL state
   (live score) — never a fabricated "122g of 190g" / "that's 94". */
export function smartReply(text, fallback) {
  const t = text.toLowerCase();
  if (/(swap|instead|replace|substitute)/.test(t)) return 'Yes, swap it. Based on your plan: any protein for protein, any slow carb for slow carb, keep the portion the same. Rice, potatoes, oats, and tortillas are all interchangeable for you.';
  if (/(late|miss|forgot|skip)/.test(t)) return 'Honest answer: a late meal counts at half weight for punctuality, and a missed one just stays missed. Log it anyway. The trend matters more than one slot, and your coach respects a truthful log over a blank.';
  if (/(protein|macro)/.test(t)) return 'Aim protein-forward at every meal: a solid protein source plus a slow carb hits your plan. If a meal slot is still open, that’s where to close any gap.';
  if (/(eat out|restaurant|chipotle|fast food|on the go)/.test(t)) return 'From your plan’s approved list: Chipotle bowl (double chicken, rice, beans), a grilled sandwich, or a rice bowl. Order protein first, add the carb, skip nothing green.';
  // Never hardcode the split: the weights move with the athlete's plan style x goal profile,
  // and the assistant quoting a different mix — or a different NUMBER OF CATEGORIES — than the
  // Score Breakdown screen is exactly the contradiction this app can least afford. Score v2
  // dropped Daily Commitment's weight to 0 (it's still asked, just never scored) and folded the
  // weekly check-in into the Recovery card, so this is two parts now, not four.
  if (/(score|point|tier)/.test(t)) return `Your score comes from two honest parts: Nutrition ${liveWeightPct('nutrition')}%, and Recovery ${liveWeightPct('checkin') + liveWeightPct('recovery')}% (tonight's check-in plus how you answered it). Right now you’re at ${S.score}; finishing what’s still open tonight takes you toward ${S.possible}.`;
  return fallback;
}

/* Working composer. Honesty rule: only the AI may auto-reply (AI really is instant).
   Humans never get a fabricated reply — 'delivery' mode shows an honest status line. */
export function wireComposer(root, replyWho = 'ai', replyName = 'OnStandard AI', replyText = '', onSend = null) {
  const input = root.querySelector('.composer input');
  const send = root.querySelector('.composer .send');
  const thread = root.querySelector('.thread');
  if (!input || !send || !thread) return;
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    thread.insertAdjacentHTML('beforeend',
      `<div class="msg athlete"><div><div class="bubble">${esc(text)}</div></div></div>`);
    input.value = '';
    if (onSend) onSend(text);
    setTimeout(() => {
      if (replyWho === 'delivery') {
        thread.insertAdjacentHTML('beforeend', `<div class="msg-status">${replyText}</div>`);
      } else {
        const av = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>`;
        thread.insertAdjacentHTML('beforeend',
          `<div class="msg ai"><div class="av">${av}</div><div><div class="who">${replyName}</div><div class="bubble">${smartReply(text, replyText)}</div></div></div>`);
      }
      thread.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 650);
    thread.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

/* ---------- Messages: athlete <-> coach thread ----------
   HONEST: there is no direct-message backend yet — the real coach<->athlete channel today is
   the per-meal comment thread. This screen says exactly that (no fake composer that claims
   "Delivered" into the void), and shows an honest connect state when no coach is linked. */
export const messages = {
  tab: 'plan',
  render() {
    const c = S.coach;
    if (!c.hasCoach) {
      return `
      ${backHead('Your Coach', 'No coach connected yet', 'plan')}
      <div class="state-demo">
        <div class="sd-ic">${icon('users', 24)}</div>
        <div class="sd-t">No coach connected</div>
        <div class="sd-s">When you join a team, your coach shows up here, and sees your day.</div>
        <div class="sd-cta"><button class="btn ghost sm" data-go="connect">Connect a coach</button></div>
      </div>
      <div style="height:10px"></div>
      `;
    }
    const sub = [c.role, c.team].filter(Boolean).join(' · ') || 'Your coach';
    return `
    ${backHead(c.name, sub, 'profile')}

    <div class="thread">
      <div class="msg-status">${esc(c.name)} talks to you on your meals: every comment and reaction lands in that meal's thread, and you reply right there.</div>
    </div>
    <div style="height:14px"></div>
    <button class="btn ghost" data-go="history">Open activity history</button>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Units & appearance (spec §22): focused — units, time, appearance. ----------
   Unsupported unit options are HIDDEN, never shown as "· soon" (spec §22.2). Reminder
   controls live ONLY in Notification Settings (spec §22.4). */
export const settings = {
  tab: 'profile',
  get nav() { return roleNav(); },
  render() {
    return `
    ${backHead('Units & appearance', '', roleProfileRoute())}

    <div class="eyebrow">Units</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('scale', 17)}</div>
        <div class="lm"><div class="lt">Weight</div></div>
        ${/* A read-only fact, not live status: the blue pill is the styling of actionable
              state and invited dead taps. Muted is the documented provenance treatment. */''}
        <span class="status-pill muted">lb</span>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('clock', 17)}</div>
        <div class="lm"><div class="lt">Time</div></div>
        <span class="status-pill muted">12-hour</span>
      </div>
    </section>

    <div class="eyebrow">Appearance</div>
    <div class="chip-row" id="set-theme" data-toggle-group>
      ${['dark', 'light', 'system'].map((m) => `<span class="chp ${(RT.theme || 'dark') === m ? 'on' : ''}" data-theme-pick="${m}">${m === 'dark' ? 'Dark' : m === 'light' ? 'Light' : 'System'}</span>`).join('')}
    </div>

    ${/* The plan-style picker's only stable browsable home. Before this row existed the screen
          it back-navigates to could not reach it: owners found it through the Plan tab's Change
          button, locked athletes had no path at all (settings.js:1030's honesty contract was
          unreachable). Athletes only — an operator's plan style is per-athlete, on the roster. */''}
    ${RT.authRole === 'athlete' ? `
    <div class="eyebrow">Plan</div>
    <section class="card rows">
      <div class="lrow" data-go="plan-style">
        <div class="lic">${icon('target', 17)}</div>
        <div class="lm"><div class="lt">Plan style</div><div class="ls">${esc(S.planStyle.name)} · ${S.planStyle.canChoose ? 'yours to change' : esc(S.planStyle.sourceLabel)}</div></div>
        ${icon('chevron', 17, 'class="chev-dim"')}
      </div>
    </section>` : ''}

    <div id="set-bio-wrap" style="display:none">
      <div class="eyebrow">Security</div>
      <section class="card" style="padding:6px 16px">
        <div class="lrow" id="set-bio">
          <div class="lic">${icon('lock', 17)}</div>
          <div class="lm"><div class="lt">Unlock with Face ID</div><div class="ls">Required on app open</div></div>
          <div class="seg" style="width:104px" id="set-bio-seg"><button>On</button><button class="on">Off</button></div>
        </div>
      </section>
    </div>

    <div class="eyebrow">Help</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" id="set-tour" role="button" tabindex="0" style="cursor:pointer">
        <div class="lic">${icon('sparkle', 17)}</div>
        <div class="lm"><div class="lt">Replay app tour</div><div class="ls">A quick walk through the app</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>

    <div style="height:18px"></div>
    <button class="btn ghost" data-back="${roleProfileRoute()}">Done</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    wireToggles(root);
    wireSegAria(root);
    // Its own listener, not a delegate: wireToggles' chip handler stopPropagation()s, and a
    // row-level delegate here would never fire (see the note at the top of this file).
    const tourRow = root.querySelector('#set-tour');
    if (tourRow) {
      const replay = () => armReplay();
      tourRow.addEventListener('click', replay);
      tourRow.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); replay(); } });
    }
    // Appearance: applies instantly (data-theme on the root), persists in RT.theme.
    root.querySelectorAll('[data-theme-pick]').forEach((el) => el.addEventListener('click', () => {
      act.setTheme(el.getAttribute('data-theme-pick'));
      root.querySelectorAll('[data-theme-pick]').forEach((x) => x.classList.toggle('on', x === el));
    }));
    (async () => {
      const N = window.OnStandardNative;
      if (!N || !N.biometrics) return;
      let ok = false;
      try { ok = await N.biometrics.available(); } catch { /* hidden */ }
      if (!ok) return;
      const wrap = root.querySelector('#set-bio-wrap');
      wrap.style.display = '';
      const row = root.querySelector('#set-bio');
      const seg = row.querySelector('#set-bio-seg');
      const [onBtn, offBtn] = seg.querySelectorAll('button');
      const paint = (on) => { onBtn.classList.toggle('on', on); offBtn.classList.toggle('on', !on); };
      try { paint((await N.secureStore.getItem('onstd-biolock')) === '1'); } catch { /* default Off */ }
      onBtn.addEventListener('click', () => { N.secureStore.setItem('onstd-biolock', '1'); paint(true); });
      offBtn.addEventListener('click', () => { N.secureStore.removeItem('onstd-biolock'); paint(false); });
    })();
  },
};

/* Terms/Privacy detours land here from any onboarding flow; OB_BACK sends "Done" back to the
   right in-progress step (by role) instead of always dropping the athlete on Profile. */
const OB_BACK = { ob: 'onboarding/7', cob: 'coach-ob/5', tob: 'trainer-ob/3', clob: 'client-ob/6' };

/* ---------- Privacy & visibility (spec §20): real connections only, plain language ----------
   Rows render ONLY for people who actually exist (connected coach/trainer, a real guardian
   relationship). Each expands into a plain-language access breakdown. "Download my data" is
   a REAL export (act.exportMyData — the athlete's own rows, RLS-scoped, as a JSON file). */
export const privacy = {
  tab: 'profile',
  hideTabs: true,
  render({ sub } = {}) {
    const back = OB_BACK[sub] || roleProfileRoute();
    const rows = [];
    if (S.coach.hasCoach && S.coach.kind === 'coach') {
      rows.push({
        ic: 'users', t: S.coach.isNamed ? S.coach.name : 'Your coach', pill: 'View access',
        s: 'Daily score, requirements, meal logs and photos, check-ins, weight trend',
        detail: [
          ['Can see', 'Your daily score, requirement completion, meal logs and photos, check-ins, and weight trend.'],
          ['Can set', 'Your requirements, deadlines, targets, and reminder urgency.'],
          ['Required by team', 'Sharing execution with your coach is what connecting means.'],
          ['To revoke', 'Leave the team: ask your coach to remove you, or contact support@onstandard.app.'],
        ],
      });
    }
    if (RT.myTrainer) {
      rows.push({
        ic: 'bolt', t: (RT.myTrainer.name || 'Your trainer'), pill: 'Limited access',
        s: 'Recovery, readiness, and nutrition consistency, not your full meal detail',
        detail: [
          ['Can see', 'Recovery check-ins, readiness, and nutrition consistency.'],
          ['Cannot see', 'Your full meal photos and per-meal detail stay with you and your coach.'],
          ['To revoke', 'Leave the practice: ask your trainer, or contact support@onstandard.app.'],
        ],
      });
    }
    if (S.consent.minor || (RT.consent && RT.consent.guardianEmail)) {
      rows.push({
        ic: 'heart', t: 'Parent / guardian', pill: 'Limited access',
        s: RT.consent && RT.consent.guardianEmail ? `${RT.consent.guardianEmail} · consent + account controls` : 'Consent status and account controls, not your day-to-day logs',
        detail: [
          ['Can do', 'Approve your account, request your data, or request deletion: legal guardian rights for minors.'],
          ['Cannot see', 'Your meal photos and daily logs are not mirrored to a guardian view.'],
        ],
      });
    }
    if (S.coach.hasCoach && S.coach.kind === 'coach') {
      /* The Squad board shipped (0180) — this row now tells the truth about it, per the standing
         note that shipped with the old copy ("change this row IN THE SAME commit"). Default is
         still nothing: the board shows an athlete only after they flip their own switch, which
         lives ON the Squad screen where the effect is visible. */
      const sharing = RT.shareSquadScore === true;
      rows.push({
        ic: 'grid', t: 'Teammates', pill: sharing ? 'Score only' : 'No access',
        s: sharing ? 'Teammates see your score number on the Squad board, nothing else'
          : 'Teammates cannot see anything about your day',
        detail: [
          ['Can see', sharing
            ? 'Your name and daily score number on your team’s Squad board. That is the whole disclosure.'
            : 'Nothing. The Squad board shows teammates who opted in; you haven’t, so you appear only as a private count.'],
          ['Cannot see', 'Your meals, photos, weight, and check-ins are never visible to teammates, shared or not.'],
          ['Change it', 'The switch lives on the Squad screen (Progress → Squad), next to what it shows.'],
        ],
      });
    }
    return `
    ${backHead('Privacy & visibility', 'Who sees what: nothing is public', back)}

    ${rows.length ? `
    <section class="card" style="padding:6px 16px">
      ${rows.map((r, i) => `
        <details class="pv-row">
          <summary class="lrow">
            <div class="lic">${icon(r.ic, 17)}</div>
            <div class="lm"><div class="lt">${esc(r.t)}</div><div class="ls">${esc(r.s)}</div></div>
            <span class="status-pill ${r.pill === 'View access' ? 'g' : 'b'}">${r.pill}</span>
          </summary>
          <div class="pv-detail">
            ${r.detail.map(([k, v]) => `<div class="pv-line"><b>${esc(k)}</b>${esc(v)}</div>`).join('')}
          </div>
        </details>`).join('')}
    </section>` : `
    <section class="card pad">
      <div style="font-size:15px;font-weight:800">No one is connected</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:4px;line-height:1.5">Right now your data is visible to you alone. Connecting a coach or trainer shares your execution with them; you'll see exactly what before you join.</div>
    </section>`}

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Defaults that protect you</div>
      <div class="ts">Nothing is public. Meal photos never leave your coach connection. You can download or delete everything, below.</div></div>
    </div>

    <div class="eyebrow">Your data</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" id="pv-export" role="button" tabindex="0">
        <div class="lic">${icon('download', 17)}</div>
        <div class="lm"><div class="lt">Download my data</div><div class="ls">Profile, days, and meal records as a JSON file</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="delete-account">
        <div class="lic" style="color:var(--red)">${icon('trash', 17)}</div>
        <div class="lm"><div class="lt" style="color:var(--red)">Delete my account</div><div class="ls">Permanent, in-app</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>
    <div id="pv-export-note" style="font-size:12px;font-weight:600;color:var(--text-3);min-height:16px;margin-top:8px;padding:0 2px"></div>

    <div style="height:14px"></div>
    <button class="btn ghost" data-back="${back}">Done</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const btn = root.querySelector('#pv-export');
    const note = root.querySelector('#pv-export-note');
    if (!btn) return;
    let busy = false;
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); } });
    btn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      if (note) { note.style.color = ''; note.textContent = 'Preparing your export…'; }
      const r = await act.exportMyData();
      if (note) {
        note.style.color = r.ok ? 'var(--green-bright)' : 'var(--red-bright)';
        note.textContent = r.ok ? 'Export downloaded.' : (r.error || 'Export failed.');
      }
      busy = false;
    });
  },
};

/* ---------- Plan & billing ----------
   Consumer membership status + management. Subscriptions are store-managed (App Store / Play
   IAP), so we never render a cancel button we can't honor — we deep-link to the store's own
   subscription manager (Apple's rule) and offer Restore. Free accounts get an honest upsell to
   the paywall. CACHE/load pattern mirrors monthly-report: fetch the row, then repaint. */
const BILL = { sub: null, loaded: false, source: 'none', active: null, failed: false };
async function loadBilling() {
  const sub = await roles.fetchMySubscription();
  // { error:true } = the read FAILED. "Free" printed off a dropped request is an entitlement
  // lie to a paying user — render the unknown state instead of a fabricated plan.
  BILL.failed = !!(sub && sub.error);
  BILL.sub = BILL.failed ? null : sub;
  // Operators see their real usage ("34 active this month · 50 included") — the number 0163
  // finally made true. Best-effort; the screen renders without it.
  BILL.active = (BILL.sub && BILL.sub.tier === 'team') ? await roles.myActiveAthleteCount() : null;
  // Premium can be paid for by someone else — a sponsor (0132) or the trainer whose package you
  // bought (0166) — and both live in their own tables, not on the subscription row. That is why
  // this screen used to say "Free" to someone who had premium. Ask the server WHICH source, not
  // just whether: calling it all "sponsored" would be a lie to every trainer-funded client.
  try {
    if (BILL.failed) { BILL.source = 'none'; }
    else if (isPaid(BILL.sub)) { BILL.source = 'subscription'; }
    else {
      const src = await roles.myPremiumSource();
      // null = the source read FAILED — without it "Free" could still be printed over a
      // trainer-funded or sponsored membership.
      if (src === null) { BILL.failed = true; BILL.source = 'none'; }
      else { BILL.source = src; }
    }
  } catch { BILL.source = 'none'; }
  BILL.loaded = true;
  if (window.__render) window.__render();
}
/** Premium that someone else is paying for. */
function coveredBy() {
  return BILL.source === 'trainer' || BILL.source === 'sponsor' ? BILL.source : null;
}
/* MUST match has_premium_access (0163) and isPro (src/core/subscription.ts): paid tier, and
   either active or past_due within GRACE_DAYS of the recorded failure. Exported so the parity
   test can run the same cases through all the client copies. */
export const GRACE_DAYS = 7;
export function isPaid(sub, now = Date.now()) {
  if (!sub) return false;
  const t = String(sub.tier || '').toLowerCase();
  const freeTier = t === '' || t === 'preview' || t === 'free' || t === 'none' || t === 'trial_expired';
  if (freeTier) return false;
  if (sub.status === 'active') return true;
  if (sub.status !== 'past_due') return false;
  const failedAt = sub.payment_failed_at ? Date.parse(sub.payment_failed_at) : NaN;
  if (!Number.isFinite(failedAt)) return true;  // no timestamp → honor the grace (matches SQL fallback intent)
  return now - failedAt < GRACE_DAYS * 86400000;
}
function planLabel(sub) {
  if (!isPaid(sub)) {
    const by = coveredBy();
    if (by === 'trainer') return 'Premium · via your trainer';
    if (by === 'sponsor') return 'Premium · sponsored';
    return 'Free';
  }
  const p = sub.plan_id ? planById(sub.plan_id) : null;
  if (p) return p.name;
  return sub.tier === 'team' ? 'Team' : 'Premium';
}
function renewLine(sub) {
  if (!isPaid(sub)) {
    const by = coveredBy();
    // Say plainly that there is nothing to pay. A trainer-funded client who thinks they owe a
    // second subscription is exactly the confusion this whole model exists to remove.
    if (by === 'trainer') return 'Included with your coaching. Nothing to pay here: your membership lasts as long as your plan with your trainer.';
    if (by === 'sponsor') return 'A sponsor covers your premium access. Nothing to pay while it lasts.';
    return 'You have the free plan. Your stats are always yours; membership adds the written coaching.';
  }
  const when = sub.current_period_end ? (() => { try { return new Date(sub.current_period_end).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return ''; } })() : '';
  if (sub.status === 'past_due') return `Payment issue: update your payment method in the store to keep premium${when ? ` (grace ends ${when})` : ''}.`;
  if (sub.cancel_at_period_end) return when ? `Cancels ${when}. You keep premium until then.` : 'Set to cancel at period end.';
  return when ? `Renews ${when}.` : 'Active.';
}
function storeSubUrl() {
  return /android/i.test(navigator.userAgent || '')
    ? 'https://play.google.com/store/account/subscriptions'
    : 'https://apps.apple.com/account/subscriptions';
}

export const billing = {
  tab: 'profile',
  get nav() { return roleNav(); },
  render() {
    const back = roleProfileRoute();
    if (!BILL.loaded) {
      return `${backHead('Plan & billing', 'Your membership', back)}
      <div class="sidebox"><div class="req-icon b" style="width:38px;height:38px">${icon('bolt', 17)}</div><div><div class="tt">Loading your plan…</div></div></div>`;
    }
    if (BILL.failed) {
      return `${backHead('Plan & billing', 'Your membership', back)}
      ${errorState({
        title: "Couldn't check your plan",
        body: 'Nothing changed with your membership; this screen just could not reach the server. Reconnect and try again.',
        retryId: 'bill-retry',
      })}`;
    }
    const sub = BILL.sub;
    const paid = isPaid(sub);
    /* Premium someone ELSE is paying for is still premium. The card already reads "Premium · via
       your trainer" off my_premium_source, but every other branch on this screen keyed off `paid`
       alone — so a trainer-funded client was told they had Premium and then shown "See membership
       plans" and "Have a code?", with no Premium pill. That is the exact double-billing confusion
       the whole trainer-funded model exists to remove, printed on the billing screen.

       It is deliberately NOT folded into isPaid(): that function mirrors the SUBSCRIPTION predicate
       and is pinned to isPro()/has_premium_access by entitlementParity.test.ts. The extra sources
       are a LABEL here, not a fourth arm of the predicate. */
    const covered = coveredBy();
    const premium = paid || !!covered;
    // Operators (coach/trainer) buy on the STRIPE rail: their upsell is the plan-upgrade screen
    // and their manage is the Stripe billing portal — App Store copy on a coach's screen was a
    // consumer-shaped leftover. Athletes/parents keep the IAP surfaces unchanged.
    const operator = RT.authRole === 'coach' || RT.authRole === 'trainer';
    const teamPlan = paid && sub && sub.tier === 'team';
    const usage = teamPlan && BILL.active != null && sub.seats
      ? `<div style="height:8px"></div><div style="font-size:12px;font-weight:700;color:var(--text-2)">${BILL.active} active athlete${BILL.active === 1 ? '' : 's'} this month · ${sub.seats} included${BILL.active > sub.seats ? ` · ${BILL.active - sub.seats} over at $10/mo` : ''}</div>`
      : '';
    return `${backHead('Plan & billing', 'Your membership', back)}

    <section class="card pad">
      <div class="bigstat"><span class="n" style="font-size:26px">${esc(planLabel(sub))}</span><span class="d">${premium ? 'Your plan' : 'Current plan'}</span></div>
      <div style="height:6px"></div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.45">${esc(renewLine(sub))}</div>
      ${usage}
      ${premium ? `<div style="height:8px"></div><span class="status-pill g">Premium unlocked</span>` : ''}
    </section>

    <div style="height:12px"></div>
    ${/* Someone whose premium is funded by a trainer or a sponsor has nothing to manage and nothing
          to buy — there is no subscription of theirs to change and no second one to sell them. Say
          where it comes from and stop. */ ''}
    ${!paid && covered ? `
    <section class="card pad">
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.5;text-align:center">
        ${covered === 'trainer'
          ? 'Nothing to set up here. If you stop your package with your trainer, this is where a plan of your own would go.'
          : 'Nothing to set up here. When the sponsorship ends, this is where a plan of your own would go.'}
      </div>
    </section>` : paid ? `
    <section class="card" style="padding:6px 16px">
      <div class="lrow" id="bill-manage" role="button" tabindex="0">
        <div class="lic">${icon('creditCard', 18)}</div>
        <div class="lm"><div class="lt">Manage subscription</div><div class="ls">${teamPlan ? 'Change plan, card, or cancel in the Stripe portal' : `Change plan or cancel in the ${/android/i.test(navigator.userAgent || '') ? 'Play Store' : 'App Store'}`}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      ${teamPlan ? '' : `<div class="lrow" id="bill-restore" role="button" tabindex="0">
        <div class="lic">${icon('rotate', 17)}</div>
        <div class="lm"><div class="lt">Restore purchases</div><div class="ls">Moved devices? Restore your membership</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>`}
    </section>` : operator ? `
    <section class="card pad">
      <button class="btn green" id="bill-upsell-pro" style="width:100%">See plans · free 14-day trial</button>
      <div style="height:10px"></div>
      <div style="font-size:12px;font-weight:600;color:var(--text-3);line-height:1.5;text-align:center">Every plan counts <b>active</b> athletes only; idle seats are free.</div>
    </section>` : `
    <section class="card pad">
      <button class="btn green" id="bill-upsell" style="width:100%">See membership plans</button>
      <div style="height:10px"></div>
      <div class="lrow" data-go="redeem-code" style="cursor:pointer"><div class="lic">${icon('key', 17)}</div><div class="lm"><div class="lt">Have a code?</div><div class="ls">From your trainer or a sponsor: redeem it to unlock premium</div></div>${icon('chevron', 17)}</div>
      <div class="lrow" id="bill-restore" role="button" tabindex="0" style="cursor:pointer"><div class="lic">${icon('rotate', 17)}</div><div class="lm"><div class="lt">Restore purchases</div><div class="ls">Already a member on another device?</div></div>${icon('chevron', 17)}</div>
    </section>`}

    <div id="bill-msg" style="text-align:center;font-size:12px;font-weight:600;color:var(--text-3);min-height:16px;margin-top:12px"></div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    if (!BILL.loaded) loadBilling();
    // The id-wired rows sit outside the router's data-go keyboard stamp (router.js wires
    // Enter/Space onto data-go/act/back only), so they carry their own activation.
    ['#bill-manage', '#bill-restore'].forEach((sel) => {
      const el = root.querySelector(sel);
      if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    });
    const billRetry = root.querySelector('#bill-retry');
    if (billRetry) billRetry.addEventListener('click', () => { BILL.loaded = false; BILL.failed = false; window.__render(); loadBilling(); });
    const msg = root.querySelector('#bill-msg');
    const manage = root.querySelector('#bill-manage');
    if (manage) manage.addEventListener('click', async () => {
      // A Stripe-rail plan manages in the Stripe portal; IAP manages in the store. Same row.
      if (BILL.sub && BILL.sub.tier === 'team') {
        if (msg) msg.textContent = 'Opening your billing portal…';
        const p = await roles.openBillingPortal();
        if (p.ok) { if (window.OnStandardNative?.openUrl) window.OnStandardNative.openUrl(p.url); else location.href = p.url; if (msg) msg.textContent = ''; }
        else if (msg) msg.textContent = p.error;
        return;
      }
      roles.openExternal(storeSubUrl());
    });
    const upsell = root.querySelector('#bill-upsell');
    if (upsell) upsell.addEventListener('click', () => { if (window.__go) window.__go('paywall'); else location.hash = '#paywall'; });
    const upsellPro = root.querySelector('#bill-upsell-pro');
    if (upsellPro) upsellPro.addEventListener('click', () => { if (window.__go) window.__go('plan-upgrade'); else location.hash = '#plan-upgrade'; });
    const restore = root.querySelector('#bill-restore');
    if (restore) restore.addEventListener('click', async () => {
      if (msg) msg.textContent = 'Restoring…';
      const res = await roles.restoreConsumerPurchases(RT.userId);
      if (res && res.ok) { if (msg) { msg.style.color = 'var(--green-bright)'; msg.textContent = 'Membership restored.'; } BILL.loaded = false; loadBilling(); }
      else if (msg) { msg.style.color = 'var(--text-3)'; msg.textContent = res && res.reason === 'unavailable' ? 'Purchases restore once memberships are live.' : 'Nothing to restore on this account.'; }
    });
  },
};

/* ---------- Notification settings (athlete-side quiet hours; coach sets urgency) ----------
   All of it is LIVE now: master switch, quiet-hours start, and the deadline override persist
   to RT.notifPrefs (act.setNotifPrefs) and resync the device schedule on every change. */
export const notifSettings = {
  tab: 'profile',
  get nav() { return roleNav(); },
  render() {
    // Fallback only — data-back pops the real origin (Profile or Notifications).
    const back = roleProfileRoute();
    const p = normalizePrefs(RT.notifPrefs);
    const qf = Math.round(p.quietFrom / 60); // 21 | 22 | 23
    return `
    ${backHead('Notifications', 'Your tone. Your quiet hours. Coach sets urgency.', back)}

    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Accountability notifications</div><div class="ls">${p.enabled ? 'On: reminders track what’s actually still open' : 'Paused'}</div></div>
        <div class="seg" style="width:104px" id="ns-enabled"><button class="${p.enabled ? 'on' : ''}">On</button><button class="${p.enabled ? '' : 'on'}">Off</button></div>
      </div>
      <div class="lrow" id="ns-haptics" style="cursor:default">
        <div class="lic">${icon('vibrate', 17)}</div>
        <div class="lm"><div class="lt">Haptics</div><div class="ls">A light tick on taps and logs</div></div>
        <div class="seg" style="width:104px" id="ns-haptics-seg"><button class="${RT.haptics !== false ? 'on' : ''}">On</button><button class="${RT.haptics === false ? 'on' : ''}">Off</button></div>
      </div>
    </section>

    <div class="eyebrow">Your tone · changes the wording, never the schedule</div>
    <div class="chip-row" id="ns-pressure" data-toggle-group>
      <span class="chp">Supportive</span><span class="chp on">Direct</span><span class="chp">Intense</span>
    </div>

    <div class="eyebrow">Quiet hours</div>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin:-4px 2px 8px;line-height:1.4">Nothing pings between your cutoff and 7 AM. Deadline warnings can break through if you let them.</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('moon', 17)}</div>
        <div class="lm"><div class="lt">No pings after</div></div>
        <div class="seg" style="width:150px" id="ns-quiet"><button class="${qf === 21 ? 'on' : ''}">9 PM</button><button class="${qf === 22 ? 'on' : ''}">10 PM</button><button class="${qf === 23 ? 'on' : ''}">11 PM</button></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Deadline warnings</div><div class="ls">The only ones that break quiet hours</div></div>
        <div class="seg" style="width:104px" id="ns-deadline"><button class="${p.allowDeadline ? 'on' : ''}">On</button><button class="${p.allowDeadline ? '' : 'on'}">Off</button></div>
      </div>
    </section>

    ${(() => {
      // The REAL urgency levels, read from the same requirement objects the reminder planner
      // escalates on (req.reminder via S.exec) — this card used to be a hardcoded three-row
      // fiction that misreported any athlete on a custom standard. Meal slots group into one
      // row (a 5-meal standard is one fact, not five rows) carrying their highest level.
      const reqs = (S.exec.items || []).filter((i) => i && i.required && i.tracked && !i.assigned);
      const meals = reqs.filter((i) => i.proof === 'photo');
      const rest = reqs.filter((i) => i.proof !== 'photo');
      const lvOf = (r) => (r.reminder === 'high' ? 'High' : 'Medium');
      const rows = [];
      if (meals.length) rows.push(['utensils', 'Meals', meals.some((m) => m.reminder === 'high') ? 'High' : 'Medium']);
      for (const r of rest) rows.push([r.icon || 'clipboard', r.title, lvOf(r)]);
      if (!rows.length) return '';
      return `
    <div class="eyebrow">Urgency per requirement${S.coach.hasCoach ? ` · set by ${esc(S.coach.nameMid)}` : ' · from your plan'}</div>
    <section class="card" style="padding:6px 16px">
      ${rows.map(([ic, t, lv]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${esc(t)}</div></div>
          <span class="status-pill ${lv === 'High' ? 'a' : 'b'}" style="display:inline-flex;align-items:center;gap:5px">${icon('lock', 11)} ${lv}</span>
        </div>`).join('')}
    </section>`;
    })()}
    <div class="set-note">${icon('lock', 11)} Urgency drives escalation and deadline warnings, and belongs to ${S.coach.hasCoach ? 'your coach' : 'your plan'}; your tone above only changes how reminders are worded. Completed requirements never remind you; finishing one cancels its reminders immediately.</div>
    ${typeof window !== 'undefined' && !window.OnStandardNative ? `
    <div class="set-note">${icon('info', 11)} Reminders are delivered by the phone app. In a browser these settings save, but nothing is scheduled on this device.</div>` : ''}
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    wireToggles(root);
    wireSegAria(root);
    wirePressure(root, '#ns-pressure');
    // Haptics: a REAL device preference — router's buzz() honors it on every tap. Paint the
    // buttons too: this seg saved the pref but never repainted, so tapping Off left On lit and
    // the control read as broken (critique 2026-08-15).
    const hseg = root.querySelector('#ns-haptics-seg');
    if (hseg) {
      const [onB, offB] = hseg.querySelectorAll('button');
      const paint = (on) => { onB.classList.toggle('on', on); offB.classList.toggle('on', !on); };
      onB.addEventListener('click', () => { act.setHaptics(true); paint(true); });
      offB.addEventListener('click', () => { act.setHaptics(false); paint(false); });
    }
    // Segmented controls persist straight into RT.notifPrefs and resync the device schedule.
    const seg = (sel, value, after) => {
      const row = root.querySelector(sel);
      if (!row) return;
      const btns = [...row.querySelectorAll('button')];
      btns.forEach((b) => b.addEventListener('click', () => {
        btns.forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        act.setNotifPrefs(value(b.textContent.trim()));
        if (after) after(b.textContent.trim());
      }));
    };
    // The master row's subtitle states the mode; it has to move with the toggle or the row
    // contradicts itself ("On: reminders track…" under a lit Off).
    seg('#ns-enabled', (t) => ({ enabled: t === 'On' }), (t) => {
      const ls = root.querySelector('#ns-enabled')?.closest('.lrow')?.querySelector('.ls');
      if (ls) ls.textContent = t === 'On' ? 'On: reminders track what’s actually still open' : 'Paused';
    });
    seg('#ns-deadline', (t) => ({ allowDeadline: t === 'On' }));
    seg('#ns-quiet', (t) => ({ quietFrom: (t === '9 PM' ? 21 : t === '11 PM' ? 23 : 22) * 60 }));
  },
};

/* ---------- Coach notification settings (Slice E) ----------
   Coach-side sibling of notifSettings above: edits RT.coachNotifPrefs (act.setCoachNotifPrefs)
   which drives the LOCAL planner in js/coach-notify-plan.js — there is no live server schedule
   yet, so the header sub-copy says exactly that (the honesty marker from the Slice E brief).
   Every control writes straight through act.setCoachNotifPrefs (merge + save + resync + the
   opt-out mirror) — this screen never touches RT.coachNotifPrefs directly. */
/* Quick-setup bundles (Slice E). Module-scoped so render() can light the chip the current prefs
   already match — a picker where no chip is ever lit reads as broken, and after a preset tap the
   __render() repaint needs the same logic to show what stuck. */
const COACH_PRESETS = {
  Essential: { enabled: true, briefing: false, recap: false, hourly: false, immediateCritical: true, quietFrom: 21 * 60 },
  Balanced: { enabled: true, briefing: true, briefingAt: 7 * 60 + 30, recap: true, recapAt: 20 * 60 + 30, hourly: true, immediateCritical: true, quietFrom: 22 * 60 },
  'Hands-on': { enabled: true, briefing: true, briefingAt: 7 * 60, recap: true, recapAt: 20 * 60, hourly: true, immediateCritical: true, quietFrom: 23 * 60 },
};
function presetFor(p) {
  const hit = Object.entries(COACH_PRESETS).find(([, b]) => Object.entries(b).every(([k, v]) => p[k] === v));
  return hit ? hit[0] : null;
}

export const coachNotifSettings = {
  // `operator`, not `coach`. trainerProfile links this screen too (screens/roles.js), but a
  // hardcoded nav:'coach' made navAdmits() refuse a trainer, so the router bounced them to their
  // Home tab and Practice HQ → Notifications was a dead tap — the trainer could never open their
  // notification preferences from anywhere in the UI. Same defect, same fix as deleteAccount
  // below and coach-insights: `operator` admits both roles AND lights the right tab bar, since
  // the coach and trainer NAVS share tab ids by design.
  nav: 'operator', tab: 'profile',
  render() {
    const p = normalizeCoachPrefs(RT.coachNotifPrefs);
    const qf = Math.round(p.quietFrom / 60); // 21 | 22 | 23
    const qt = Math.round((p.quietTo != null ? p.quietTo : 7 * 60) / 60); // resume hour
    const preset = presetFor(p);
    return `
    ${backHead('Notifications', 'When and how you get alerts about your team.', roleProfileRoute())}

    <div class="eyebrow">Quick setup</div>
    <div class="chip-row" id="cns-preset" data-toggle-group>
      ${Object.keys(COACH_PRESETS).map((k) => `<span class="chp ${preset === k ? 'on' : ''}">${k}</span>`).join('')}
    </div>
    <div style="font-size:11.5px;font-weight:600;color:var(--text-3);margin:0 2px 6px">Pick a starting point, then fine-tune below.</div>

    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Coach notifications</div><div class="ls">${p.enabled ? 'On' : 'Paused'}</div></div>
        <div class="seg" style="width:104px" id="cns-enabled"><button class="${p.enabled ? 'on' : ''}">On</button><button class="${p.enabled ? '' : 'on'}">Off</button></div>
      </div>
    </section>

    <div class="eyebrow">Morning briefing</div>
    <div class="chip-row" id="cns-briefing" data-toggle-group>
      <span class="chp ${!p.briefing ? 'on' : ''}">Off</span>
      <span class="chp ${p.briefing && p.briefingAt === 7 * 60 ? 'on' : ''}">7:00</span>
      <span class="chp ${p.briefing && p.briefingAt === 7 * 60 + 30 ? 'on' : ''}">7:30</span>
      <span class="chp ${p.briefing && p.briefingAt === 8 * 60 ? 'on' : ''}">8:00</span>
    </div>

    <div class="eyebrow">Evening recap</div>
    <div class="chip-row" id="cns-recap" data-toggle-group>
      <span class="chp ${!p.recap ? 'on' : ''}">Off</span>
      <span class="chp ${p.recap && p.recapAt === 20 * 60 ? 'on' : ''}">8:00 PM</span>
      <span class="chp ${p.recap && p.recapAt === 20 * 60 + 30 ? 'on' : ''}">8:30 PM</span>
      <span class="chp ${p.recap && p.recapAt === 21 * 60 ? 'on' : ''}">9:00 PM</span>
    </div>
    ${/* Breathing room the other chip rows get from a following eyebrow: without it the card
          below sits flush against the chips, and when this row wraps to two lines at 390px the
          "9:00 PM" chip visibly collides with the Overdue digest card. */''}
    <div style="height:12px"></div>

    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('clock', 17)}</div>
        <div class="lm"><div class="lt">Overdue digest</div><div class="ls">Only while something is overdue</div></div>
        <div class="seg" style="width:104px" id="cns-hourly"><button class="${p.hourly ? 'on' : ''}">On</button><button class="${p.hourly ? '' : 'on'}">Off</button></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('bolt', 17)}</div>
        <div class="lm"><div class="lt">Immediate critical</div><div class="ls">One ping when a new group goes overdue</div></div>
        <div class="seg" style="width:104px" id="cns-critical"><button class="${p.immediateCritical ? 'on' : ''}">On</button><button class="${p.immediateCritical ? '' : 'on'}">Off</button></div>
      </div>
    </section>

    <div class="eyebrow">Quiet hours</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('moon', 17)}</div>
        <div class="lm"><div class="lt">No pings after</div></div>
        <div class="seg" style="width:150px" id="cns-quiet"><button class="${qf === 21 ? 'on' : ''}">9 PM</button><button class="${qf === 22 ? 'on' : ''}">10 PM</button><button class="${qf === 23 ? 'on' : ''}">11 PM</button></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Back on at</div></div>
        <div class="seg" style="width:150px" id="cns-quietto"><button class="${qt === 6 ? 'on' : ''}">6 AM</button><button class="${qt === 7 ? 'on' : ''}">7 AM</button><button class="${qt === 8 ? 'on' : ''}">8 AM</button></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('users', 17)}</div>
        <div class="lm"><div class="lt">My room only</div><div class="ls">Follow my scope instead of the whole team</div></div>
        <div class="seg" style="width:104px" id="cns-myroom"><button class="${p.myRoomOnly ? 'on' : ''}">On</button><button class="${p.myRoomOnly ? '' : 'on'}">Off</button></div>
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    // Radiogroup semantics + Tab/Enter reach for the three chip rows, aria-pressed for the
    // segs. wireToggles attaches FIRST so the per-chip persistence handlers below read fresh
    // .on state (the attach-order rule the other screens document).
    wireToggles(root);
    wireSegAria(root);
    // Plain On/Off segments: each writes one field straight through act.setCoachNotifPrefs —
    // AND paints the buttons. These saved without repainting, so tapping Off left On lit and
    // every seg on this screen read as broken (critique 2026-08-15; the athlete-side seg()
    // always painted).
    const seg2 = (sel, patch, after) => {
      const row = root.querySelector(sel);
      if (!row) return;
      const [onBtn, offBtn] = row.querySelectorAll('button');
      const pick = (on) => {
        onBtn.classList.toggle('on', on);
        offBtn.classList.toggle('on', !on);
        act.setCoachNotifPrefs(patch(on));
        if (after) after(on);
      };
      onBtn.addEventListener('click', () => pick(true));
      offBtn.addEventListener('click', () => pick(false));
    };
    seg2('#cns-enabled', (on) => ({ enabled: on }), (on) => {
      // The master row's subtitle states the mode; it moves with the toggle or contradicts it.
      const ls = root.querySelector('#cns-enabled')?.closest('.lrow')?.querySelector('.ls');
      if (ls) ls.textContent = on ? 'On' : 'Paused';
    });
    seg2('#cns-hourly', (on) => ({ hourly: on }));
    seg2('#cns-critical', (on) => ({ immediateCritical: on }));
    seg2('#cns-myroom', (on) => ({ myRoomOnly: on }));

    // Quiet-hours start: mirrors the athlete notifSettings quiet chips (9/10/11 PM), quietTo
    // stays the framework default (no UI here, matching the athlete side).
    const quiet = root.querySelector('#cns-quiet');
    if (quiet) {
      const btns = [...quiet.querySelectorAll('button')];
      const atHour = { '9 PM': 21 * 60, '10 PM': 22 * 60, '11 PM': 23 * 60 };
      btns.forEach((b) => b.addEventListener('click', () => {
        btns.forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        act.setCoachNotifPrefs({ quietFrom: atHour[b.textContent.trim()] });
      }));
    }

    // Quiet-hours resume time (quietTo) — both a start AND a resume, per the correction.
    const quietTo = root.querySelector('#cns-quietto');
    if (quietTo) {
      const btns = [...quietTo.querySelectorAll('button')];
      const atHour = { '6 AM': 6 * 60, '7 AM': 7 * 60, '8 AM': 8 * 60 };
      btns.forEach((b) => b.addEventListener('click', () => {
        btns.forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        act.setCoachNotifPrefs({ quietTo: atHour[b.textContent.trim()] });
      }));
    }

    // Quick-setup presets: apply a bundle of prefs, then repaint so every control reflects it
    // (render() lights the matching chip via presetFor, so the tap visibly sticks).
    const presetRow = root.querySelector('#cns-preset');
    if (presetRow) {
      presetRow.querySelectorAll('.chp').forEach((c) => c.addEventListener('click', () => {
        const b = COACH_PRESETS[c.textContent.trim()];
        if (b) { act.setCoachNotifPrefs(b); window.__render(); }
      }));
    }

    // Off/time chip rows: "Off" clears the flag; a time sets the flag true + its *At minute.
    const chipTime = (sel, flag, atMap) => {
      const row = root.querySelector(sel);
      if (!row) return;
      const chips = [...row.querySelectorAll('.chp')];
      chips.forEach((c) => c.addEventListener('click', () => {
        chips.forEach((x) => x.classList.remove('on'));
        c.classList.add('on');
        const t = c.textContent.trim();
        if (t === 'Off') act.setCoachNotifPrefs({ [flag]: false });
        else act.setCoachNotifPrefs({ [flag]: true, [`${flag}At`]: atMap[t] });
      }));
    };
    chipTime('#cns-briefing', 'briefing', { '7:00': 7 * 60, '7:30': 7 * 60 + 30, '8:00': 8 * 60 });
    chipTime('#cns-recap', 'recap', { '8:00 PM': 20 * 60, '8:30 PM': 20 * 60 + 30, '9:00 PM': 21 * 60 });
  },
};

/* ---------- Delete account (Apple requires in-app deletion) ---------- */
export const deleteAccount = {
  // Without this a coach or trainer could not delete their account AT ALL. The screen is linked
  // from privacy and terms (both reachable by every role), but its nav defaulted to 'athlete',
  // so the mirror guard (router.js:204) bounced any operator straight back to #coach/#trainer.
  // Same fix already used by settings, billing and notif-settings above.
  get nav() { return roleNav(); },
  hideTabs: true,
  render() {
    /* The consequences differ by role, and this is the one screen where wrong-persona copy is
       unforgivable. Each line states what the delete_account cascade actually does (0007/0079):
       athlete-owned rows go, team-owned artifacts survive with attribution nulled, a trainer's
       practice cascades away (and trainer_funded_access with it), guardian links go with the
       parent. Never promise more or less than the RPC delivers. */
    const WHAT = {
      coach: "Your account, your sign-in, and everything only you own. Your team's standards, templates, and history stay with the team, with your name removed from them. Your athletes keep their own logs and scores. This cannot be undone.",
      trainer: 'Your account, your practice, and its client code. Your clients keep their own logs and scores, but they lose their connection to you, and any premium access funded through your packages ends immediately. This cannot be undone.',
      parent: 'Your account, your sign-in, and your links to your athletes. Your athletes keep their accounts and everything in them; they just lose your view. Any plan you fund is billed separately and does not cancel itself: cancel it under Funded plans first. This cannot be undone.',
    };
    const what = WHAT[RT.authRole] || "Your account, every meal photo, every log, every score, your coach connection, and your spot on your team's Squad board. Your coach keeps nothing of yours. This cannot be undone.";
    return `
    ${backHead('Delete Account', 'Permanent. We mean it.', roleProfileRoute())}

    <div class="state-demo err-box" style="text-align:left">
      <div class="sd-t">What gets deleted</div>
      <div class="sd-s">${what}</div>
    </div>
    <div id="del-sub-note"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Want your data first?</div>
      <div class="ts">Download everything before you delete: <span class="link" data-go="privacy" role="button" tabindex="0" style="font-weight:700">open Privacy &amp; visibility</span>. Deletion completes within 30 days everywhere, immediately in the app.</div></div>
    </div>
    <div style="height:18px"></div>
    <button id="del-acct" class="btn" style="background:var(--danger-solid);color:#fff;box-shadow:0 10px 30px rgba(var(--red-rgb),0.3)">${icon('trash', 18)} Delete my account</button>
    <div id="del-status" style="text-align:center;font-size:13px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:10px"></div>
    <button class="btn ghost" data-go="${roleProfileRoute()}">Keep my account</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const btn = root.querySelector('#del-acct');
    const status = root.querySelector('#del-status');
    if (!btn) return;
    /* Money before erasure: deleting an account cancels NO subscription (IAP bills through the
       store, team plans through Stripe), so a paying user who deletes keeps getting charged.
       Warn when we KNOW a plan is live; if the read fails, state the generic truth instead of
       staying silent. Parents are covered by the funded-plans line in the copy above. */
    const subNote = root.querySelector('#del-sub-note');
    if (subNote && RT.authRole !== 'parent') {
      (async () => {
        const sub = await roles.fetchMySubscription();
        const failed = !!(sub && sub.error);
        if (!failed && !isPaid(sub)) return;
        const team = !failed && sub.tier === 'team';
        const store = /android/i.test(navigator.userAgent || '') ? 'Play Store' : 'App Store';
        const manageLabel = team ? 'Open the billing portal' : `Manage it in the ${store}`;
        subNote.innerHTML = `
        <div class="sidebox">
          <div class="req-icon a" style="width:38px;height:38px">${icon('creditCard', 17)}</div>
          <div><div class="tt">${failed ? 'Paying for a membership?' : team ? 'Your Team plan keeps billing' : 'Your membership keeps billing'}</div>
          <div class="ts">Deleting your account does not cancel it. <span class="link" id="del-sub-manage" role="button" tabindex="0" style="font-weight:700">${manageLabel}</span> first.</div></div>
        </div>`;
        const manage = subNote.querySelector('#del-sub-manage');
        const go = async () => {
          if (team) {
            const p = await roles.openBillingPortal();
            if (p.ok) { if (window.OnStandardNative?.openUrl) window.OnStandardNative.openUrl(p.url); else location.href = p.url; }
            else if (status) { status.textContent = p.error || 'Could not open the billing portal.'; }
            return;
          }
          roles.openExternal(storeSubUrl());
        };
        manage.addEventListener('click', go);
        manage.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      })();
    }
    const orig = btn.innerHTML; // 'Delete my account' with its icon: what a failed attempt resets to
    let armed = false;
    btn.addEventListener('click', async () => {
      if (!armed) { armed = true; btn.innerHTML = 'Tap again to permanently delete'; return; } // two-tap confirm
      btn.disabled = true; btn.textContent = 'Deleting…';
      const serverOk = await window.__act.deleteAccount(); // real delete_account RPC + sign-out + local wipe
      // Never claim the account is gone if the SERVER delete failed — that would tell the user
      // their data is erased while it's intact server-side. Local session is always signed out.
      if (serverOk === false) {
        if (status) { status.style.color = 'var(--red-bright)'; status.textContent = "Couldn't reach the server. You're signed out, but your account may still exist. Try again online."; }
        btn.disabled = false; btn.innerHTML = orig; armed = false;
        return;
      }
      if (status) status.textContent = 'Account deleted.';
      location.hash = '#welcome';
    });
  },
};

/* ---------- Terms & legal (spec §23): separate links to the REAL documents ----------
   onstandard.app/terms and /privacy are live pages; in-app actions (export, deletion) link
   to their real screens. The plain-language summary stays — it must always match the docs. */
export const terms = {
  hideTabs: true,
  render({ sub } = {}) {
    const back = OB_BACK[sub] || roleProfileRoute();
    const ext = (href, ic, t, s) => `
      <a class="lrow" href="${href}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <div class="lic">${icon(ic, 16)}</div>
        <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>
        ${icon('external', 15, 'style="color:var(--text-3)"')}
      </a>`;
    return `
    ${backHead('Terms & Privacy', 'The documents, and what they mean', back)}
    <section class="card" style="padding:6px 16px">
      ${ext('https://onstandard.app/terms', 'clipboard', 'Terms of Service', 'The full agreement')}
      ${ext('https://onstandard.app/privacy', 'lock', 'Privacy Policy', 'What we collect and why')}
      <div class="lrow" data-go="privacy"><div class="lic">${icon('download', 16)}</div><div class="lm"><div class="lt">Data export</div><div class="ls">Download everything you own, in-app</div></div>${icon('chevron', 16)}</div>
      <div class="lrow" data-go="verified-discipline"><div class="lic">${icon('shield', 16)}</div><div class="lm"><div class="lt">Verified Discipline profile</div><div class="ls">See exactly what a recruiter would, off until you say so</div></div>${icon('chevron', 16)}</div>
      <div class="lrow" data-go="delete-account"><div class="lic" style="color:var(--red)">${icon('trash', 16)}</div><div class="lm"><div class="lt">Account deletion</div><div class="ls">Permanent, in-app</div></div>${icon('chevron', 16)}</div>
      <div class="lrow" data-go="feedback"><div class="lic">${icon('message', 16)}</div><div class="lm"><div class="lt">Send feedback</div><div class="ls">Report a bug, ask something, or tell us an idea</div></div>${icon('chevron', 16)}</div>
      ${/* The email stays. Someone locked out of their account cannot file an in-app ticket, and
            that is exactly when they most need to reach a human. */ ''}
      ${ext('mailto:support@onstandard.app', 'clipboard', 'Email us instead', 'support@onstandard.app')}
    </section>
    <div class="eyebrow">The short version</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['Your photos are yours', 'Meal photos are private to your account and your coach connection. They are not public and not sold.'],
        ['Health & AI disclaimer', 'OnStandard gives execution feedback, not medical or dietary advice. AI meal reads are estimates; verify anything health-critical yourself.'],
        ['Children & guardians', 'Under 13 requires a parent or guardian. A guardian of a minor can request access to or deletion of the minor’s data at any time.'],
        ['No ad tracking', 'No ad trackers or third-party ad identifiers in the app.'],
        ['Delete anytime', 'Full in-app account deletion. Export first if you want your history.'],
      ].map(([t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon('check', 16)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls" style="white-space:normal;line-height:1.4">${s}</div></div>
        </div>`).join('')}
    </section>
    <div style="height:10px"></div>
    `;
  },
};

/* shared: single-select toggle groups */
export function wireToggles(root) {
  root.querySelectorAll('[data-toggle-group]').forEach(g => {
    const items = g.querySelectorAll('button, .chp, .c5, .choice');
    // Single-select group = a radiogroup. Expose the selection to screen readers (it was
    // conveyed by color/glow alone) so VoiceOver announces "selected".
    if (!g.hasAttribute('role')) g.setAttribute('role', 'radiogroup');
    const syncAria = () => items.forEach(x => {
      if (!x.hasAttribute('role')) x.setAttribute('role', 'radio');
      x.setAttribute('aria-checked', x.classList.contains('on') ? 'true' : 'false');
    });
    items.forEach(el => {
      // Chips are <span>s: without a tabindex the whole radiogroup is invisible to Tab and
      // the "radio" role points at something keyboard users can never reach. Buttons keep
      // their native focus; Enter/Space routes through click so every per-chip listener the
      // screens attach (persistence, repaint) fires exactly as it does for touch.
      if (el.tagName !== 'BUTTON' && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        g.querySelectorAll('.on').forEach(x => x.classList.remove('on'));
        el.classList.add('on');
        syncAria();
      });
    });
    syncAria();
  });
}

/* Segmented On/Off controls are two real <button>s, so they focus natively — but their state
   was conveyed by the .on class alone. Mirror it into aria-pressed, initially and after any
   seg tap (delegated: the individual paint sites are many and this survives all of them). */
export function wireSegAria(root) {
  const sync = () => root.querySelectorAll('.seg button').forEach((b) =>
    b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false'));
  root.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.seg')) requestAnimationFrame(sync);
  });
  sync();
}

/* ---------- Plan style picker (0142) ----------
   Where an athlete who OWNS their setting changes it, and where an athlete who doesn't sees
   exactly who does — plus the preference they stated, marked as shared rather than discarded.

   Honesty rules this screen carries:
     * a locked athlete still gets to change their PREFERENCE. It reaches their coach's roster.
       Silently storing an answer nobody ever sees is the thing this is built to avoid.
     * the copy never implies a style is better. Structured is not "serious mode"; Intuitive is
       not "easy mode". They measure different things.
     * changing style is disclosed as forward-only — past days keep the score they earned. */
export const planStylePicker = {
  tab: 'profile',
  hideTabs: true,
  render() {
    const PS = S.planStyle;
    const choosing = PS.canChoose;
    const current = PS.key;
    // When someone else owns the setting, the chips pick a PREFERENCE, not the plan itself.
    const selected = choosing ? current : (PS.preference || current);
    return `
    ${backHead('Plan style', choosing ? 'How much structure helps you succeed' : esc(PS.sourceLabel), 'settings')}

    ${planStyleCard(PS, { compact: true })}

    <div class="eyebrow">${choosing ? 'Choose your style' : 'Tell your ' + esc(S.coach.noun) + ' what you prefer'}</div>
    ${!choosing ? `<div class="ps-note lead">Your ${esc(S.coach.noun)} sets the plan you're scored on. What you pick here is shared with them; it doesn't change your scoring on its own.</div>` : ''}

    <section class="card" style="padding:6px 16px" id="ps-options">
      ${STYLE_KEYS.map((k) => {
        const L = styleLabel(k);
        const on = selected === k;
        return `
        <div class="lrow" data-ps-pick="${k}" role="radio" tabindex="0" aria-checked="${on ? 'true' : 'false'}">
          <div class="lic">${icon(k === 'structured' ? 'clipboard' : k === 'guided' ? 'target' : 'heart', 17)}</div>
          <div class="lm"><div class="lt">${esc(L.name)}${on ? ` <span class="status-pill ${choosing ? 'g' : 'muted'}" style="margin-left:6px">${choosing ? 'Selected' : 'Preferred'}</span>` : ''}</div>
          <div class="ls">${esc(L.how)}</div></div>
        </div>`;
      }).join('')}
    </section>
    <div id="ps-save-status" role="status" class="ps-note err"></div>

    <div class="ps-note" style="margin-top:4px">
      Changing your style applies from today forward. Days you've already scored keep the score you earned; they were measured by the plan you were on then.
    </div>

    <div style="height:16px"></div>
    <button class="btn ghost" data-back="settings">Done</button>
    <div style="height:10px"></div>`;
  },
  mount(root) {
    root.querySelectorAll('[data-ps-pick]').forEach((el) => el.addEventListener('click', async () => {
      // Optimistic paint first (the local change is already applied and saved), then the server's
      // verdict. On a rejection act.setPlanStyle has reverted and re-rendered; the message is
      // written into the FRESH screen's status line so the revert doesn't read as a silent no-op.
      const p = act.setPlanStyle(el.getAttribute('data-ps-pick'));
      window.__render && window.__render();
      const ok = await p;
      if (!ok) {
        const status = document.getElementById('ps-save-status');
        if (status) status.textContent = "That change didn't save. Check your connection and try again.";
      }
    }));
  },
};
