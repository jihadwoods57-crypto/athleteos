import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg } from '../components.js';

function avatarEl(size = 62) {
  const a = S.athlete;
  return a.avatar && safeImg(a.avatar)
    ? `<div class="big-av" style="width:${size}px;height:${size}px;background-image:url('${safeImg(a.avatar)}');background-size:cover;background-position:center"></div>`
    : `<div class="big-av" style="width:${size}px;height:${size}px">${esc(a.initials)}</div>`;
}

export default {
  tab: 'profile',
  render() {
    const t = S.trustPass;
    return `
    <div class="screen-title">Profile</div>

    <section class="card id-card">
      <div style="position:relative" id="avatar-wrap">
        ${avatarEl()}
        <div class="req-badge b" style="top:auto;bottom:-4px;left:auto;right:-4px;width:22px;height:22px;cursor:pointer" id="avatar-btn" title="Upload photo">${icon('camera', 12)}</div>
        <input type="file" id="avatar-file" accept="image/*" style="display:none" />
      </div>
      <div style="flex:1">
        <div class="nm">${esc(S.athlete.name)}</div>
        <div class="meta">${esc([S.athlete.sport, S.athlete.position].filter(Boolean).join(' · ') || 'Add your sport')}</div>
        <div class="meta" style="margin-top:1px">${esc(S.athlete.school || 'Add your school')}</div>
      </div>
      <button class="btn ghost sm" style="width:auto;padding:0 16px;height:40px" data-go="edit-profile">Edit</button>
    </section>

    ${t.active ? `
    <div style="height:12px"></div>
    <div class="trust" data-go="trust" style="cursor:pointer">
      <div class="ic">${icon('shield', 20)}</div>
      <div style="flex:1">
        <div class="tt">Trust Pass active · day ${t.day} of ${t.length}</div>
        <div class="ts">Earned with 7 on-standard days. Tap for the rules.</div>
      </div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </div>` : ''}

    <div class="eyebrow">Coach Connection</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="messages">
        <div class="lic" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204;font-weight:800;font-size:14px">${icon('message', 17)}</div>
        <div class="lm"><div class="lt">Messages</div><div class="ls">Your conversation with your coach</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="connect">
        <div class="lic">${icon('key', 18)}</div>
        <div class="lm"><div class="lt">Enter coach code</div><div class="ls">Connect a coach or trainer group</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>

    <div class="eyebrow">Squad</div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('users', 17)}</div>
      <div><div class="tt">Leaderboard coming soon</div>
      <div class="ts">Team rankings turn on when your coach's board is wired — until then there's no roster to compare against, and we won't invent one.</div></div>
    </div>

    <div class="eyebrow">Accountability</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="notif-settings">
        <div class="lic">${icon('bell', 18)}</div>
        <div class="lm"><div class="lt">Notifications</div><div class="ls">Pressure level, quiet hours</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="streak">
        <div class="lic" style="color:var(--amber-bright)">${icon('flame', 18)}</div>
        <div class="lm"><div class="lt">Streak</div><div class="ls">${S.streakDays} days on standard · 1 grace per 7 days</div></div>
        <span class="lv">${S.streakDays}d</span>
      </div>
      <div class="lrow" data-go="history">
        <div class="lic">${icon('clipboard', 17)}</div>
        <div class="lm"><div class="lt">Meal & log history</div><div class="ls">The proof trail, day by day</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="checkin">
        <div class="lic">${icon('check', 17)}</div>
        <div class="lm"><div class="lt">Weekly check-in</div><div class="ls">${S.weekly.status}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="partner">
        <div class="lic" style="background:rgba(52,211,153,0.16);color:var(--green-bright)">${icon('users', 17)}</div>
        <div class="lm"><div class="lt">Accountability partner</div><div class="ls">Not paired yet · coming soon</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="recruiting">
        <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('shield', 17)}</div>
        <div class="lm"><div class="lt">Discipline record</div><div class="ls">Coach-verified · share with recruiters</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>

    <div class="eyebrow">Health & safety</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="restrictions">
        <div class="lic" style="background:var(--red-surface);color:var(--red)">${icon('bell', 17)}</div>
        <div class="lm"><div class="lt">Food restrictions & allergies</div><div class="ls">${RT.allergies.length ? esc(RT.allergies.join(' · ')) : 'None declared'}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="devices">
        <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 17)}</div>
        <div class="lm"><div class="lt">Connected devices</div><div class="ls">None connected · coming soon</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="injury">
        <div class="lic" style="background:rgba(245,165,36,0.16);color:var(--amber-bright)">${icon('bolt', 17)}</div>
        <div class="lm"><div class="lt">Injury mode</div><div class="ls">${RT.injured ? 'Active · hamstring week 2 of 4' : 'The Standard adapts when you’re hurt'}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>

    <div class="eyebrow">Settings</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="privacy"><div class="lic">${icon('lock', 17)}</div><div class="lm"><div class="lt">Privacy & visibility</div><div class="ls">Who sees what, by role</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="billing"><div class="lic">${icon('bolt', 17)}</div><div class="lm"><div class="lt">Plan & billing</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="settings"><div class="lic">${icon('gear', 18)}</div><div class="lm"><div class="lt">Units & preferences</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="terms"><div class="lic">${icon('clipboard', 17)}</div><div class="lm"><div class="lt">Terms & privacy policy</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" style="cursor:default"><div class="lic">${icon('grid', 17)}</div><div class="lm"><div class="lt">Export my data</div><div class="ls">Everything, in a file you own</div></div><span class="status-pill b">Ready</span></div>
      <div class="lrow" data-go="delete-account"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Delete account</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="welcome"><div class="lic">${icon('back', 17)}</div><div class="lm"><div class="lt">Sign out</div></div></div>
    </section>

    <div class="eyebrow">Prototype controls</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="welcome">
        <div class="lic">${icon('sparkle', 17)}</div>
        <div class="lm"><div class="lt">View onboarding</div><div class="ls">All four roles, from Welcome</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="states">
        <div class="lic">${icon('grid', 17)}</div>
        <div class="lm"><div class="lt">Design states gallery</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-act="reset" data-then="home">
        <div class="lic" style="background:var(--blue-surface);color:var(--blue-bright)">${icon('flip', 17)}</div>
        <div class="lm"><div class="lt">Reset the demo day</div><div class="ls">Back to 7:12 PM, 82, dinner + recovery open</div></div>
      </div>
    </section>
    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const btn = root.querySelector('#avatar-btn');
    const file = root.querySelector('#avatar-file');
    if (btn && file) {
      btn.addEventListener('click', (e) => { e.stopPropagation(); file.click(); });
      file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          // downscale via canvas so localStorage stays small
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            const s = Math.min(img.width, img.height);
            c.width = 128; c.height = 128;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
            window.__act.saveProfile({ avatar: c.toDataURL('image/jpeg', 0.82) });
            location.reload();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
      });
    }
  },
};

/* ---------- Edit profile: only what the app actually uses ---------- */
export const editProfile = {
  tab: 'profile',
  render() {
    const a = S.athlete;
    return `
    ${backHead('Edit Profile', 'Only what your coach and score need', 'profile')}

    <div class="eyebrow">Name</div>
    <input class="ob-input" id="ep-name" value="${esc(a.name)}" placeholder="Your name" />

    <div class="eyebrow">Sport</div>
    <div class="chip-row" id="ep-sport" data-toggle-group>
      ${['Football', 'Basketball', 'Baseball', 'Soccer', 'Track', 'Volleyball'].map(s =>
        `<span class="chp ${a.sport === s ? 'on' : ''}">${s}</span>`).join('')}
    </div>

    <div class="eyebrow">Position</div>
    <div class="chip-row" id="ep-pos" data-toggle-group>
      ${['QB', 'RB', 'Wide Receiver', 'TE', 'OL', 'DL', 'LB', 'DB'].map(p =>
        `<span class="chp ${a.position === p ? 'on' : ''}">${p}</span>`).join('')}
    </div>

    <div class="eyebrow">School / organization</div>
    <input class="ob-input" id="ep-school" value="${esc(a.school)}" placeholder="Your school or team" />

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">That's all we ask for</div>
      <div class="ts">No bios, no socials, no feeds. Goals and weight live in your Standard; this is just who your coach sees.</div></div>
    </div>

    <div style="height:16px"></div>
    <button class="btn primary" id="ep-save">${icon('check', 19)} Save</button>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const { wireToggles } = await import('./settings.js');
    wireToggles(root);
    root.querySelector('#ep-save').addEventListener('click', () => {
      // Save the athlete's REAL edits — a blank field stays blank, never a fabricated default.
      window.__act.saveProfile({
        name: root.querySelector('#ep-name').value.trim(),
        school: root.querySelector('#ep-school').value.trim(),
        sport: root.querySelector('#ep-sport .on')?.textContent || '',
        position: root.querySelector('#ep-pos .on')?.textContent || '',
      });
      location.hash = '#profile';
    });
  },
};

/* ---------- Squad: sport-fluent, coach-scoped ---------- */
export const squad = {
  tab: 'profile',
  render() {
    return `
    ${backHead('Squad', 'Leaderboard coming soon', 'profile')}
    <div class="state-demo">
      <div class="sd-ic">${icon('users', 24)}</div>
      <div class="sd-t">No leaderboard yet</div>
      <div class="sd-s">Rankings turn on when your coach's board is wired. There's no real roster to rank against yet, so nothing is shown — we won't fill it with made-up teammates.</div>
    </div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">What the room will see</div>
      <div class="ts">Score only. Meals, weight, and check-ins stay between you and your coach.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};
