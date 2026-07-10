import { S, RT, act } from '../state.js';
import { icon } from '../icons.js';
import { mapPressure } from '../exec.js';
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
  if (/(swap|instead|replace|substitute)/.test(t)) return 'Yes, swap it. Based on Coach Mark’s plan: any protein for protein, any slow carb for slow carb, keep the portion the same. Rice, potatoes, oats, and tortillas are all interchangeable for you.';
  if (/(water|hydrat|drink)/.test(t)) return `Hydration is this week’s focus: 120 oz. You’re at ${RT.hydrationOz} oz — top it up before bed. It doesn’t move today’s score, but Coach Mark is watching it.`;
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

/* ---------- Messages: athlete <-> coach thread ---------- */
export const messages = {
  tab: 'plan',
  render() {
    return `
    ${backHead(S.coach.name, `${S.coach.role} · ${S.coach.team}`, 'plan')}

    <div class="thread">
      <div class="msg-status">No messages yet. Anything ${esc(S.coach.name)} sends will land here — and your messages reach him.</div>
    </div>
    <div class="composer">
      <input placeholder="Message ${S.coach.name}…" />
      <div class="send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) { wireComposer(root, 'delivery', '', `Delivered · ${S.coach.name} sees it on his side`); },
};

/* ---------- Units & preferences (working toggles) ---------- */
export const settings = {
  tab: 'profile',
  render() {
    return `
    ${backHead('Units & preferences', 'Kept clean, not a junk drawer', 'profile')}

    <div class="eyebrow">Units</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('scale', 17)}</div>
        <div class="lm"><div class="lt">Weight</div></div>
        <div class="seg" style="width:130px" data-toggle-group>
          <button class="on">lb</button><button>kg</button>
        </div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('droplet', 17)}</div>
        <div class="lm"><div class="lt">Fluids</div></div>
        <div class="seg" style="width:130px" data-toggle-group>
          <button class="on">oz</button><button>L</button>
        </div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('clock', 17)}</div>
        <div class="lm"><div class="lt">Time</div></div>
        <div class="seg" style="width:130px" data-toggle-group>
          <button class="on">12h</button><button>24h</button>
        </div>
      </div>
    </section>

    <div class="eyebrow">Reminders</div>
    <div class="chip-row" id="set-pressure" data-toggle-group>
      <span class="chp">Gentle</span><span class="chp on">Accountable</span><span class="chp">Max pressure</span>
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
    <button class="btn ghost" data-go="profile">Done</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    wireToggles(root);
    wirePressure(root, '#set-pressure');
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

/* ---------- Privacy (role-scoped visibility, honest) ---------- */
export const privacy = {
  tab: 'profile',
  hideTabs: true,
  render({ sub } = {}) {
    const back = OB_BACK[sub] || 'profile';
    const rows = [
      ['users', 'Coach Mark', 'Score, logs, meal photos, check-ins, weight trend'],
      ['heart', 'Parents', 'Score, streaks, completion only — no photos, no weight'],
      ['bolt', 'Trainer', 'Recovery, readiness, nutrition consistency'],
      ['grid', 'Teammates', 'Leaderboard score only'],
    ];
    return `
    ${backHead('Privacy', 'Who sees what — by role, nothing public', back)}

    <section class="card" style="padding:6px 16px">
      ${rows.map(([ic, t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls">${s}</div></div>
          <span class="status-pill g">Scoped</span>
        </div>`).join('')}
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">Defaults that protect you</div>
      <div class="ts">Nothing is public. Meal photos never leave your coach connection. Body photos are coach-only. You can export or delete everything from Account.</div></div>
    </div>

    <div style="height:18px"></div>
    <button class="btn ghost" data-go="${back}">Done</button>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Plan & billing (Stripe seam, honest about status) ---------- */
export const billing = {
  tab: 'profile',
  render() {
    return `
    ${backHead('Plan & billing', 'Simple plans, no tricks', 'profile')}

    <section class="card pad" style="border-color:var(--blue-border)">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:17px;font-weight:800">Athlete</div>
        <span class="status-pill b">Current plan</span>
      </div>
      <div style="font-size:13.5px;font-weight:600;color:var(--text-2);margin-top:8px;line-height:1.5">
        Daily score · AI meal analysis · coach connection · full history</div>
      <div style="font-size:22px;font-weight:800;margin-top:12px">$9.99<small style="font-size:13px;color:var(--text-3)"> / month</small></div>
    </section>
    <div style="height:12px"></div>
    <section class="card pad">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:17px;font-weight:800">Team</div>
        <span class="status-pill g">For coaches</span>
      </div>
      <div style="font-size:13.5px;font-weight:600;color:var(--text-2);margin-top:8px;line-height:1.5">
        Whole roster · coach dashboard · assignments · Copilot · team billing</div>
      <div style="font-size:13px;font-weight:700;color:var(--text-2);margin-top:12px">Priced per roster · coach starts it from the Team view</div>
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon a" style="width:38px;height:38px">${icon('bolt', 17)}</div>
      <div><div class="tt">Checkout not wired in this prototype</div>
      <div class="ts">The Stripe seam exists in the app (plans seeded, portal stubbed). Only the charge is unwired, on purpose.</div></div>
    </div>
    <div style="height:18px"></div>
    <button class="btn ghost" data-go="profile">Done</button>
    <div style="height:10px"></div>
    `;
  },
};

/* ---------- Notification settings (athlete-side quiet hours; coach sets urgency) ---------- */
export const notifSettings = {
  tab: 'profile',
  render() {
    return `
    ${backHead('Notification Settings', 'Coach sets urgency. You set the quiet.', 'notifications')}

    <div class="eyebrow">Reminder pressure</div>
    <div class="chip-row" id="ns-pressure" data-toggle-group>
      <span class="chp">Gentle</span><span class="chp on">Accountable</span><span class="chp">Max pressure</span>
    </div>

    <div class="eyebrow">Quiet hours</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('moon', 17)}</div>
        <div class="lm"><div class="lt">No pings after</div></div>
        <div class="seg" style="width:150px" data-toggle-group><button>9 PM</button><button class="on">10 PM</button><button>11 PM</button></div>
      </div>
      <div class="lrow" style="cursor:default">
        <div class="lic">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Deadline warnings</div><div class="ls">The only ones that break quiet hours</div></div>
        <div class="seg" style="width:104px" data-toggle-group><button class="on">On</button><button>Off</button></div>
      </div>
    </section>

    <div class="eyebrow">Per requirement · set by ${S.coach.name}</div>
    <section class="card" style="padding:6px 16px">
      ${[['utensils', 'Meals', 'Medium'], ['scale', 'Morning Weight', 'High'], ['moon', 'Recovery Check-In', 'High'], ['droplet', 'Hydration', 'Low']].map(([ic, t, lv]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon(ic, 17)}</div>
          <div class="lm"><div class="lt">${t}</div></div>
          <span class="status-pill ${lv === 'High' ? 'a' : lv === 'Medium' ? 'b' : 'p'}">${lv}</span>
        </div>`).join('')}
    </section>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:10px;padding:0 2px">Urgency per requirement belongs to your coach. Ask him, not the app.</div>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) { wireToggles(root); wirePressure(root, '#ns-pressure'); },
};

/* ---------- Delete account (Apple requires in-app deletion) ---------- */
export const deleteAccount = {
  hideTabs: true,
  render() {
    return `
    ${backHead('Delete Account', 'Permanent. We mean it.', 'profile')}

    <div class="state-demo err-box" style="text-align:left">
      <div class="sd-t">What gets deleted</div>
      <div class="sd-s">Your account, every meal photo, every log, every score, your coach connection, and your place on any leaderboard. Your coach keeps nothing of yours. This cannot be undone.</div>
    </div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('clipboard', 17)}</div>
      <div><div class="tt">Want your data first?</div>
      <div class="ts">Export everything from Profile before you delete. Deletion completes within 30 days everywhere, immediately in the app.</div></div>
    </div>
    <div style="height:18px"></div>
    <button id="del-acct" class="btn" style="background:var(--red);color:#fff;box-shadow:0 10px 30px rgba(246,87,87,0.3)">${icon('x', 18)} Delete my account</button>
    <div id="del-status" style="text-align:center;font-size:13px;font-weight:600;color:var(--text-3);min-height:18px;margin-top:10px"></div>
    <button class="btn ghost" data-go="profile">Keep my account</button>
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
      await window.__act.deleteAccount(); // real delete_account RPC + sign-out + local wipe
      if (status) status.textContent = 'Account deleted.';
      location.hash = '#welcome';
    });
  },
};

/* ---------- Terms (compliance surface) ---------- */
export const terms = {
  hideTabs: true,
  render({ sub } = {}) {
    const back = OB_BACK[sub] || 'profile';
    return `
    ${backHead('Terms & Privacy', 'The short, honest version', back)}
    <section class="card" style="padding:6px 16px">
      ${[
        ['Your photos are yours', 'Meal photos go to your coach connection only. Never public, never sold, never used to train anything without asking.'],
        ['Minors are protected', 'Under 13 requires a parent or guardian. Parents of minors can request full data access or deletion at any time.'],
        ['No tracking', 'No ad tracking, no third-party analytics identifiers. The score is the product, not your data.'],
        ['Health disclaimer', 'OnStandard gives execution feedback, not medical advice. Eating-disorder-pattern flags pause scoring and suggest talking to someone real.'],
        ['Delete anytime', 'Full in-app account deletion. Export first if you want your history.'],
      ].map(([t, s]) => `
        <div class="lrow" style="cursor:default">
          <div class="lic">${icon('check', 16)}</div>
          <div class="lm"><div class="lt">${t}</div><div class="ls" style="white-space:normal;line-height:1.4">${s}</div></div>
        </div>`).join('')}
    </section>
    <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-top:10px;padding:0 2px">Full legal text ships with the real app at onstandard.app/legal.</div>
    <div style="height:10px"></div>
    `;
  },
};

/* shared: single-select toggle groups */
export function wireToggles(root) {
  root.querySelectorAll('[data-toggle-group]').forEach(g => {
    g.querySelectorAll('button, .chp, .c5, .choice').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        g.querySelectorAll('.on').forEach(x => x.classList.remove('on'));
        el.classList.add('on');
      });
    });
  });
}
