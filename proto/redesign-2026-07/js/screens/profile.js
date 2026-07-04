import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead } from '../components.js';

function avatarEl(size = 62) {
  const a = S.athlete;
  return a.avatar
    ? `<div class="big-av" style="width:${size}px;height:${size}px;background-image:url('${a.avatar}');background-size:cover;background-position:center"></div>`
    : `<div class="big-av" style="width:${size}px;height:${size}px">${a.initials}</div>`;
}

export default {
  tab: 'profile',
  render() {
    const t = S.trustPass;
    const scope = S.squadScope;
    const scopeLabel = scope === 'team' ? 'Whole team' : scope === 'position' ? 'WR room' : 'Off';
    return `
    <div class="screen-title">Profile</div>

    <section class="card id-card">
      <div style="position:relative" id="avatar-wrap">
        ${avatarEl()}
        <div class="req-badge b" style="top:auto;bottom:-4px;left:auto;right:-4px;width:22px;height:22px;cursor:pointer" id="avatar-btn" title="Upload photo">${icon('camera', 12)}</div>
        <input type="file" id="avatar-file" accept="image/*" style="display:none" />
      </div>
      <div style="flex:1">
        <div class="nm">${S.athlete.name}</div>
        <div class="meta">${S.athlete.sport} · ${S.athlete.position}</div>
        <div class="meta" style="margin-top:1px">${S.athlete.school}</div>
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
        <div class="lic" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204;font-weight:800;font-size:14px">M</div>
        <div class="lm"><div class="lt">${S.coach.name}</div><div class="ls">${S.coach.team} · tap to message</div></div>
        <span class="status-pill g">Connected</span>
      </div>
      <div class="lrow" data-go="connect">
        <div class="lic">${icon('key', 18)}</div>
        <div class="lm"><div class="lt">Enter coach code</div><div class="ls">Join another coach or trainer group</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>

    <div class="eyebrow">Squad <span class="link" data-go="squad">Open</span></div>
    ${scope === 'off'
      ? `<div class="sidebox">
          <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
          <div><div class="tt">Leaderboard is off</div>
          <div class="ts">${S.coach.name} turned rankings off for now. Your work still counts on his board.</div></div>
        </div>`
      : `<section class="card" style="padding:6px 0" data-go="squad">
          <div style="padding:12px 16px 4px;font-size:12px;font-weight:700;color:var(--text-3)">${scopeLabel} · set by ${S.coach.name}</div>
          ${S.squad.slice(0, 4).map(a => `
            <div class="lb-row ${a.you ? 'you' : ''}">
              <span class="lb-rank">${a.rank}</span>
              <span class="lb-name">${a.name} <small style="color:var(--text-3);font-weight:700">· ${a.unit}</small></span>
              <span class="lb-score" style="color:${a.score >= 80 ? 'var(--green-bright)' : 'var(--text-2)'}">${a.score}</span>
            </div>`).join('')}
        </section>`}

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
        <div class="lm"><div class="lt">Accountability partner</div><div class="ls">D. Okafor · paired by ${S.coach.name}</div></div>
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
        <div class="lm"><div class="lt">Food restrictions & allergies</div><div class="ls">${RT.allergies.length ? RT.allergies.join(' · ') : 'None declared'}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="devices">
        <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('check', 17)}</div>
        <div class="lm"><div class="lt">Connected devices</div><div class="ls">${RT.wearable ? 'Apple Watch · recovery verified' : 'None connected'}</div></div>
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
    <input class="ob-input" id="ep-name" value="${a.name}" />

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
    <input class="ob-input" id="ep-school" value="${a.school}" />

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
      window.__act.saveProfile({
        name: root.querySelector('#ep-name').value.trim() || 'Jihad Woods',
        school: root.querySelector('#ep-school').value.trim() || 'Central Catholic',
        sport: root.querySelector('#ep-sport .on')?.textContent || 'Football',
        position: root.querySelector('#ep-pos .on')?.textContent || 'Wide Receiver',
      });
      location.hash = '#profile';
    });
  },
};

/* ---------- Squad: sport-fluent, coach-scoped ---------- */
export const squad = {
  tab: 'profile',
  render() {
    const scope = S.squadScope;
    if (scope === 'off') {
      return `${backHead('Squad', 'Rankings are off right now', 'profile')}
      <div class="state-demo">
        <div class="sd-ic">${icon('users', 24)}</div>
        <div class="sd-t">${S.coach.name} turned the board off</div>
        <div class="sd-s">Some weeks are about you versus yesterday, not you versus the room. Your score still counts on his dashboard.</div>
      </div>`;
    }
    const label = scope === 'team' ? 'Whole team' : 'WR room';
    const rows = S.squad;
    const leader = rows[0];
    return `
    ${backHead('Squad', `${label} · this week · set by ${S.coach.name}`, 'profile')}

    <section class="card pad" style="display:flex;align-items:center;gap:14px">
      <div class="req-icon a" style="width:48px;height:48px;border-radius:15px">${icon('flame', 22)}</div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:800">${leader.you ? 'You lead the room.' : `${leader.name} leads the ${scope === 'team' ? 'team' : 'room'}.`}</div>
        <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:2px">Ranked on OnStandard Score. Finish tonight and you jump.</div>
      </div>
    </section>

    <div class="eyebrow">${label}</div>
    <section class="card" style="padding:6px 0">
      ${rows.map(a => `
        <div class="lb-row ${a.you ? 'you' : ''}">
          <span class="lb-rank">${a.rank}</span>
          <span class="lb-name">${a.name} <small style="color:var(--text-3);font-weight:700">· ${a.unit}</small></span>
          <span class="lb-score" style="color:${a.score >= 80 ? 'var(--green-bright)' : a.score >= 60 ? 'var(--amber-bright)' : 'var(--red)'}">${a.score}</span>
        </div>`).join('')}
    </section>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">What the room sees</div>
      <div class="ts">Score only. Nobody sees your meals, weight, or check-ins — that stays between you and ${S.coach.name}.</div></div>
    </div>
    <div style="height:10px"></div>
    `;
  },
};
