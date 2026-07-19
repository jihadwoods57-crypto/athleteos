import { S, RT, act, roleNav, roleProfileRoute } from '../state.js';
import { icon } from '../icons.js';
import { mapPressure } from '../exec.js';
import { normalizePrefs } from '../notify-plan.js';
import { normalizeCoachPrefs } from '../coach-notify-plan.js';
import { backHead, esc } from '../components.js';

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
   (hydration, live score) — never a fabricated "122g of 190g" / "88 oz" / "that's 94". */
export function smartReply(text, fallback) {
  const t = text.toLowerCase();
  if (/(swap|instead|replace|substitute)/.test(t)) return 'Yes, swap it. Based on your plan: any protein for protein, any slow carb for slow carb, keep the portion the same. Rice, potatoes, oats, and tortillas are all interchangeable for you.';
  if (/(water|hydrat|drink)/.test(t)) return `You’re at ${RT.hydrationOz} oz today — top it up before bed. It doesn’t move today’s score, but it shows in your trend.`;
  if (/(late|miss|forgot|skip)/.test(t)) return 'Honest answer: a late meal counts at half weight for punctuality, and a missed one just stays missed. Log it anyway — the trend matters more than one slot, and your coach respects a truthful log over a blank.';
  if (/(protein|macro)/.test(t)) return 'Aim protein-forward at every meal — a solid protein source plus a slow carb hits your plan. If a meal slot is still open, that’s where to close any gap.';
  if (/(eat out|restaurant|chipotle|fast food|on the go)/.test(t)) return 'From your plan’s approved list: Chipotle bowl (double chicken, rice, beans), a grilled sandwich, or a rice bowl. Order protein first, add the carb, skip nothing green.';
  if (/(score|point|tier)/.test(t)) return `Your score is four honest parts: Nutrition 50%, Recovery 25%, Commitment 15%, Weekly check-in 10%. Right now you’re at ${S.score}; finishing what’s still open tonight takes you toward ${S.possible}.`;
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
        <div class="sd-s">When you join a team, your coach shows up here — and sees your day.</div>
        <div class="sd-cta"><button class="btn ghost sm" data-go="connect">Connect a coach</button></div>
      </div>
      <div style="height:10px"></div>
      `;
    }
    const sub = [c.role, c.team].filter(Boolean).join(' · ') || 'Your coach';
    return `
    ${backHead(c.name, sub, 'profile')}

    <div class="thread">
      <div class="msg-status">${esc(c.name)} talks to you on your meals — every comment and reaction lands in that meal's thread, and you reply right there.</div>
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
        <span class="status-pill b">lb</span>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('droplet', 17)}</div>
        <div class="lm"><div class="lt">Fluids</div></div>
        <span class="status-pill b">oz</span>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('clock', 17)}</div>
        <div class="lm"><div class="lt">Time</div></div>
        <span class="status-pill b">12-hour</span>
      </div>
    </section>

    <div class="eyebrow">Appearance</div>
    <div class="chip-row" id="set-theme">
      ${['dark', 'light', 'system'].map((m) => `<span class="chp ${(RT.theme || 'dark') === m ? 'on' : ''}" data-theme-pick="${m}">${m === 'dark' ? 'Dark' : m === 'light' ? 'Light' : 'System'}</span>`).join('')}
    </div>

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

    <div style="height:18px"></div>
    <button class="btn ghost" data-back="${roleProfileRoute()}">Done</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    wireToggles(root);
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
          ['To revoke', 'Leave the team — ask your coach to remove you, or contact support@onstandard.app.'],
        ],
      });
    }
    if (RT.myTrainer) {
      rows.push({
        ic: 'bolt', t: (RT.myTrainer.name || 'Your trainer'), pill: 'Limited access',
        s: 'Recovery, readiness, nutrition consistency — not your full meal detail',
        detail: [
          ['Can see', 'Recovery check-ins, readiness, and nutrition consistency.'],
          ['Cannot see', 'Your full meal photos and per-meal detail stay with you and your coach.'],
          ['To revoke', 'Leave the practice — ask your trainer, or contact support@onstandard.app.'],
        ],
      });
    }
    if (S.consent.minor || (RT.consent && RT.consent.guardianEmail)) {
      rows.push({
        ic: 'heart', t: RT.consent && RT.consent.guardianEmail ? `Guardian · ${RT.consent.guardianEmail}` : 'Parent / guardian', pill: 'Limited access',
        s: 'Consent status and account controls — not your day-to-day logs',
        detail: [
          ['Can do', 'Approve your account, request your data, or request deletion — legal guardian rights for minors.'],
          ['Cannot see', 'Your meal photos and daily logs are not mirrored to a guardian view.'],
        ],
      });
    }
    if (S.coach.hasCoach && S.coach.kind === 'coach') {
      rows.push({
        ic: 'grid', t: 'Teammates', pill: 'Score only',
        s: 'Leaderboard score only — when your coach turns the board on',
        detail: [
          ['Can see', 'Your daily score on the team leaderboard, if your coach enables it.'],
          ['Cannot see', 'Meals, photos, weight, and check-ins are never visible to teammates.'],
        ],
      });
    }
    return `
    ${backHead('Privacy & visibility', 'Who sees what — nothing is public', back)}

    ${rows.length ? `
    <section class="card" style="padding:6px 16px">
      ${rows.map((r, i) => `
        <details class="pv-row">
          <summary class="lrow">
            <div class="lic">${icon(r.ic, 17)}</div>
            <div class="lm"><div class="lt">${esc(r.t)}</div><div class="ls">${esc(r.s)}</div></div>
            <span class="status-pill ${i === 0 ? 'g' : 'b'}">${r.pill}</span>
          </summary>
          <div class="pv-detail">
            ${r.detail.map(([k, v]) => `<div class="pv-line"><b>${esc(k)}</b>${esc(v)}</div>`).join('')}
          </div>
        </details>`).join('')}
    </section>` : `
    <section class="card pad">
      <div style="font-size:15px;font-weight:800">No one is connected</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:4px;line-height:1.5">Right now your data is visible to you alone. Connecting a coach or trainer shares your execution with them — you'll see exactly what before you join.</div>
    </section>`}

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Defaults that protect you</div>
      <div class="ts">Nothing is public. Meal photos never leave your coach connection. You can download or delete everything, below.</div></div>
    </div>

    <div class="eyebrow">Your data</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" id="pv-export">
        <div class="lic">${icon('share', 17)}</div>
        <div class="lm"><div class="lt">Download my data</div><div class="ls">Profile, days, and meal records as a JSON file</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="delete-account">
        <div class="lic" style="color:var(--red)">${icon('x', 17)}</div>
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
    btn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      if (note) { note.style.color = ''; note.textContent = 'Preparing your export…'; }
      const r = await act.exportMyData();
      if (note) {
        note.style.color = r.ok ? 'var(--green-bright)' : '#f87171';
        note.textContent = r.ok ? 'Export downloaded.' : (r.error || 'Export failed.');
      }
      busy = false;
    });
  },
};

/* ---------- Plan & billing — HIDDEN until billing is functional (spec §21.1). ----------
   No entry point renders in any profile; this route only exists so a stale deep link
   (old notification, bookmark) lands safely on the owner's profile instead of a 404. */
export const billing = {
  tab: 'profile',
  get nav() { return roleNav(); },
  render() {
    location.hash = '#' + roleProfileRoute();
    return '';
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
        <div class="lm"><div class="lt">Accountability notifications</div><div class="ls">${p.enabled ? 'On — reminders track what’s actually still open' : 'Paused'}</div></div>
        <div class="seg" style="width:104px" id="ns-enabled"><button class="${p.enabled ? 'on' : ''}">On</button><button class="${p.enabled ? '' : 'on'}">Off</button></div>
      </div>
      <div class="lrow" id="ns-haptics" style="cursor:default">
        <div class="lic">${icon('bolt', 17)}</div>
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

    <div class="eyebrow">Urgency per requirement${S.coach.hasCoach ? ` · set by ${esc(S.coach.nameMid)}` : ' · from your plan'}</div>
    <section class="card" style="padding:6px 16px">
      ${[['utensils', 'Meals', 'Medium'], ['scale', 'Morning Weight', 'High'], ['moon', 'Recovery Check-In', 'High'], ['droplet', 'Hydration', 'Low']].map(([ic, t, lv]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div></div>
          <span class="status-pill ${lv === 'High' ? 'a' : lv === 'Medium' ? 'b' : 'p'}" style="display:inline-flex;align-items:center;gap:5px">${icon('lock', 11)} ${lv}</span>
        </div>`).join('')}
    </section>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:10px;padding:0 2px">${icon('lock', 11)} Urgency drives escalation and deadline warnings, and belongs to ${S.coach.hasCoach ? 'your coach' : 'your plan'} — your tone above only changes how reminders are worded. Completed requirements never remind you; finishing one cancels its reminders immediately.</div>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    wireToggles(root);
    wirePressure(root, '#ns-pressure');
    // Haptics: a REAL device preference — router's buzz() honors it on every tap.
    const hseg = root.querySelector('#ns-haptics-seg');
    if (hseg) {
      const [onB, offB] = hseg.querySelectorAll('button');
      onB.addEventListener('click', () => act.setHaptics(true));
      offB.addEventListener('click', () => act.setHaptics(false));
    }
    // Segmented controls persist straight into RT.notifPrefs and resync the device schedule.
    const seg = (sel, value) => {
      const row = root.querySelector(sel);
      if (!row) return;
      const btns = [...row.querySelectorAll('button')];
      btns.forEach((b) => b.addEventListener('click', () => {
        btns.forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        act.setNotifPrefs(value(b.textContent.trim()));
      }));
    };
    seg('#ns-enabled', (t) => ({ enabled: t === 'On' }));
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
export const coachNotifSettings = {
  nav: 'coach', tab: 'profile',
  render() {
    const p = normalizeCoachPrefs(RT.coachNotifPrefs);
    const qf = Math.round(p.quietFrom / 60); // 21 | 22 | 23
    const qt = Math.round((p.quietTo != null ? p.quietTo : 7 * 60) / 60); // resume hour
    return `
    ${backHead('Notifications', 'When and how you get alerts about your team.', 'coach-profile')}

    <div class="eyebrow">Quick setup</div>
    <div class="chip-row" id="cns-preset">
      <span class="chp">Essential</span>
      <span class="chp">Balanced</span>
      <span class="chp">Hands-on</span>
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
    <div class="chip-row" id="cns-briefing">
      <span class="chp ${!p.briefing ? 'on' : ''}">Off</span>
      <span class="chp ${p.briefing && p.briefingAt === 7 * 60 ? 'on' : ''}">7:00</span>
      <span class="chp ${p.briefing && p.briefingAt === 7 * 60 + 30 ? 'on' : ''}">7:30</span>
      <span class="chp ${p.briefing && p.briefingAt === 8 * 60 ? 'on' : ''}">8:00</span>
    </div>

    <div class="eyebrow">Evening recap</div>
    <div class="chip-row" id="cns-recap">
      <span class="chp ${!p.recap ? 'on' : ''}">Off</span>
      <span class="chp ${p.recap && p.recapAt === 20 * 60 ? 'on' : ''}">8:00 PM</span>
      <span class="chp ${p.recap && p.recapAt === 20 * 60 + 30 ? 'on' : ''}">8:30 PM</span>
      <span class="chp ${p.recap && p.recapAt === 21 * 60 ? 'on' : ''}">9:00 PM</span>
    </div>

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
    // Plain On/Off segments: each writes one field straight through act.setCoachNotifPrefs.
    const seg2 = (sel, patch) => {
      const row = root.querySelector(sel);
      if (!row) return;
      const [onBtn, offBtn] = row.querySelectorAll('button');
      onBtn.addEventListener('click', () => act.setCoachNotifPrefs(patch(true)));
      offBtn.addEventListener('click', () => act.setCoachNotifPrefs(patch(false)));
    };
    seg2('#cns-enabled', (on) => ({ enabled: on }));
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

    // Quick-setup presets: apply a bundle of prefs, then repaint so every control reflects it.
    const presetRow = root.querySelector('#cns-preset');
    if (presetRow) {
      const PRESETS = {
        Essential: { enabled: true, briefing: false, recap: false, hourly: false, immediateCritical: true, quietFrom: 21 * 60 },
        Balanced: { enabled: true, briefing: true, briefingAt: 7 * 60 + 30, recap: true, recapAt: 20 * 60 + 30, hourly: true, immediateCritical: true, quietFrom: 22 * 60 },
        'Hands-on': { enabled: true, briefing: true, briefingAt: 7 * 60, recap: true, recapAt: 20 * 60, hourly: true, immediateCritical: true, quietFrom: 23 * 60 },
      };
      presetRow.querySelectorAll('.chp').forEach((c) => c.addEventListener('click', () => {
        const b = PRESETS[c.textContent.trim()];
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
  hideTabs: true,
  render() {
    return `
    ${backHead('Delete Account', 'Permanent. We mean it.', roleProfileRoute())}

    <div class="state-demo err-box" style="text-align:left">
      <div class="sd-t">What gets deleted</div>
      <div class="sd-s">Your account, every meal photo, every log, every score, your coach connection, and your place on any leaderboard. Your coach keeps nothing of yours. This cannot be undone.</div>
    </div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Want your data first?</div>
      <div class="ts">Download everything from Privacy & visibility before you delete. Deletion completes within 30 days everywhere, immediately in the app.</div></div>
    </div>
    <div style="height:18px"></div>
    <button id="del-acct" class="btn" style="background:var(--red);color:#fff;box-shadow:0 10px 30px rgba(246,87,87,0.3)">${icon('x', 18)} Delete my account</button>
    <div id="del-status" style="text-align:center;font-size:13px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:10px"></div>
    <button class="btn ghost" data-go="${roleProfileRoute()}">Keep my account</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const btn = root.querySelector('#del-acct');
    const status = root.querySelector('#del-status');
    if (!btn) return;
    let armed = false;
    btn.addEventListener('click', async () => {
      if (!armed) { armed = true; btn.innerHTML = 'Tap again to permanently delete'; return; } // two-tap confirm
      btn.disabled = true; btn.textContent = 'Deleting…';
      const serverOk = await window.__act.deleteAccount(); // real delete_account RPC + sign-out + local wipe
      // Never claim the account is gone if the SERVER delete failed — that would tell the user
      // their data is erased while it's intact server-side. Local session is always signed out.
      if (serverOk === false) {
        if (status) { status.style.color = '#f87171'; status.textContent = "Couldn't reach the server — you're signed out, but your account may still exist. Try again online."; }
        btn.disabled = false; btn.textContent = 'Delete account'; armed = false;
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
        ${icon('share', 15, 'style="color:var(--text-3)"')}
      </a>`;
    return `
    ${backHead('Terms & Privacy', 'The documents, and what they mean', back)}
    <section class="card" style="padding:6px 16px">
      ${ext('https://onstandard.app/terms', 'clipboard', 'Terms of Service', 'The full agreement')}
      ${ext('https://onstandard.app/privacy', 'lock', 'Privacy Policy', 'What we collect and why')}
      <div class="lrow" data-go="privacy"><div class="lic">${icon('share', 16)}</div><div class="lm"><div class="lt">Data export</div><div class="ls">Download everything you own, in-app</div></div>${icon('chevron', 16, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="delete-account"><div class="lic" style="color:var(--red)">${icon('x', 16)}</div><div class="lm"><div class="lt">Account deletion</div><div class="ls">Permanent, in-app</div></div>${icon('chevron', 16, 'style="color:var(--text-3)"')}</div>
      ${ext('mailto:support@onstandard.app', 'message', 'Contact & support', 'support@onstandard.app')}
    </section>
    <div class="eyebrow">The short version</div>
    <section class="card" style="padding:6px 16px">
      ${[
        ['Your photos are yours', 'Meal photos are private to your account and your coach connection. They are not public and not sold.'],
        ['Health & AI disclaimer', 'OnStandard gives execution feedback, not medical or dietary advice. AI meal reads are estimates — verify anything health-critical yourself.'],
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
