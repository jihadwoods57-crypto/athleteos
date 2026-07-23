import { S, RT } from '../state.js';
import { icon } from '../icons.js';
import { backHead, esc, safeImg } from '../components.js';
import { dir, debounce } from '../ob-directory.js';

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
        <div id="avatar-btn" style="position:absolute;bottom:-6px;right:-6px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer" title="Upload photo" aria-label="Upload photo"><span class="req-badge b" style="position:static;width:28px;height:28px;place-items:center;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${icon('camera', 14)}</span></div>
        <input type="file" id="avatar-file" accept="image/*" style="display:none" />
      </div>
      <div style="flex:1">
        <div class="nm">${esc(S.athlete.name)}</div>
        ${S.experience === 'client' ? `
        <div class="meta">${esc(S.planGoalLabel || 'Personal plan')}</div>
        ${S.coach.kind === 'trainer' && S.coach.team ? `<div class="meta" style="margin-top:1px">${esc(S.coach.team)}</div>` : ''}` : `
        <div class="meta"${[S.athlete.sport, S.athlete.position].filter(Boolean).length ? '' : ' style="color:var(--text-3)"'}>${esc([S.athlete.sport, S.athlete.position].filter(Boolean).join(' · ') || 'Add your sport')}</div>
        <div class="meta" style="margin-top:1px${S.athlete.school ? '' : ';color:var(--text-3)'}">${esc(S.athlete.school || 'Add your school')}</div>`}
      </div>
      <button class="btn ghost sm" style="width:auto;padding:0 16px;height:44px" data-go="edit-profile">Edit</button>
    </section>

    ${t.active ? `
    <div style="height:12px"></div>
    <div class="trust" data-go="trust" style="cursor:pointer">
      <div class="ic">${icon('shield', 20)}</div>
      <div style="flex:1">
        <div class="tt">Trust Pass active · day ${t.day} of ${t.length}</div>
        <div class="ts">Earned with ${(RT.trustPolicy || { eligibility_days: 7 }).eligibility_days} on-standard days. Tap for the rules.</div>
      </div>
      ${icon('chevron', 18, 'style="color:var(--text-3)"')}
    </div>` : ''}

    <div class="eyebrow">${S.coach.kind === 'trainer' ? 'Trainer' : 'Coach'} Connection</div>
    ${S.coach.hasCoach ? `
    <section class="card" style="padding:6px 16px">
      <div class="lrow" style="cursor:default">
        <div class="lic" style="background:linear-gradient(150deg,#f59e0b,#d97706);color:#1a1204;font-weight:800;font-size:14px">${esc(S.coach.initials)}</div>
        <div class="lm"><div class="lt">${esc(S.coach.name)}</div><div class="ls">${esc([S.coach.role, S.coach.team].filter(Boolean).join(' · '))}</div></div>
      </div>
      <div class="lrow" data-go="messages">
        <div class="lic">${icon('message', 17)}</div>
        <div class="lm"><div class="lt">Messages</div><div class="ls">${esc(S.coach.name)}'s comments land on your meals</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="privacy">
        <div class="lic">${icon('eye', 17)}</div>
        <div class="lm"><div class="lt">View connection</div><div class="ls">Exactly what ${esc(S.coach.nameMid)} can see</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      ${S.coach.kind === 'trainer' ? `
      <div class="lrow" data-go="my-trainer-offers">
        <div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('bolt', 17)}</div>
        <div class="lm"><div class="lt">Packages</div><div class="ls">Accountability packages from ${esc(S.coach.nameMid)}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>` : ''}
    </section>` : `
    <section class="card pad">
      <div style="font-size:15.5px;font-weight:800">Connect your coach or trainer</div>
      <div style="font-size:12.5px;font-weight:600;color:var(--text-2);margin-top:4px;line-height:1.5">Share your execution, receive requirements, and communicate directly.</div>
      <button class="btn primary sm" data-go="connect" style="margin-top:12px;width:auto;padding:0 22px">${icon('key', 16)} Connect</button>
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
        <div class="lm"><div class="lt">Streak</div><div class="ls">Days on standard · 1 grace per rolling week</div></div>
        <span class="lv">${S.streakDays}d</span>${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="history">
        <div class="lic">${icon('clipboard', 17)}</div>
        <div class="lm"><div class="lt">Activity history</div><div class="ls">The proof trail, day by day</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="checkin">
        <div class="lic">${icon('check', 17)}</div>
        <div class="lm"><div class="lt">Weekly check-in</div><div class="ls">${S.weekly.status}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
      <div class="lrow" data-go="recruiting">
        <div class="lic"${S.coach.hasCoach ? ' style="background:var(--green-surface);color:var(--green-bright)"' : ''}>${icon('shield', 17)}</div>
        <div class="lm"><div class="lt">Discipline record</div><div class="ls">${S.coach.hasCoach ? `${S.coach.kind === 'trainer' ? 'Trainer' : 'Coach'}-verified · proof of the work` : 'Not verified yet · connect a coach to verify'}</div></div>
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
      <div class="lrow" data-go="injury">
        <div class="lic" style="background:rgba(245,165,36,0.16);color:var(--amber-bright)">${icon('bolt', 17)}</div>
        <div class="lm"><div class="lt">Injury mode</div><div class="ls">${RT.injured ? 'Active · your Standard is adapted' : 'The Standard adapts when you’re hurt'}</div></div>
        ${icon('chevron', 17, 'style="color:var(--text-3)"')}
      </div>
    </section>

    <div class="eyebrow">Settings</div>
    <section class="card" style="padding:6px 16px">
      <div class="lrow" data-go="billing"><div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('bolt', 17)}</div><div class="lm"><div class="lt">Plan &amp; billing</div><div class="ls">Your membership &amp; premium features</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="invite-parent"><div class="lic">${icon('users', 17)}</div><div class="lm"><div class="lt">Invite a parent</div><div class="ls">Let a parent see your score &amp; streak</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="redeem-code"><div class="lic">${icon('key', 17)}</div><div class="lm"><div class="lt">Redeem a code</div><div class="ls">Unlock premium with a sponsor code</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="sponsor"><div class="lic" style="background:var(--green-surface);color:var(--green-bright)">${icon('bolt', 17)}</div><div class="lm"><div class="lt">Sponsor access</div><div class="ls">Fund premium for a group</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="privacy"><div class="lic">${icon('lock', 17)}</div><div class="lm"><div class="lt">Privacy & visibility</div><div class="ls">Who sees what · download your data</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="settings"><div class="lic">${icon('gear', 18)}</div><div class="lm"><div class="lt">Units & appearance</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="terms"><div class="lic">${icon('clipboard', 17)}</div><div class="lm"><div class="lt">Terms & privacy policy</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="delete-account"><div class="lic" style="color:var(--red)">${icon('x', 17)}</div><div class="lm"><div class="lt" style="color:var(--red)">Delete account</div></div>${icon('chevron', 17, 'style="color:var(--text-3)"')}</div>
      <div class="lrow" data-go="welcome"><div class="lic">${icon('back', 17)}</div><div class="lm"><div class="lt">Sign out</div></div></div>
    </section>

    <div style="height:10px"></div>
    `;
  },
  mount(root) {
    const btn = root.querySelector('#avatar-btn');
    const file = root.querySelector('#avatar-file');
    if (btn && file) {
      // Injected fresh on every mount, so it needs no data-go/data-act wiring — the
      // router only wires those at render time, but this element never touches render().
      const idCard = root.querySelector('.id-card');
      const err = document.createElement('div');
      err.id = 'avatar-err';
      err.style.cssText = 'color:#f87171;font-size:13px;font-weight:600;min-height:18px;text-align:center;margin-top:8px';
      idCard?.insertAdjacentElement('afterend', err);

      let busy = false;
      const setBusy = (on) => {
        busy = on;
        btn.style.opacity = on ? '0.5' : '';
        btn.title = on ? 'Uploading photo…' : 'Upload photo';
      };

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (busy) return;
        file.click();
      });
      file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        if (!f) return;
        err.textContent = '';
        setBusy(true);
        const reader = new FileReader();
        reader.onerror = () => {
          setBusy(false);
          err.textContent = "Couldn't read that photo — try a JPG or PNG.";
        };
        reader.onload = () => {
          // downscale via canvas so localStorage stays small
          const img = new Image();
          img.onerror = () => {
            setBusy(false);
            err.textContent = "Couldn't read that photo — try a JPG or PNG.";
          };
          img.onload = () => {
            const c = document.createElement('canvas');
            const s = Math.min(img.width, img.height);
            c.width = 128; c.height = 128;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
            window.__act.saveProfile({ avatar: c.toDataURL('image/jpeg', 0.82) });
            window.__render();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
      });
    }
  },
};

/* ---------- Edit profile (spec §11): real identity, sport-aware positions ---------- */
// Positions update dynamically with the sport (spec §11.2) — football positions never
// show before football is selected.
export const SPORT_POSITIONS = {
  Football: ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'K', 'P', 'LS', 'Athlete'],
  Basketball: ['Point Guard', 'Shooting Guard', 'Wing', 'Forward', 'Center'],
  Baseball: ['Pitcher', 'Catcher', 'Infield', 'Outfield', 'Utility'],
  Soccer: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'],
  Track: ['Sprints', 'Hurdles', 'Middle Distance', 'Distance', 'Jumps', 'Throws', 'Multis'],
  Volleyball: ['Setter', 'Libero', 'Middle Blocker', 'Outside Hitter', 'Opposite'],
};

export const editProfile = {
  tab: 'profile',
  render() {
    const a = S.athlete;
    const dob = (RT.profile && RT.profile.dob) || '';
    const sport = a.sport && SPORT_POSITIONS[a.sport] ? a.sport : a.sport;
    const positions = SPORT_POSITIONS[sport] || null;
    return `
    ${backHead('Edit Profile', 'Only what your coach and score need', 'profile')}

    <div class="eyebrow">Name</div>
    <div style="display:flex;gap:10px">
      <input class="ob-input ep-field" id="ep-first" value="${esc(a.first === 'Athlete' && !a.last ? '' : a.first)}" placeholder="First name" style="flex:1" />
      <input class="ob-input ep-field" id="ep-last" value="${esc(a.last)}" placeholder="Last name" style="flex:1" />
    </div>

    <div class="eyebrow">Date of birth</div>
    <input class="ob-input ep-field" id="ep-dob" type="date" value="${esc(dob)}" max="${new Date().toISOString().slice(0, 10)}" aria-label="Date of birth" />

    <div class="eyebrow">Sport</div>
    <div class="chip-row" id="ep-sport" data-toggle-group>
      ${Object.keys(SPORT_POSITIONS).map(s =>
        `<span class="chp ${sport === s ? 'on' : ''}">${s}</span>`).join('')}
    </div>

    <div class="eyebrow">${sport === 'Track' ? 'Event group' : 'Position'}</div>
    ${positions ? `
    <div class="chip-row" id="ep-pos" data-toggle-group>
      ${positions.map(p => `<span class="chp ${a.position === p ? 'on' : ''}">${p}</span>`).join('')}
    </div>` : `
    <div style="font-size:12.5px;font-weight:600;color:var(--text-3);padding:2px 2px 4px">Pick a sport first — positions follow the sport.</div>`}

    <div class="eyebrow">School / organization</div>
    <input class="ob-input ep-field" id="ep-school" value="${esc(a.school)}" placeholder="Search your school or team" autocomplete="off" />
    <div id="ep-school-results" class="ep-results" hidden></div>

    <div style="height:14px"></div>
    <div class="sidebox">
      <div class="req-icon b" style="width:38px;height:38px">${icon('lock', 17)}</div>
      <div><div class="tt">That's all we ask for</div>
      <div class="ts">No bios, no socials, no feeds. Goals and weight live in your Standard; this is who your coach sees.</div></div>
    </div>

    <div style="height:16px"></div>
    <div id="ep-err" style="color:#f87171;font-size:13px;font-weight:600;min-height:18px;text-align:center"></div>
    <button class="btn primary" id="ep-save" disabled style="opacity:.5">${icon('check', 19)} Save</button>
    <div style="height:10px"></div>
    `;
  },
  async mount(root) {
    const btn = root.querySelector('#ep-save');
    const err = root.querySelector('#ep-err');
    let dirty = false;
    const markDirty = () => {
      if (dirty) return;
      dirty = true;
      btn.disabled = false;
      btn.style.opacity = '1';
      editProfile._dirty = true;
    };
    editProfile._dirty = false;
    root.querySelectorAll('.ep-field').forEach((el) => el.addEventListener('input', markDirty));

    // Sport chips re-render positions in place (spec §11.2): selecting a sport swaps the
    // position list; the previous selection only survives if it exists in the new sport.
    root.querySelectorAll('#ep-sport .chp').forEach((ch) => ch.addEventListener('click', () => {
      root.querySelectorAll('#ep-sport .chp').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on');
      markDirty();
      const sport = ch.textContent;
      const posWrap = root.querySelector('#ep-pos');
      const list = SPORT_POSITIONS[sport] || [];
      if (posWrap) {
        const prev = posWrap.querySelector('.on') ? posWrap.querySelector('.on').textContent : '';
        posWrap.innerHTML = list.map((p) => `<span class="chp ${p === prev ? 'on' : ''}">${p}</span>`).join('');
        wirePos();
      }
    }));
    const wirePos = () => {
      root.querySelectorAll('#ep-pos .chp').forEach((ch) => ch.addEventListener('click', () => {
        root.querySelectorAll('#ep-pos .chp').forEach((x) => x.classList.remove('on'));
        ch.classList.add('on');
        markDirty();
      }));
    };
    wirePos();

    // School search (spec §11.3): the org directory as you type, free text as fallback.
    const school = root.querySelector('#ep-school');
    const results = root.querySelector('#ep-school-results');
    if (school && results) {
      const search = debounce(async () => {
        const q = school.value.trim();
        if (q.length < 3) { results.hidden = true; return; }
        try {
          const data = await dir.search(q);
          const orgs = (data && data.orgs) || [];
          if (!orgs.length) { results.hidden = true; return; }
          results.innerHTML = orgs.slice(0, 5).map((o) =>
            `<div class="ep-result" data-name="${esc(o.name)}">${esc(o.name)}${o.city || o.state ? `<span>${esc([o.city, o.state].filter(Boolean).join(', '))}</span>` : ''}</div>`).join('');
          results.hidden = false;
          results.querySelectorAll('.ep-result').forEach((r) => r.addEventListener('click', () => {
            school.value = r.getAttribute('data-name');
            results.hidden = true;
            markDirty();
          }));
        } catch { results.hidden = true; /* directory offline — free text still saves */ }
      }, 300);
      school.addEventListener('input', search);
    }

    btn.addEventListener('click', async () => {
      const first = root.querySelector('#ep-first').value.trim();
      const last = root.querySelector('#ep-last').value.trim();
      const dob = root.querySelector('#ep-dob').value;
      const schoolV = root.querySelector('#ep-school').value.trim();
      const sport = root.querySelector('#ep-sport .on')?.textContent || '';
      const position = root.querySelector('#ep-pos .on')?.textContent || '';
      // Inline validation (spec §11.4). Never let a blank name wipe the identity.
      if (!first) { err.textContent = 'Add your first name — your coach sees it on every log.'; return; }
      if (!last) { err.textContent = 'Add your last name.'; return; }
      if (dob) {
        const d = new Date(dob + 'T12:00:00');
        const age = (Date.now() - d.getTime()) / (365.25 * 86400000);
        if (isNaN(d.getTime()) || age < 5 || age > 100) { err.textContent = 'Check your date of birth.'; return; }
      }
      err.textContent = '';
      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = 'Saving…';
      const name = `${first} ${last}`.trim();
      // Local first (instant), then the SERVER write the coach actually reads.
      window.__act.saveProfile({ name, school: schoolV, sport, position, ...(dob ? { dob } : {}) });
      const ok = await window.__act.saveIdentity({ full_name: name, sport, position });
      let dobOk = true;
      if (dob) dobOk = await window.__act.saveAthleteProfile({ dob });
      if (ok === false || dobOk === false) { err.textContent = 'Saved on this phone — couldn’t reach the server. It’ll sync when you’re back online.'; btn.disabled = false; btn.textContent = was; return; }
      editProfile._dirty = false;
      btn.textContent = 'Saved ✓';
      setTimeout(() => window.__back('profile'), 350);
    });

    // Unsaved-change warning (spec §11.4): leaving with edits asks once.
    root.querySelectorAll('[data-back]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (editProfile._dirty && !window.confirm('Discard your unsaved changes?')) {
          e.stopImmediatePropagation();
          e.preventDefault();
        } else {
          editProfile._dirty = false;
        }
      }, { capture: true });
    });
  },
};
