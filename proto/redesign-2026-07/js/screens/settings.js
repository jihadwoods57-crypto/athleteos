import { S } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

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
      `<div class="msg athlete"><div><div class="bubble">${text.replace(/</g, '&lt;')}</div></div></div>`);
    input.value = '';
    if (onSend) onSend(text);
    setTimeout(() => {
      if (replyWho === 'delivery') {
        thread.insertAdjacentHTML('beforeend', `<div class="msg-status">${replyText}</div>`);
      } else {
        const av = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>`;
        thread.insertAdjacentHTML('beforeend',
          `<div class="msg ai"><div class="av">${av}</div><div><div class="who">${replyName}</div><div class="bubble">${replyText}</div></div></div>`);
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
      <div class="msg coach"><div class="av">M</div><div><div class="who">${S.coach.name} · 2h ago</div>
        <div class="bubble">Bumped water to 120 oz this week. You practice in heat Wed/Thu, get ahead of it.</div></div></div>
      <div class="msg athlete"><div><div class="bubble">Got it coach. Bringing the big jug.</div></div></div>
      <div class="msg coach"><div class="av">M</div><div><div class="who">${S.coach.name}</div>
        <div class="bubble">That's the standard. Dinner and recovery tonight, then we're 6 for 6 this week.</div></div></div>
    </div>
    <div class="composer">
      <input placeholder="Message ${S.coach.name}…" />
      <div class="send">${icon('arrowUp', 19)}</div>
    </div>
    <div style="height:10px"></div>
    `;
  },
  mount(root) { wireComposer(root, 'delivery', '', `Delivered · ${S.coach.name} usually replies after practice`); },
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
    <div class="chip-row" data-toggle-group>
      <span class="chp">Gentle</span><span class="chp on">Accountable</span><span class="chp">Max pressure</span>
    </div>

    <div style="height:18px"></div>
    <button class="btn ghost" data-go="profile">Done</button>
    <div style="height:10px"></div>
    `;
  },
  mount(root) { wireToggles(root); },
};

/* ---------- Privacy (role-scoped visibility, honest) ---------- */
export const privacy = {
  tab: 'profile',
  render() {
    const rows = [
      ['users', 'Coach Mark', 'Score, logs, meal photos, check-ins, weight trend'],
      ['heart', 'Parents', 'Score, streaks, completion only — no photos, no weight'],
      ['bolt', 'Trainer', 'Recovery, readiness, nutrition consistency'],
      ['grid', 'Teammates', 'Leaderboard score only'],
    ];
    return `
    ${backHead('Privacy', 'Who sees what — by role, nothing public', 'profile')}

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
    <button class="btn ghost" data-go="profile">Done</button>
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
